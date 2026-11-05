from backend.observability import audit
from backend.coordination import coordinated
import asyncio
import hashlib
import io
import json
import logging
import os
import shutil
import secrets
import re
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx

from backend.config import settings
from backend.i18n import t
from backend.schemas import (
    FeedbackFileImportItem,
    FeedbackImportCommitRequest,
    FeedbackImportCommitResponse,
    FeedbackImportCommitResultItem,
    FeedbackImportPreviewResponse,
    FeedbackUnitImportPreview,
    SubmissionItem,
)
from backend.services.ilias_client import IliasClient

logger = logging.getLogger(__name__)

STAGING_ROOT = Path(".staged_imports")
MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB
MAX_ARCHIVE_FILE_COUNT = 1000
MAX_STAGING_AGE_SECONDS = 7200  # 2 hours

METADATA_FILENAMES = {
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
    ".keep",
    "download_failures.txt",
    "download_failures.log",
    "instructions.txt",
    "readme.txt",
}

MANIFEST_FILENAMES = {
    "betterilias-feedback.json",
    "betterilias_feedback.json",
    "feedback.json",
    "manifest.json",
}


def cleanup_stale_staging_dirs(max_age_seconds: int = MAX_STAGING_AGE_SECONDS) -> None:
    """Removes staging directories older than max_age_seconds."""
    if not STAGING_ROOT.exists():
        return
    now = time.time()
    try:
        for session_dir in STAGING_ROOT.iterdir():
            if not session_dir.is_dir():
                continue
            for import_dir in session_dir.iterdir():
                if not import_dir.is_dir():
                    continue
                try:
                    mtime = import_dir.stat().st_mtime
                    if now - mtime > max_age_seconds:
                        shutil.rmtree(import_dir, ignore_errors=True)
                except Exception:
                    pass
            # If session dir is empty, delete it
            if not any(session_dir.iterdir()):
                try:
                    session_dir.rmdir()
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Error during staging cleanup: {e}")


def is_symlink_zip_info(zinfo: zipfile.ZipInfo) -> bool:
    """Check if zip entry is a symbolic link."""
    return (zinfo.external_attr >> 16) & 0o120000 == 0o120000


def sanitize_rel_path(path_str: str) -> str:
    """Normalize path and ensure no directory traversal."""
    normalized = path_str.replace("\\", "/").strip().lstrip("/")
    parts = [p for p in normalized.split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError(f"Path traversal rejected: {path_str}")
    return "/".join(parts)


def safe_inspect_zip(zip_bytes: bytes) -> Tuple[List[Tuple[str, bytes]], List[str], List[str]]:
    """
    Safely inspects and extracts files from a ZIP archive.
    Returns: (valid_files, skipped_files, errors)
    where valid_files is [(normalized_path, file_bytes)]
    """
    valid_files: List[Tuple[str, bytes]] = []
    skipped_files: List[str] = []
    errors: List[str] = []

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            infolist = zf.infolist()
            if len(infolist) > MAX_ARCHIVE_FILE_COUNT:
                errors.append(
                    t("Archive contains too many files ({p0}). Limit is {p1}.", p0=len(infolist), p1=MAX_ARCHIVE_FILE_COUNT)
                )
                return [], [], errors

            total_uncompressed = sum(info.file_size for info in infolist)
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES:
                errors.append(
                    t(
                        "Archive uncompressed size is too large ({p0} MB). Limit is {p1} MB.",
                        p0=round(total_uncompressed / (1024 * 1024), 1),
                        p1=round(MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)),
                    )
                )
                return [], [], errors

            # Find potential top-level wrapper directory (e.g., all files start with "MyFolder/")
            first_parts = set()
            non_empty_paths = [info.filename for info in infolist if not info.is_dir()]
            for name in non_empty_paths:
                clean = name.replace("\\", "/").strip().lstrip("/")
                parts = clean.split("/")
                if len(parts) > 1:
                    first_parts.add(parts[0])
                else:
                    first_parts.add("")

            # If all files share exactly one common root directory, strip it
            wrapper_prefix = ""
            if len(first_parts) == 1 and "" not in first_parts:
                candidate = list(first_parts)[0]
                # Don't strip if the candidate is already a recognizable structural folder (like "feedback" or "submissions")
                if candidate.lower() not in ["feedback", "submissions"]:
                    wrapper_prefix = candidate + "/"

            for info in infolist:
                if info.is_dir():
                    continue

                if is_symlink_zip_info(info):
                    skipped_files.append(f"{info.filename} (symlink rejected)")
                    continue

                # Traversal & invalid path check
                try:
                    clean_path = sanitize_rel_path(info.filename)
                except ValueError as err:
                    errors.append(str(err))
                    continue

                # Strip wrapper prefix if applicable
                if wrapper_prefix and clean_path.startswith(wrapper_prefix):
                    clean_path = clean_path[len(wrapper_prefix):]

                # Check for macOS / OS metadata
                parts = clean_path.split("/")
                filename_lower = parts[-1].lower()

                if any(p.startswith("__MACOSX") for p in parts) or filename_lower in METADATA_FILENAMES:
                    skipped_files.append(clean_path)
                    continue

                # Strictly ignore the submissions/ directory if someone re-packed student submissions
                if clean_path.lower().startswith("submissions/"):
                    skipped_files.append(f"{clean_path} (student submission path ignored)")
                    continue

                try:
                    data = zf.read(info)
                    valid_files.append((clean_path, data))
                except Exception as e:
                    errors.append(f"Failed reading {clean_path}: {e}")

    except zipfile.BadZipFile:
        errors.append(t("The provided file is not a valid ZIP archive."))
    except Exception as e:
        errors.append(f"Error opening ZIP archive: {e}")

    return valid_files, skipped_files, errors


def parse_unit_from_path(
    clean_path: str,
    user_map: Dict[str, SubmissionItem],
    team_map: Dict[str, SubmissionItem],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Attempts to identify the recipient (unit_id, unit_type, raw_id) from the relative path.
    Supported patterns:
    - feedback/team-<id>/... or team-<id>/...
    - feedback/user-<id>/... or user-<id>/...
    - .../<numeric_user_id>/filename (native individual layout)
    """
    parts = clean_path.split("/")
    if len(parts) < 2:
        return None, None, None

    filename = parts[-1]

    # Pattern 1 & 2: Explicit prefix team- or user-
    for part in parts[:-1]:
        part_clean = part.strip()
        if part_clean.lower().startswith("team-"):
            tid = part_clean[5:].strip()
            if tid in team_map or f"team:{tid}" in team_map:
                return f"team:{tid}", "team", tid
            # Fallback check if it's numeric team
            return f"team:{tid}", "team", tid

        if part_clean.lower().startswith("user-"):
            uid = part_clean[5:].strip()
            return f"user:{uid}", "user", uid

    # Pattern 3: Native ILIAS individual layout: .../<numeric_id>/<file>
    parent_dir = parts[-2].strip()
    if parent_dir.isdigit():
        if parent_dir in user_map:
            return f"user:{parent_dir}", "user", parent_dir

    return None, None, None


async def preview_feedback_import(
    exercise_ref_id: str,
    ass_id: str,
    session_id: str,
    file_bytes: bytes,
    client: IliasClient,
) -> FeedbackImportPreviewResponse:
    """
    Parses an uploaded ZIP archive, maps files to assignment units, checks for
    conflicts against ILIAS, stages files on disk, and returns a verified preview snapshot.
    """
    cleanup_stale_staging_dirs()

    # 1. Fetch current submissions for the assignment to verify identities
    subs_resp = await client.get_exercise_submissions(ref_id=exercise_ref_id, ass_id=ass_id)
    submissions = subs_resp.submissions

    user_map: Dict[str, SubmissionItem] = {}
    team_map: Dict[str, SubmissionItem] = {}

    for sub in submissions:
        user_map[str(sub.member_id)] = sub
        if sub.team_id:
            team_map[str(sub.team_id)] = sub
            team_map[f"team:{sub.team_id}"] = sub

    # 2. Inspect ZIP archive
    valid_files, skipped_files, errors = safe_inspect_zip(file_bytes)

    blockers: List[str] = list(errors)
    unmatched_files: List[str] = []
    unmatched_files_data: List[Tuple[str, str, bytes]] = []

    # 3. Check for BetterIlias manifest / metadata files
    manifest_data: Optional[Dict[str, Any]] = None
    files_to_process: List[Tuple[str, bytes]] = []

    for path, data in valid_files:
        filename_lower = path.split("/")[-1].lower()
        if filename_lower in MANIFEST_FILENAMES:
            try:
                manifest_data = json.loads(data.decode("utf-8"))
                skipped_files.append(f"{path} (manifest)")
            except Exception as e:
                errors.append(f"Invalid manifest file {path}: {e}")
        elif filename_lower in METADATA_FILENAMES:
            skipped_files.append(f"{path} (metadata)")
        else:
            files_to_process.append((path, data))

    if manifest_data:
        m_ass_id = str(manifest_data.get("ass_id") or "")
        m_ex_id = str(manifest_data.get("exercise_ref_id") or "")
        if m_ass_id and m_ass_id != str(ass_id):
            blockers.append(
                t(
                    "Manifest assignment ID ({p0}) does not match the active assignment ({p1}).",
                    p0=m_ass_id,
                    p1=ass_id,
                )
            )
        if m_ex_id and m_ex_id != str(exercise_ref_id):
            blockers.append(
                t(
                    "Manifest exercise ID ({p0}) does not match the active exercise ({p1}).",
                    p0=m_ex_id,
                    p1=exercise_ref_id,
                )
            )

    # 4. Map files to units
    unit_files_map: Dict[str, List[Tuple[str, str, bytes]]] = {}  # unit_id -> [(source_path, filename, data)]

    for path, data in files_to_process:
        unit_id, unit_type, raw_id = parse_unit_from_path(path, user_map, team_map)
        filename = path.split("/")[-1]

        if not unit_id:
            unmatched_files.append(path)
            unmatched_files_data.append((path, filename, data))
            continue

        # Check if unit actually belongs to this assignment
        target_sub = None
        if unit_type == "team":
            target_sub = team_map.get(raw_id) or team_map.get(f"team:{raw_id}")
        else:
            target_sub = user_map.get(raw_id)

        if not target_sub:
            unmatched_files.append(f"{path} (ID {raw_id} not found in this assignment)")
            unmatched_files_data.append((path, filename, data))
            continue

        resolved_unit_id = f"team:{target_sub.team_id}" if target_sub.team_id else f"user:{target_sub.member_id}"
        unit_files_map.setdefault(resolved_unit_id, []).append((path, filename, data))

    # 5. Query existing feedback files on ILIAS to detect filename conflicts
    # CRITICAL: Only check units that are actually matched in unit_files_map!
    # Checking all course participants blindly causes ILIAS HTTP 500 errors and overloads sessions.
    existing_feedback_cache: Dict[str, Dict[str, str]] = {}  # unit_id -> {filename: file_id}
    sem = asyncio.Semaphore(5)

    async def fetch_existing_feedback(unit_id: str, sub: SubmissionItem):
        # In ILIAS, if evaluation_by_file_url is not in the submissions table,
        # there are no existing feedback files for this participant on ILIAS.
        # Synthesizing blind URLs for users without active evaluation links can trigger ILIAS 500s.
        if not sub.evaluation_by_file_url and not hasattr(client, "_is_mock"):
            existing_feedback_cache[unit_id] = {}
            return

        async with sem:
            try:
                fb_resp = await client.get_submission_feedback_files(
                    exercise_ref_id=exercise_ref_id,
                    member_id=sub.member_id,
                    ass_id=ass_id,
                    feedback_url=sub.evaluation_by_file_url,
                )
                file_dict = {f.title: f.id for f in fb_resp.files}
                existing_feedback_cache[unit_id] = file_dict
            except Exception as e:
                logger.warning(f"Could not check existing feedback for {unit_id}: {e}")
                existing_feedback_cache[unit_id] = {}

    check_tasks = []
    seen_units = set()
    for uid in unit_files_map.keys():
        if uid in seen_units:
            continue
        seen_units.add(uid)
        sub = team_map.get(uid) if uid.startswith("team:") else user_map.get(uid.split(":")[-1])
        if sub:
            check_tasks.append(fetch_existing_feedback(uid, sub))
        else:
            existing_feedback_cache[uid] = {}

    if check_tasks:
        await asyncio.gather(*check_tasks)

    # 6. Stage files on disk
    # Parallel previews of the same file must never share a staging directory.
    import_id = 'imp_' + secrets.token_urlsafe(24)
    stage_dir = STAGING_ROOT / session_id / import_id
    stage_dir.mkdir(parents=True, exist_ok=True)

    fingerprint_items = []
    preview_units: List[FeedbackUnitImportPreview] = []
    total_files = 0
    total_size = 0
    has_conflicts = False

    for uid, file_tuples in unit_files_map.items():
        sub = team_map.get(uid) if uid.startswith("team:") else user_map.get(uid.split(":")[-1])
        if not sub:
            continue

        unit_folder = stage_dir / uid.replace(":", "_")
        unit_folder.mkdir(parents=True, exist_ok=True)

        existing_files = existing_feedback_cache.get(uid, {})
        import_items: List[FeedbackFileImportItem] = []

        for source_path, filename, data in file_tuples:
            total_files += 1
            size = len(data)
            total_size += size

            file_hash = hashlib.sha256(data).hexdigest()
            fingerprint_items.append((uid, filename, size, file_hash))

            # Write file to disk
            out_file = unit_folder / filename
            out_file.write_bytes(data)

            is_conflict = filename in existing_files
            if is_conflict:
                has_conflicts = True

            import_items.append(
                FeedbackFileImportItem(
                    source_path=source_path,
                    filename=filename,
                    size_bytes=size,
                    is_conflict=is_conflict,
                    existing_file_id=existing_files.get(filename),
                    action="overwrite" if is_conflict else "upload",
                )
            )

        preview_units.append(
            FeedbackUnitImportPreview(
                unit_id=uid,
                member_id=sub.member_id,
                recipient_name=sub.team_name or sub.student_name,
                team_id=sub.team_id,
                assigned_ta_id=sub.assigned_ta_id,
                assigned_ta_name=sub.assigned_ta_name,
                files=import_items,
            )
        )

    # Stage unmatched files as well so manual mapping resolution can reference them
    unmatched_folder = stage_dir / "_unmatched"
    unmatched_files_meta: Dict[str, Dict[str, Any]] = {}
    if unmatched_files_data:
        unmatched_folder.mkdir(parents=True, exist_ok=True)
        for u_path, u_filename, u_data in unmatched_files_data:
            safe_id = hashlib.sha256(u_path.encode("utf-8")).hexdigest()[:12]
            stored_filename = f"{safe_id}_{u_filename}"
            (unmatched_folder / stored_filename).write_bytes(u_data)
            unmatched_files_meta[u_path] = {
                "source_path": u_path,
                "filename": u_filename,
                "stored_filename": stored_filename,
                "size_bytes": len(u_data),
            }

    # Compute snapshot token
    fingerprint_items.sort()
    token_str = f"{exercise_ref_id}:{ass_id}:" + json.dumps(fingerprint_items)
    snapshot_token = hashlib.sha256(token_str.encode("utf-8")).hexdigest()

    existing_feedback_by_unit = {
        uid: list(files_dict.keys())
        for uid, files_dict in existing_feedback_cache.items()
        if files_dict
    }

    # Save metadata manifest in staging dir for commit verification
    staged_manifest = {
        "import_id": import_id,
        "snapshot_token": snapshot_token,
        "exercise_ref_id": exercise_ref_id,
        "ass_id": ass_id,
        "created_at": time.time(),
        "units": [u.model_dump() for u in preview_units],
        "unmatched_files_meta": unmatched_files_meta,
        "existing_feedback_cache": existing_feedback_cache,
    }
    (stage_dir / "meta.json").write_text(json.dumps(staged_manifest), encoding="utf-8")

    return FeedbackImportPreviewResponse(
        staged_import_id=import_id,
        snapshot_token=snapshot_token,
        exercise_ref_id=exercise_ref_id,
        ass_id=ass_id,
        units=preview_units,
        unmatched_files=unmatched_files,
        skipped_files=skipped_files,
        blockers=blockers,
        total_files=total_files,
        total_size_bytes=total_size,
        total_units=len(preview_units),
        has_conflicts=has_conflicts,
        existing_feedback_by_unit=existing_feedback_by_unit,
    )


@coordinated(lambda exercise_ref_id, *args, **kwargs: 'exercise-write:' + exercise_ref_id)
@coordinated(lambda exercise_ref_id, ass_id, *args, **kwargs: 'assignment:' + exercise_ref_id + ':' + ass_id)
@coordinated(lambda exercise_ref_id, ass_id, session_id, request, client: 'feedback:' + session_id + ':' + request.staged_import_id)
@audit('feedback_import')
async def commit_feedback_import(
    exercise_ref_id: str,
    ass_id: str,
    session_id: str,
    request: FeedbackImportCommitRequest,
    client: IliasClient,
) -> FeedbackImportCommitResponse:
    """
    Executes the feedback publication by uploading staged files to ILIAS.
    Verifies the snapshot token before making any writes, handles conflict
    actions (overwrite vs skip vs upload), and cleans up staged files.
    """
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', request.staged_import_id):
        raise ValueError(t("Staged feedback import expired or not found. Please re-upload."))
    stage_dir = STAGING_ROOT / session_id / request.staged_import_id
    meta_path = stage_dir / "meta.json"

    if not stage_dir.exists() or not meta_path.exists():
        raise ValueError(t("Staged feedback import expired or not found. Please re-upload."))

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise ValueError(f"Failed to read staging metadata: {e}")

    # Verify snapshot token
    if meta.get("snapshot_token") != request.snapshot_token:
        raise ValueError(t("Feedback import snapshot token mismatch. Preflight must be re-run."))

    if str(meta.get("exercise_ref_id")) != str(exercise_ref_id) or str(meta.get("ass_id")) != str(ass_id):
        raise ValueError(t("Assignment context mismatch for staged import."))

    # Get submission details for evaluation URLs
    subs_resp = await client.get_exercise_submissions(ref_id=exercise_ref_id, ass_id=ass_id)
    sub_map = {s.member_id: s for s in subs_resp.submissions}
    team_sub_map = {s.team_id: s for s in subs_resp.submissions if s.team_id}

    results: List[FeedbackImportCommitResultItem] = []
    uploaded_count = 0
    skipped_count = 0
    failed_count = 0

    units_data = meta.get("units", [])
    sem = asyncio.Semaphore(4)

    async def upload_file_item(unit: Dict[str, Any], f_item: Dict[str, Any]):
        nonlocal uploaded_count, skipped_count, failed_count
        uid = unit["unit_id"]
        member_id = unit["member_id"]
        filename = f_item["filename"]
        existing_file_id = f_item.get("existing_file_id")

        conflict_key = f"{uid}:{filename}"
        action = request.conflict_actions.get(conflict_key, f_item.get("action", "upload"))

        if action == "skip":
            skipped_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=uid,
                    filename=filename,
                    status="skipped",
                    message=t("Skipped by user choice."),
                )
            )
            return

        # Find target submission for evaluation URL
        sub = team_sub_map.get(unit.get("team_id")) if unit.get("team_id") else sub_map.get(member_id)
        feedback_url = sub.evaluation_by_file_url if sub else None

        unit_folder = stage_dir / uid.replace(":", "_")
        file_path = unit_folder / filename

        if not file_path.exists():
            failed_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=uid,
                    filename=filename,
                    status="failed",
                    message="Staged file missing on disk.",
                )
            )
            return

        file_bytes = file_path.read_bytes()

        async with sem:
            try:
                # If overwrite and existing file ID is present, delete existing file first
                if action == "overwrite" and existing_file_id:
                    try:
                        await client.delete_submission_feedback_file(
                            exercise_ref_id=exercise_ref_id,
                            member_id=member_id,
                            file_id=existing_file_id,
                            ass_id=ass_id,
                            feedback_url=feedback_url,
                        )
                    except Exception as del_err:
                        logger.warning(f"Could not delete existing file {existing_file_id}: {del_err}")

                # Upload feedback file to ILIAS
                await client.upload_submission_feedback_file(
                    exercise_ref_id=exercise_ref_id,
                    member_id=member_id,
                    filename=filename,
                    file_bytes=file_bytes,
                    ass_id=ass_id,
                    feedback_url=feedback_url,
                )
                uploaded_count += 1
                results.append(
                    FeedbackImportCommitResultItem(
                        unit_id=uid,
                        filename=filename,
                        status="success",
                        message=t("Uploaded successfully."),
                    )
                )
            except Exception as e:
                failed_count += 1
                results.append(
                    FeedbackImportCommitResultItem(
                        unit_id=uid,
                        filename=filename,
                        status="failed",
                        message=str(e),
                    )
                )

    upload_tasks = []
    for u in units_data:
        for f in u.get("files", []):
            upload_tasks.append(upload_file_item(u, f))

    if upload_tasks:
        await asyncio.gather(*upload_tasks)

    # Process any manual mappings for previously unmatched files
    manual_mappings = request.manual_mappings or {}
    unmatched_meta = meta.get("unmatched_files_meta", {})
    unmatched_folder = stage_dir / "_unmatched"

    async def upload_manual_item(source_path: str, target_unit_id: str):
        nonlocal uploaded_count, skipped_count, failed_count
        file_info = unmatched_meta.get(source_path)
        if not file_info:
            failed_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=target_unit_id,
                    filename=source_path.split("/")[-1],
                    status="failed",
                    message=t("Unmatched file not found in staging metadata."),
                )
            )
            return

        filename = file_info["filename"]
        stored_file = unmatched_folder / file_info["stored_filename"]
        if not stored_file.exists():
            failed_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=target_unit_id,
                    filename=filename,
                    status="failed",
                    message=t("Staged file not found on disk."),
                )
            )
            return

        sub = None
        if target_unit_id.startswith("team:"):
            sub = team_sub_map.get(target_unit_id[5:])
        else:
            raw_uid = target_unit_id.split(":")[-1]
            sub = sub_map.get(raw_uid)

        if not sub:
            failed_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=target_unit_id,
                    filename=filename,
                    status="failed",
                    message=t("Recipient not found in assignment."),
                )
            )
            return

        # Check conflict action for this manually mapped file
        conflict_key = f"{target_unit_id}:{filename}"
        action = request.conflict_actions.get(conflict_key, "overwrite")

        if action == "skip":
            skipped_count += 1
            results.append(
                FeedbackImportCommitResultItem(
                    unit_id=target_unit_id,
                    filename=filename,
                    status="skipped",
                    message=t("Skipped by user choice."),
                )
            )
            return

        file_bytes = stored_file.read_bytes()
        feedback_url = sub.evaluation_by_file_url

        # Check existing file deletion if action is overwrite
        existing_cache = meta.get("existing_feedback_cache", {})
        unit_existing = existing_cache.get(target_unit_id, {})
        existing_file_id = unit_existing.get(filename)

        async with sem:
            try:
                # If overwrite chosen but file ID not in staging cache, check ILIAS on demand
                if action == "overwrite" and not existing_file_id and feedback_url:
                    try:
                        fb_resp = await client.get_submission_feedback_files(
                            exercise_ref_id=exercise_ref_id,
                            member_id=sub.member_id,
                            ass_id=ass_id,
                            feedback_url=feedback_url,
                        )
                        for ef in fb_resp.files:
                            if ef.title == filename:
                                existing_file_id = ef.id
                                break
                    except Exception as chk_err:
                        logger.warning(f"Could not inspect feedback files for {target_unit_id} before overwrite: {chk_err}")

                if action == "overwrite" and existing_file_id:
                    try:
                        await client.delete_submission_feedback_file(
                            exercise_ref_id=exercise_ref_id,
                            member_id=sub.member_id,
                            file_id=existing_file_id,
                            ass_id=ass_id,
                            feedback_url=feedback_url,
                        )
                    except Exception as del_err:
                        logger.warning(f"Could not delete existing feedback file {existing_file_id} for {target_unit_id}: {del_err}")

                # Upload feedback file to ILIAS
                await client.upload_submission_feedback_file(
                    exercise_ref_id=exercise_ref_id,
                    member_id=sub.member_id,
                    filename=filename,
                    file_bytes=file_bytes,
                    ass_id=ass_id,
                    feedback_url=feedback_url,
                )
                uploaded_count += 1
                results.append(
                    FeedbackImportCommitResultItem(
                        unit_id=target_unit_id,
                        filename=filename,
                        status="success",
                        message=t("Uploaded successfully via manual mapping."),
                    )
                )
            except Exception as e:
                failed_count += 1
                results.append(
                    FeedbackImportCommitResultItem(
                        unit_id=target_unit_id,
                        filename=filename,
                        status="failed",
                        message=str(e),
                    )
                )

    manual_tasks = []
    for s_path, t_uid in manual_mappings.items():
        if t_uid:
            manual_tasks.append(upload_manual_item(s_path, t_uid))

    if manual_tasks:
        await asyncio.gather(*manual_tasks)

    # Clean up staging directory
    try:
        shutil.rmtree(stage_dir, ignore_errors=True)
    except Exception as e:
        logger.warning(f"Failed to remove staging directory {stage_dir}: {e}")

    total_ops = len(upload_tasks) + len(manual_tasks)
    return FeedbackImportCommitResponse(
        success=failed_count == 0 and (uploaded_count > 0 or skipped_count > 0),
        total_processed=total_ops,
        uploaded_count=uploaded_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        results=results,
        message=t(
            "Successfully uploaded {p0} feedback files ({p1} skipped, {p2} failed).",
            p0=uploaded_count,
            p1=skipped_count,
            p2=failed_count,
        ),
    )

