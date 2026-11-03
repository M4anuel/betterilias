import io
import json
import zipfile
import pytest
from unittest.mock import AsyncMock, patch

from backend.schemas import (
    FeedbackFileItem,
    FeedbackFilesResponse,
    FeedbackImportCommitRequest,
    SubmissionItem,
    ExerciseSubmissionsResponse,
    ExerciseInfo,
)
from backend.services.ilias_client import IliasClient
from backend.services.feedback_import import (
    safe_inspect_zip,
    parse_unit_from_path,
    preview_feedback_import,
    commit_feedback_import,
    STAGING_ROOT,
)


def create_test_zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, data in files.items():
            zf.writestr(path, data)
    return buf.getvalue()


def test_safe_inspect_zip_and_wrapper_strip():
    # Test zip with single wrapper folder and metadata
    files = {
        "TA_Feedback/betterilias-feedback.json": b'{"ass_id": "42"}',
        "TA_Feedback/feedback/team-10/feedback.pdf": b"team 10 review",
        "TA_Feedback/feedback/user-20/feedback.pdf": b"user 20 review",
        "TA_Feedback/submissions/team-10/original.pdf": b"student file",  # Should be ignored
        "TA_Feedback/.DS_Store": b"meta",
        "TA_Feedback/__MACOSX/._feedback.pdf": b"meta",
    }
    zip_bytes = create_test_zip(files)
    valid, skipped, errors = safe_inspect_zip(zip_bytes)

    assert len(errors) == 0
    valid_paths = [p for p, _ in valid]

    assert "betterilias-feedback.json" in valid_paths
    assert "feedback/team-10/feedback.pdf" in valid_paths
    assert "feedback/user-20/feedback.pdf" in valid_paths
    # Student submissions should be skipped
    assert not any("submissions" in p for p in valid_paths)
    assert any("submissions" in s for s in skipped)


def test_safe_inspect_zip_path_traversal():
    files = {
        "../etc/passwd": b"evil",
        "feedback/team-10/ok.txt": b"ok",
    }
    zip_bytes = create_test_zip(files)
    valid, skipped, errors = safe_inspect_zip(zip_bytes)
    assert len(errors) > 0
    assert any("traversal" in err.lower() for err in errors)


def test_parse_unit_from_path():
    user_map = {"101": SubmissionItem(member_id="101", student_name="Alice", submission_status="submitted")}
    team_map = {"55": SubmissionItem(member_id="102", student_name="Bob", team_id="55", submission_status="submitted")}

    # Team path
    uid, utype, raw = parse_unit_from_path("feedback/team-55/feedback.pdf", user_map, team_map)
    assert uid == "team:55"
    assert utype == "team"
    assert raw == "55"

    # User path
    uid, utype, raw = parse_unit_from_path("feedback/user-101/review.txt", user_map, team_map)
    assert uid == "user:101"
    assert utype == "user"
    assert raw == "101"

    # Native ILIAS folder pattern
    uid, utype, raw = parse_unit_from_path("il_exc_123/101/evaluation.docx", user_map, team_map)
    assert uid == "user:101"


@pytest.mark.asyncio
async def test_preview_and_commit_feedback_import():
    # Setup mock submissions
    subs = [
        SubmissionItem(
            member_id="101",
            student_name="Student 1",
            team_id="55",
            team_name="Team 55",
            submission_status="submitted",
            evaluation_by_file_url="https://ilias.unibe.ch/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilResourceCollectionGUI&ref_id=999&ass_id=42&member_id=101",
        ),
        SubmissionItem(
            member_id="102",
            student_name="Student 2",
            submission_status="submitted",
        ),
    ]

    mock_client = AsyncMock()
    mock_client.get_exercise_submissions.return_value = ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(ref_id="999", title="Exercise 1"),
        submissions=subs,
    )

    # Return existing feedback on ILIAS for member 101 to simulate conflict
    mock_client.get_submission_feedback_files.return_value = FeedbackFilesResponse(
        member_id="101",
        files=[FeedbackFileItem(id="existing_f1", title="feedback.pdf")],
    )

    # Create ZIP containing feedback for both units
    zip_content = {
        "betterilias-feedback.json": json.dumps({"ass_id": "42", "exercise_ref_id": "999"}).encode("utf-8"),
        "feedback/team-55/feedback.pdf": b"review team 55",  # Has conflict
        "feedback/user-102/solution_review.txt": b"review student 102",  # New
        "feedback/user-999/unknown.txt": b"unknown student",  # Unmatched
    }
    zip_bytes = create_test_zip(zip_content)

    session_id = "test_sess_123"

    # Run preview
    preview = await preview_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        file_bytes=zip_bytes,
        client=mock_client,
    )

    assert preview.exercise_ref_id == "999"
    assert preview.ass_id == "42"
    assert preview.total_files == 2
    assert preview.total_units == 2
    assert len(preview.unmatched_files) == 1
    assert preview.has_conflicts is True

    # Find the conflicting file
    team_unit = next(u for u in preview.units if u.unit_id == "team:55")
    conflict_file = team_unit.files[0]
    assert conflict_file.is_conflict is True
    assert conflict_file.existing_file_id == "existing_f1"

    # Commit with overwrite choice for the conflicting file
    commit_req = FeedbackImportCommitRequest(
        staged_import_id=preview.staged_import_id,
        snapshot_token=preview.snapshot_token,
        conflict_actions={"team:55:feedback.pdf": "overwrite"},
    )

    commit_res = await commit_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        request=commit_req,
        client=mock_client,
    )

    assert commit_res.success is True
    assert commit_res.uploaded_count == 2
    assert commit_res.failed_count == 0

    # Verify that existing file was deleted on overwrite
    mock_client.delete_submission_feedback_file.assert_called_once_with(
        exercise_ref_id="999",
        member_id="101",
        file_id="existing_f1",
        ass_id="42",
        feedback_url="https://ilias.unibe.ch/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilResourceCollectionGUI&ref_id=999&ass_id=42&member_id=101",
    )

    # Verify upload was called for both
    assert mock_client.upload_submission_feedback_file.call_count == 2


@pytest.mark.asyncio
async def test_re_zip_empty_and_feedback_json_manifest_ignored():
    mock_client = AsyncMock(spec=IliasClient)
    mock_client.get_exercise_submissions.return_value = ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(ref_id="999", title="Test"),
        submissions=[
            SubmissionItem(member_id="101", student_name="Alice", submission_status="submitted"),
        ],
    )

    # Simulate re-zipping download package without adding files:
    # only feedback.json / betterilias-feedback.json, submissions/ files, INSTRUCTIONS.txt, and .keep files
    zip_content = {
        "feedback.json": json.dumps({"ass_id": "42", "exercise_ref_id": "999"}).encode("utf-8"),
        "INSTRUCTIONS.txt": b"Instructions",
        "submissions/user-101/solution.py": b"student code",
        "feedback/user-101/.keep": b"# placeholder",
    }
    zip_bytes = create_test_zip(zip_content)

    preview = await preview_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id="test_sess",
        file_bytes=zip_bytes,
        client=mock_client,
    )

    # Nothing should be unmatched or uploaded
    assert preview.total_files == 0
    assert preview.total_units == 0
    assert len(preview.unmatched_files) == 0
    assert "feedback.json" not in preview.unmatched_files
    assert any("feedback.json" in s and "manifest" in s for s in preview.skipped_files)
    assert any(".keep" in s for s in preview.skipped_files)
    assert any("submissions" in s for s in preview.skipped_files)




@pytest.mark.asyncio
async def test_manual_mapping_unmatched_file_upload():
    mock_client = AsyncMock(spec=IliasClient)
    mock_client.get_exercise_submissions.return_value = ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(ref_id="999", title="Test"),
        submissions=[
            SubmissionItem(member_id="101", student_name="Alice", submission_status="submitted"),
            SubmissionItem(member_id="102", student_name="Bob", team_id="55", team_name="Team 55", submission_status="submitted"),
        ],
    )
    mock_client.get_submission_feedback_files.return_value = FeedbackFilesResponse(
        member_id="101",
        files=[],
    )
    mock_client.upload_submission_feedback_file.return_value = (True, "OK", "new_f1")

    # ZIP with flat unmatched file
    zip_content = {
        "RandomName_review.pdf": b"manual review content",
    }
    zip_bytes = create_test_zip(zip_content)
    session_id = "test_manual_sess"

    preview = await preview_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        file_bytes=zip_bytes,
        client=mock_client,
    )

    assert len(preview.unmatched_files) == 1
    assert preview.unmatched_files[0] == "RandomName_review.pdf"
    assert preview.total_files == 0

    # Commit with manual mapping assigning RandomName_review.pdf to Team 55
    commit_req = FeedbackImportCommitRequest(
        staged_import_id=preview.staged_import_id,
        snapshot_token=preview.snapshot_token,
        conflict_actions={},
        manual_mappings={"RandomName_review.pdf": "team:55"},
    )

    commit_res = await commit_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        request=commit_req,
        client=mock_client,
    )

    assert commit_res.success is True
    assert commit_res.uploaded_count == 1
    assert commit_res.failed_count == 0
    assert commit_res.results[0].unit_id == "team:55"
    assert commit_res.results[0].filename == "RandomName_review.pdf"

    mock_client.upload_submission_feedback_file.assert_called_once_with(
        exercise_ref_id="999",
        member_id="102",
        filename="RandomName_review.pdf",
        file_bytes=b"manual review content",
        ass_id="42",
        feedback_url=None,
    )


@pytest.mark.asyncio
async def test_manual_mapping_overwrite_deletes_existing_file():
    mock_client = AsyncMock(spec=IliasClient)
    mock_client.get_exercise_submissions.return_value = ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(ref_id="999", title="Test"),
        submissions=[
            SubmissionItem(
                member_id="102",
                student_name="Bob",
                team_id="55",
                team_name="Team 55",
                submission_status="submitted",
                evaluation_by_file_url="https://ilias.unibe.ch/feedback-102",
            ),
        ],
    )
    # ILIAS returns existing file on-demand for team 55
    mock_client.get_submission_feedback_files.return_value = FeedbackFilesResponse(
        member_id="102",
        files=[FeedbackFileItem(id="old_fid_99", title="RandomName_review.pdf")],
    )

    zip_bytes = create_test_zip({"RandomName_review.pdf": b"new content"})
    session_id = "test_manual_overwrite_sess"

    preview = await preview_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        file_bytes=zip_bytes,
        client=mock_client,
    )

    commit_req = FeedbackImportCommitRequest(
        staged_import_id=preview.staged_import_id,
        snapshot_token=preview.snapshot_token,
        conflict_actions={"team:55:RandomName_review.pdf": "overwrite"},
        manual_mappings={"RandomName_review.pdf": "team:55"},
    )

    commit_res = await commit_feedback_import(
        exercise_ref_id="999",
        ass_id="42",
        session_id=session_id,
        request=commit_req,
        client=mock_client,
    )

    assert commit_res.success is True
    assert commit_res.uploaded_count == 1
    # Verify existing file was deleted prior to upload
    mock_client.delete_submission_feedback_file.assert_called_once_with(
        exercise_ref_id="999",
        member_id="102",
        file_id="old_fid_99",
        ass_id="42",
        feedback_url="https://ilias.unibe.ch/feedback-102",
    )
    mock_client.upload_submission_feedback_file.assert_called_once_with(
        exercise_ref_id="999",
        member_id="102",
        filename="RandomName_review.pdf",
        file_bytes=b"new content",
        ass_id="42",
        feedback_url="https://ilias.unibe.ch/feedback-102",
    )
