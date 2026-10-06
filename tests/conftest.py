from pathlib import Path
import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def dashboard_html():
    return (FIXTURES_DIR / "dashboard.html").read_text(encoding="utf-8")


@pytest.fixture
def course_materials_html():
    return (FIXTURES_DIR / "course_materials.html").read_text(encoding="utf-8")


@pytest.fixture
def exercise_submissions_html():
    return (FIXTURES_DIR / "exercise_submissions.html").read_text(encoding="utf-8")


@pytest.fixture
def grading_form_html():
    return (FIXTURES_DIR / "grading_form.html").read_text(encoding="utf-8")

