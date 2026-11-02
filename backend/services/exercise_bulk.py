import asyncio
import io
import json
import logging
import re
import urllib.parse
import zipfile
from typing import Any, Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.i18n import t
from backend.scrapers.forms import extract_grading_form, verify_grading_success
from backend.schemas import SubmissionItem
from backend.services.ta_allocation import MAX_NOTICE_LENGTH

logger = logging.getLogger(__name__)

def build_bulk_note_payload(
    form_html: str,
    target_updates: List[Tuple[str, str, str, Optional[str]]],
    # target_updates: list of (member_id, new_notice, existing_status, existing_mark)
) -> Tuple[str, bytes]:
    """
    Builds URL-encoded bytes body for an HTTP POST to cmd[saveStatusAll].
    
    Safety guarantees:
    - Retains ALL CSRF tokens, rtoken, and structural hidden inputs.
    - Preserves repeated inputs (listed_part_ids[], sel_part_ids[]).
    - Echos existing status[id] and mark[id] for every targeted participant
      so ILIAS does NOT revert graded work to 'not graded' / None.
    - Encodes as application/x-www-form-urlencoded bytes to prevent httpx AsyncClient errors.
    """
    form_data = extract_grading_form(form_html)
    soup = BeautifulSoup(form_html, "lxml")

    # Locate main form
    form = (
        soup.find("form", id=re.compile(r"form_exc_mem|exc_mem", re.I))
        or soup.find("form", action=re.compile(r"ilExerciseManagementGUI", re.I))
        or soup.find("form")
    )
    if not form:
        raise ValueError("Grading form element not found")

    action_url = form_data.action_url

    payload_pairs: List[Tuple[str, str]] = []
    
    # 1. Copy hidden fields from raw_hidden_fields, skipping existing listed_part_ids and sel_part_ids
    for k, v in form_data.raw_hidden_fields:
        if k in ["listed_part_ids[]", "sel_part_ids[]"]:
            continue
        payload_pairs.append((k, v))

    # 2. Add targeted updates
    for member_id, new_notice, existing_status, existing_mark in target_updates:
        m_str = str(member_id)
        payload_pairs.append(("listed_part_ids[]", m_str))
        payload_pairs.append(("sel_part_ids[]", m_str))

        if len(new_notice) > MAX_NOTICE_LENGTH:
            raise ValueError(f"Notice for member {m_str} exceeds {MAX_NOTICE_LENGTH} characters.")
        payload_pairs.append((f"notice[{m_str}]", new_notice))

        # Echo status[<member_id>]
        ilias_status = "notgraded"
        if existing_status == "passed":
            ilias_status = "passed"
        elif existing_status == "failed":
            ilias_status = "failed"
        elif existing_status in ["not_graded", "notgraded"]:
            ilias_status = "notgraded"
        
        payload_pairs.append((f"status[{m_str}]", ilias_status))

        # Echo mark[<member_id>]
        if existing_mark is not None and existing_mark != "-":
            payload_pairs.append((f"mark[{m_str}]", str(existing_mark)))

    # 3. Set save commands
    payload_pairs.append(("cmd[saveStatusAll]", "Save All"))
    payload_pairs.append(("select_cmd", "saveStatusSelected"))

    # Encode to bytes
    encoded_body = urllib.parse.urlencode(payload_pairs).encode("utf-8")
    return action_url, encoded_body


async def create_submissions_zip_bundle(
    assignment_title: str,
    exercise_ref_id: str,
    ass_id: str,
    submissions: List[SubmissionItem],
    http_client: httpx.AsyncClient,
) -> Tuple[bytes, bool, List[str]]:
    """
    Creates an export ZIP archive containing:
    - betterilias-feedback.json manifest with canonical IDs and mappings
    - submissions/team-<id>/ or submissions/user-<id>/ containing downloaded student files
    - feedback/team-<id>/ or feedback/user-<id>/ directory placeholders for return feedback
    
    Deduplicates team files so team submissions are not downloaded multiple times.
    Validates download responses to reject HTML error/login pages.
    Returns (zip_bytes, is_complete, failure_messages).
    """
    zip_buffer = io.BytesIO()
    failed_downloads: List[str] = []

    manifest: Dict[str, Any] = {
        "format": "betterilias-feedback-v1",
        "exercise_ref_id": exercise_ref_id,
        "assignment_id": ass_id,
        "assignment_title": assignment_title,
        "status": "complete",
        "units": [],
    }

    # Deduplicate submissions by unit_id to prevent duplicate team downloads
    seen_units = set()
    unique_submissions: List[SubmissionItem] = []
    for sub in submissions:
        uid = f"team:{sub.team_id}" if sub.team_id else f"user:{sub.member_id}"
        if uid not in seen_units:
            seen_units.add(uid)
            unique_submissions.append(sub)

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        download_tasks = []
        for sub in unique_submissions:
            unit_folder = f"team-{sub.team_id}" if sub.team_id else f"user-{sub.member_id}"
            unit_info = {
                "unit_id": f"team:{sub.team_id}" if sub.team_id else f"user:{sub.member_id}",
                "member_id": sub.member_id,
                "student_name": sub.student_name,
                "team_id": sub.team_id,
                "assigned_ta_id": sub.assigned_ta_id,
                "assigned_ta_name": sub.assigned_ta_name,
                "submission_path": f"submissions/{unit_folder}/",
                "feedback_path": f"feedback/{unit_folder}/",
                "files": [],
                "missing_files": [],
            }
            manifest["units"].append(unit_info)

            # Create feedback placeholder folder in zip with instructions in the .keep file
            keep_explanation = (
                "# Feedback-Ordner fuer diese Einheit / Feedback folder for this unit\n"
                "# -------------------------------------------------------------------\n"
                "# Legen Sie Ihre Korrektur- oder Feedbackdateien (z.B. PDF, DOCX, Code) hier ab.\n"
                "# Diese .keep-Datei dient nur als Platzhalter fuer leere Ordner und wird ignoriert.\n"
                "# Place your review/feedback files here. This .keep file is just a placeholder and will be ignored.\n"
            )
            zf.writestr(f"feedback/{unit_folder}/.keep", keep_explanation)

            # Queue submitted files for bounded concurrent download
            for sf in sub.files:
                if sf.download_url:
                    download_tasks.append((unit_folder, unit_info, sub.student_name, sf.filename, sf.download_url))

        # Bounded concurrent download workers
        semaphore = asyncio.Semaphore(5)

        async def fetch_file(unit_folder, unit_info, student_name, filename, dl_url):
            async with semaphore:
                try:
                    resp = await http_client.get(dl_url, follow_redirects=True)
                    if resp.status_code >= 400:
                        return False, unit_info, filename, f"HTTP {resp.status_code} for {filename} ({student_name})", None, None

                    # Verify not an HTML login or error page
                    content_type = resp.headers.get("content-type", "").lower()
                    content_disp = resp.headers.get("content-disposition", "").lower()
                    if "text/html" in content_type and "attachment" not in content_disp:
                        return False, unit_info, filename, f"Invalid HTML response (likely session expired) for {filename} ({student_name})", None, None

                    file_path = f"submissions/{unit_folder}/{filename}"
                    return True, unit_info, filename, None, file_path, resp.content
                except Exception as e:
                    return False, unit_info, filename, f"Error downloading {filename} ({student_name}): {str(e)}", None, None

        if download_tasks:
            results = await asyncio.gather(*(fetch_file(*task) for task in download_tasks))
            for ok, u_info, fn, err_msg, f_path, content in results:
                if ok and f_path and content is not None:
                    zf.writestr(f_path, content)
                    u_info["files"].append(fn)
                else:
                    if err_msg:
                        failed_downloads.append(err_msg)
                    u_info["missing_files"].append(fn)

        if failed_downloads:
            manifest["status"] = "partial"
            manifest["failed_downloads"] = failed_downloads
            error_log = "The following files could not be downloaded successfully from ILIAS:\n\n"
            error_log += "\n".join(f"- {msg}" for msg in failed_downloads)
            zf.writestr("DOWNLOAD_FAILURES.txt", error_log)

        # Instructions file
        instructions_text = (
            "BetterIlias Feedback Workflow\n"
            "=============================\n\n"
            "DEUTSCH:\n"
            "1. Finden Sie den jeweiligen Studierenden- oder Gruppen-Ordner unter 'feedback/'.\n"
            "2. Legen Sie Ihre Rueckmeldungsdateien (z.B. PDF, Word, Code) direkt in diesen Ordner.\n"
            "3. Zippen Sie diesen Ordner wieder und laden Sie die ZIP-Datei in BetterIlias ueber 'Feedback hochladen' hoch.\n"
            "4. Das Manifest (betterilias-feedback.json), Platzhalter (.keep) und Anleitungen werden beim Import automatisch ignoriert.\n\n"
            "ENGLISH:\n"
            "1. Locate the student or team folder under 'feedback/'.\n"
            "2. Place your feedback files (e.g. PDF, Word, code) directly into that folder.\n"
            "3. Zip this folder again and upload the ZIP archive in BetterIlias via 'Upload feedback'.\n"
            "4. The manifest file (betterilias-feedback.json), placeholder files (.keep) and instructions are automatically ignored.\n"
        )
        zf.writestr("INSTRUCTIONS.txt", instructions_text)

        # Write manifest file
        zf.writestr("betterilias-feedback.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    zip_buffer.seek(0)
    return zip_buffer.getvalue(), len(failed_downloads) == 0, failed_downloads
