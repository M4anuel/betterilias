import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from backend.main import app
from backend.scrapers.exercise_editor import (
    parse_ta_assignments_list,
    parse_ta_assignment_form,
    parse_instruction_files,
)
from backend.schemas import (
    TAAssignmentListResponse,
    TAAssignmentListItem,
    TAAssignmentDetailResponse,
    TAInstructionFileItem,
)

DUMP_DIR = Path(r"C:\Users\manue\Downloads\betterilias\betterilias\htmlfromilias\CreateExercises")

def test_parse_ta_assignments_list():
    dump_file = DUMP_DIR / "edit view of exercises.html"
    if not dump_file.exists():
        pytest.skip("Dump file not found")

    html = dump_file.read_text(encoding="utf-8", errors="ignore")
    parsed = parse_ta_assignments_list(html, exercise_ref_id="2978156")

    assert parsed.exercise_ref_id == "2978156"
    assert len(parsed.assignments) == 12
    first = parsed.assignments[0]
    assert first.ass_id == "37179"
    assert "bung 1" in first.title or "Übung 1" in first.title
    assert first.order_val == 10
    assert first.type_name == "Team Upload"
    assert first.type_id == 4
    assert first.mandatory is True


def test_parse_ta_assignment_form():
    dump_file = DUMP_DIR / "add_assignment_type_upload.html"
    if not dump_file.exists():
        pytest.skip("Dump file not found")

    html = dump_file.read_text(encoding="utf-8", errors="ignore")
    parsed = parse_ta_assignment_form(html, exercise_ref_id="2978156", ass_id=None)

    assert parsed.exercise_ref_id == "2978156"
    assert parsed.type_id == 1
    assert parsed.rtoken is not None
    assert "ilfilehash" in parsed.hidden_inputs
    assert "rmd_submit_template_id" not in parsed.hidden_inputs
    assert "fb_date" not in parsed.hidden_inputs


def test_parse_instruction_files():
    dump_file = DUMP_DIR / "created_exercise_instruction_files_page_with_file.html"
    if not dump_file.exists():
        pytest.skip("Dump file not found")

    html = dump_file.read_text(encoding="utf-8", errors="ignore")
    files = parse_instruction_files(html)

    assert len(files) >= 1
    assert "05-conditional-handout.pdf" in files[0].filename


def test_api_ta_assignments():
    client = TestClient(app)
    mock_list = TAAssignmentListResponse(
        exercise_ref_id="2978156",
        assignments=[
            TAAssignmentListItem(
                ass_id="101",
                title="Test Assignment 1",
                order_val=10,
                type_name="File",
                type_id=1,
                mandatory=True,
            )
        ]
    )

    with patch("backend.api.routes.exercises.IliasClient.get_ta_assignments_list", new_callable=AsyncMock) as m:
        m.return_value = mock_list
        resp = client.get("/api/exercises/2978156/ta/assignments")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["assignments"]) == 1
        assert data["assignments"][0]["title"] == "Test Assignment 1"



def test_api_save_ta_assignment_handles_error():
    client = TestClient(app)
    with patch("backend.api.routes.exercises.IliasClient.save_ta_assignment", new_callable=AsyncMock) as m:
        m.side_effect = ValueError("ILIAS Fehler: Invalid deadline")
        resp = client.post("/api/exercises/2978156/ta/assignment-detail", json={
            "title": "Exercise 1",
            "type_id": 1,
            "mandatory": True,
        })
        assert resp.status_code == 400
        assert "Invalid deadline" in resp.json()["detail"]
