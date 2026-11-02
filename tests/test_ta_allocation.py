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
    # Clean notice with no marker
    ta_id, ta_name, clean = parse_ta_marker("Very good submission!")
    assert ta_id is None
    assert ta_name is None
    assert clean == "Very good submission!"

    # Notice with existing marker
    formatted = format_ta_marker("Very good submission!", "ta1", "Ada")
    assert formatted == "Very good submission! [BI:ta1|Ada]"
    assert len(formatted) <= MAX_NOTICE_LENGTH

    # Parse formatted marker back
    ta_id, ta_name, clean = parse_ta_marker(formatted)
    assert ta_id == "ta1"
    assert ta_name == "Ada"
    assert clean == "Very good submission!"

    # Empty original notice
    formatted_empty = format_ta_marker("", "ta2", "Bob")
    assert formatted_empty == "[BI:ta2|Bob]"
    ta_id2, ta_name2, clean2 = parse_ta_marker(formatted_empty)
    assert ta_id2 == "ta2"
    assert ta_name2 == "Bob"
    assert clean2 == ""

def test_distribute_units_quotas_and_remainders():
    # 10 units, 3 assistants, priority order: ta2 -> ta1 -> ta3
    # Quotas must be: ta2 receives 4, ta1 receives 3, ta3 receives 3.
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

    # Check quotas
    asst_map = {a.id: a.quota for a in assistants}
    assert asst_map["ta2"] == 4
    assert asst_map["ta1"] == 3
    assert asst_map["ta3"] == 3

    # Check contiguous assignment order
    assigned_ids = [item.assigned_ta_id for item in distributed]
    assert assigned_ids == ["ta2", "ta2", "ta2", "ta2", "ta1", "ta1", "ta1", "ta3", "ta3", "ta3"]

def test_compute_distribution_fingerprint():
    fp1 = compute_distribution_fingerprint(["1", "2"], ["note1", "note2"])
    fp2 = compute_distribution_fingerprint(["1", "2"], ["note1", "note2"])
    fp3 = compute_distribution_fingerprint(["1", "2"], ["note1", "note_changed"])
    assert fp1 == fp2
    assert fp1 != fp3

def test_build_bulk_note_payload_preserves_status_and_repeated_keys():
    fixture_path = os.path.join("tests", "fixtures", "evaluation_by_file", "submissions_and_grades_view.html")
    with open(fixture_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Targets: 2 participants (e.g. 3216297 with status 'passed' and mark '5.5')
    targets = [
        ("3216297", "Good job [BI:ta1|Ada]", "passed", "5.5"),
        ("9999999", "Needs review [BI:ta2|Bob]", "not_graded", None),
    ]

    action_url, payload = build_bulk_note_payload(html, targets)
    assert "saveStatusAll" in action_url or "cmd=post" in action_url

    # Convert payload to dict of lists to verify repeated keys
    payload_dict = {}
    for k, v in payload:
        payload_dict.setdefault(k, []).append(v)

    # Verify listed_part_ids[] contains both members
    assert "listed_part_ids[]" in payload_dict
    assert "3216297" in payload_dict["listed_part_ids[]"]
    assert "9999999" in payload_dict["listed_part_ids[]"]

    # Verify status[id] is echoed safely (preventing grade resets!)
    assert payload_dict.get("status[3216297]") == ["passed"]
    assert payload_dict.get("status[9999999]") == ["notgraded"]

    # Verify mark[id] is echoed
    assert payload_dict.get("mark[3216297]") == ["5.5"]
    assert "mark[9999999]" not in payload_dict

    # Verify notice[id] has marker
    assert payload_dict.get("notice[3216297]") == ["Good job [BI:ta1|Ada]"]
    assert payload_dict.get("notice[9999999]") == ["Needs review [BI:ta2|Bob]"]

    # Verify command
    assert payload_dict.get("cmd[saveStatusAll]") == ["Save All"]
