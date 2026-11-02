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
        feedback_url=None,
    )

    # Verify upload was called for both
    assert mock_client.upload_submission_feedback_file.call_count == 2
