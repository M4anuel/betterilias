import pytest
from backend.scrapers.dashboard import parse_dashboard
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.submissions import parse_exercise_submissions
from backend.scrapers.forms import extract_grading_form, verify_grading_success


def test_parse_dashboard(dashboard_html):
    courses = parse_dashboard(dashboard_html)
    assert len(courses) == 3

    c1 = courses[0]
    assert c1.ref_id == "123456"
    assert "Einführung in die Programmierung" in c1.title
    assert c1.item_type == "crs"
    assert "Vorlesung und Übungen" in c1.description

    c2 = courses[1]
    assert c2.ref_id == "234567"
    assert "Datenbanksysteme II" in c2.title

    c3 = courses[2]
    assert c3.ref_id == "345678"
    assert "Tutorium Gruppe 3" in c3.title
    assert c3.item_type == "grp"


def test_parse_course_materials(course_materials_html):
    res = parse_course_materials(course_materials_html, container_ref_id="123456")
    assert "Einführung in die Programmierung" in res.title
    assert len(res.breadcrumbs) == 3
    assert res.breadcrumbs[0].title == "Magazin"

    assert len(res.items) == 3

    # Folder
    f = res.items[0]
    assert f.ref_id == "99001"
    assert f.item_type == "fold"
    assert f.title == "Vorlesungsunterlagen"

    # File
    file_item = res.items[1]
    assert file_item.ref_id == "99002"
    assert file_item.item_type == "file"
    assert file_item.title == "Syllabus_2026.pdf"
    assert file_item.file_size == "1.4 MB"

    # Exercise
    exc = res.items[2]
    assert exc.ref_id == "99003"
    assert exc.item_type == "exc"
    assert "Übungsblatt 01" in exc.title


def test_parse_exercise_submissions(exercise_submissions_html):
    res = parse_exercise_submissions(exercise_submissions_html, exercise_ref_id="99003")
    assert res.exercise.ref_id == "99003"
    assert "Übungsblatt 01" in res.exercise.title
    assert res.exercise.total_participants == 3
    assert res.exercise.submitted_count == 2
    assert res.exercise.graded_count == 1

    # Student 1 (Muster, Anna)
    s1 = res.submissions[0]
    assert "Muster, Anna" in s1.student_name
    assert s1.login == "amuster"
    assert s1.submission_status == "submitted"
    assert len(s1.files) == 1
    assert s1.files[0].filename == "solution_anna.py"
    assert s1.passed_status == "passed"
    assert s1.mark == "6.0"
    assert "Hervorragende Implementierung" in s1.feedback

    # Student 2 (Meier, Beat)
    s2 = res.submissions[1]
    assert "Meier, Beat" in s2.student_name
    assert s2.submission_status == "submitted"
    assert s2.passed_status == "not_graded"

    # Student 3 (Schmidt, Claudia)
    s3 = res.submissions[2]
    assert "Schmidt, Claudia" in s3.student_name
    assert s3.submission_status == "not_submitted"
    assert len(s3.files) == 0


def test_extract_grading_form(grading_form_html):
    form_data = extract_grading_form(grading_form_html, member_id="102")
    assert "saveStatusParticipant" in form_data.action_url
    assert form_data.hidden_fields.get("rtoken") == "secret_csrf_token_999"
    assert form_data.hidden_fields.get("cmdNode") == "w4:vk"
    assert form_data.hidden_fields.get("part_id") == "102"
    assert form_data.mark_field_name == "mark"
    assert form_data.status_field_name == "status"
    assert form_data.feedback_field_name == "feedback"


def test_verify_grading_success():
    success_html = """
    <div class="ilSystemMessage alert alert-success">
        Änderungen erfolgreich gespeichert.
    </div>
    """
    ok, msg = verify_grading_success(success_html)
    assert ok is True
    assert "erfolgreich" in msg

    fail_html = """
    <div class="ilSystemMessage alert alert-danger">
        Fehler beim Speichern: Ungültige Eingabe.
    </div>
    """
    ok2, msg2 = verify_grading_success(fail_html)
    assert ok2 is False
    assert "Fehler" in msg2

