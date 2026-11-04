import os
import pytest
from backend.services.ta_allocation import (
    TAInfo,
    AllocationItem,
    parse_ta_marker,
    format_ta_marker,
    distribute_units,
    compute_distribution_fingerprint,
    MAX_NOTICE_LENGTH,
)
from backend.services.exercise_bulk import build_bulk_note_payload

def test_parse_and_format_ta_marker():
    ta_id, ta_name, clean = parse_ta_marker("Very good submission!")
    assert ta_id is None
    assert ta_name is None
    assert clean == "Very good submission!"

    formatted = format_ta_marker("Very good submission!", "ta1", "Ada")
    assert formatted == "Very good submission! [BI:ta1|Ada]"
    assert len(formatted) <= MAX_NOTICE_LENGTH

    ta_id, ta_name, clean = parse_ta_marker(formatted)
    assert ta_id == "ta1"
    assert ta_name == "Ada"
    assert clean == "Very good submission!"

def test_distribute_units_quotas_and_remainders():
    items = [
        AllocationItem(
            unit_id=f"team:{i}",
            member_id=str(1000 + i),
            student_name=f"Student {i}",
            submission_status="submitted",
        )
        for i in range(10)
    ]
    assistants = [
        TAInfo(id="ta1", name="TA 1"),
        TAInfo(id="ta2", name="TA 2"),
        TAInfo(id="ta3", name="TA 3"),
    ]
    priority = ["ta2", "ta1", "ta3"]

    distributed = distribute_units(items, assistants, priority)
    assert len(distributed) == 10

    asst_map = {a.id: a.quota for a in assistants}
    assert asst_map["ta2"] == 4
    assert asst_map["ta1"] == 3
    assert asst_map["ta3"] == 3

    assigned_ids = [item.assigned_ta_id for item in distributed]
    assert assigned_ids == ["ta2", "ta2", "ta2", "ta2", "ta1", "ta1", "ta1", "ta3", "ta3", "ta3"]

def test_compute_distribution_fingerprint():
    fp1 = compute_distribution_fingerprint(["1", "2"], ["note1", "note2"])
    fp2 = compute_distribution_fingerprint(["1", "2"], ["note1", "note2"])
    fp3 = compute_distribution_fingerprint(["1", "2"], ["note1", "note_changed"])
    assert fp1 == fp2
    assert fp1 != fp3

def test_build_bulk_note_payload_encoded_bytes():
    fixture_path = os.path.join("tests", "fixtures", "evaluation_by_file", "submissions_and_grades_view.html")
    with open(fixture_path, "r", encoding="utf-8") as f:
        html = f.read()

    targets = [
        ("3216297", "Good job [BI:ta1|Ada]", "passed", "5.5"),
        ("9999999", "Needs review [BI:ta2|Bob]", "not_graded", None),
    ]

    action_url, encoded_bytes = build_bulk_note_payload(html, targets)
    assert isinstance(encoded_bytes, bytes)
    body_str = encoded_bytes.decode("utf-8")

    # Verify form-encoded repeated keys
    assert "listed_part_ids%5B%5D=3216297" in body_str
    assert "listed_part_ids%5B%5D=9999999" in body_str
    assert "status%5B3216297%5D=passed" in body_str
    assert "status%5B9999999%5D=notgraded" in body_str
    assert "mark%5B3216297%5D=5.5" in body_str
    assert "cmd%5BsaveStatusAll%5D=Save+All" in body_str


def test_format_ta_marker_refuses_to_truncate_human_notes():
    # Long existing note that would exceed 200 chars with marker
    long_note = "A" * 195
    with pytest.raises(ValueError, match='200'):
        format_ta_marker(long_note, 'ta1', 'VeryLongAssistantName')
    assert long_note == 'A' * 195

def test_distribute_units_more_tas_than_units():
    # 2 units, 5 TAs
    items = [
        AllocationItem(unit_id=f"team:{i}", member_id=str(100 + i), student_name=f"Student {i}", submission_status="submitted")
        for i in range(2)
    ]
    assistants = [
        TAInfo(id=f"ta{i}", name=f"TA {i}")
        for i in range(1, 6)
    ]
    priority = [f"ta{i}" for i in range(1, 6)]

    distributed = distribute_units(items, assistants, priority)
    assert len(distributed) == 2
    quotas = {a.id: a.quota for a in assistants}
    assert quotas["ta1"] == 1
    assert quotas["ta2"] == 1
    assert quotas["ta3"] == 0
    assert quotas["ta4"] == 0
    assert quotas["ta5"] == 0
