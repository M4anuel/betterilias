from datetime import datetime
import pytest
from backend.services.semester_utils import (
    get_current_semester,
    get_next_semester,
    get_previous_semester,
    generate_semester_list,
    parse_semester_id,
    semester_order_key,
)


def test_semester_parsing_and_ordering():
    assert parse_semester_id("HS2026") == ("HS", 2026)
    assert parse_semester_id("fs 2024") == ("FS", 2024)
    assert parse_semester_id("invalid") is None

    assert semester_order_key("FS2026") < semester_order_key("HS2026")
    assert semester_order_key("HS2026") < semester_order_key("FS2027")
    assert semester_order_key("FS2027") < semester_order_key("HS2027")


def test_unibe_semester_transition_dates():
    # Autumn semester in October
    d1 = datetime(2026, 10, 25)
    assert get_current_semester(d1) == "HS2026"

    # Autumn semester continuation into January
    d2 = datetime(2027, 1, 15)
    assert get_current_semester(d2) == "HS2026"

    # Last day before spring semester: Feb 14
    d3 = datetime(2027, 2, 14, 23, 59)
    assert get_current_semester(d3) == "HS2026"

    # First day of spring semester (after 2nd week of Feb): Feb 15
    d4 = datetime(2027, 2, 15, 0, 1)
    assert get_current_semester(d4) == "FS2027"

    # Middle of spring semester: June
    d5 = datetime(2027, 6, 20)
    assert get_current_semester(d5) == "FS2027"

    # Last day before autumn semester: Sep 14
    d6 = datetime(2027, 9, 14, 23, 59)
    assert get_current_semester(d6) == "FS2027"

    # First day of autumn semester (after 2nd week of Sep): Sep 15
    d7 = datetime(2027, 9, 15, 0, 1)
    assert get_current_semester(d7) == "HS2027"


def test_next_and_previous_semesters():
    assert get_next_semester("HS2026") == "FS2027"
    assert get_next_semester("FS2027") == "HS2027"

    assert get_previous_semester("HS2027") == "FS2027"
    assert get_previous_semester("FS2027") == "HS2026"
    assert get_previous_semester("HS2026") == "FS2026"


def test_generate_semester_list():
    # If current is HS2026, preview is FS2027, 5 years back is HS2021
    sem_list = generate_semester_list(target_sem="HS2026", current_sem="HS2026", min_years_back=5)
    assert sem_list[0] == "FS2027"  # preview
    assert "HS2026" in sem_list
    assert "HS2021" in sem_list
    assert len(sem_list) == 12  # preview (1) + current (1) + 10 past = 12

    # If user requests older semester, list extends to it
    older_list = generate_semester_list(target_sem="HS2018", current_sem="HS2026", min_years_back=5)
    assert older_list[0] == "FS2027"
    assert "HS2018" in older_list
    assert older_list[-1] == "HS2018"

