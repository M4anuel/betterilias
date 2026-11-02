import re
import urllib.parse
from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.i18n import t
from backend.scrapers.forms import extract_grading_form, verify_grading_success
from backend.schemas import SubmissionItem
from backend.services.ta_allocation import MAX_NOTICE_LENGTH

def build_bulk_note_payload(
    form_html: str,
    target_updates: List[Tuple[str, str, str, Optional[str]]],
    # target_updates: list of (member_id, new_notice, existing_status, existing_mark)
) -> Tuple[str, List[Tuple[str, str]]]:
    """
    Builds a list of (key, value) pairs for an HTTP POST to cmd[saveStatusAll].
    
    Safety guarantees:
    - Retains ALL CSRF tokens, rtoken, and structural hidden inputs.
    - Preserves repeated inputs where applicable.
    - Excludes non-targeted student IDs from listed_part_ids[] so we only touch target rows.
    - Crucially: ECHOS existing status[id] and mark[id] for every targeted participant
      so ILIAS does NOT revert graded work to 'not graded' / None!
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

    # Collect base hidden inputs, skipping listed_part_ids and sel_part_ids which we customize
    payload: List[Tuple[str, str]] = []
    
    # We copy hidden fields from raw_hidden_fields
    for k, v in form_data.raw_hidden_fields:
        if k in ["listed_part_ids[]", "sel_part_ids[]"]:
            continue
        # Also skip any member-specific hidden fields if not in targets
        payload.append((k, v))

    # Add targeted updates
    target_member_ids = set()
    for member_id, new_notice, existing_status, existing_mark in target_updates:
        target_member_ids.add(str(member_id))
        
        # 1. Add to listed_part_ids[] and sel_part_ids[]
        payload.append(("listed_part_ids[]", str(member_id)))
        payload.append(("sel_part_ids[]", str(member_id)))

        # 2. Set notice[<member_id>]
        if len(new_notice) > MAX_NOTICE_LENGTH:
            raise ValueError(f"Notice for member {member_id} exceeds {MAX_NOTICE_LENGTH} characters.")
        payload.append((f"notice[{member_id}]", new_notice))

        # 3. Echo status[<member_id>]
        # Map our status string to ILIAS status value
        # In ILIAS, values are 'passed', 'failed', 'notgraded'
        ilias_status = "notgraded"
        if existing_status == "passed":
            ilias_status = "passed"
        elif existing_status == "failed":
            ilias_status = "failed"
        elif existing_status in ["not_graded", "notgraded"]:
            ilias_status = "notgraded"
        
        payload.append((f"status[{member_id}]", ilias_status))

        # 4. Echo mark[<member_id>]
        if existing_mark is not None and existing_mark != "-":
            payload.append((f"mark[{member_id}]", str(existing_mark)))

    # Set save command
    payload.append(("cmd[saveStatusAll]", "Save All"))
    payload.append(("select_cmd", "saveStatusSelected"))

    return action_url, payload

import io
import json
import zipfile
from typing import List, Tuple, Dict, Any, AsyncGenerator
import httpx

from backend.schemas import SubmissionItem

async def create_submissions_zip_bundle(
    assignment_title: str,
    exercise_ref_id: str,
    ass_id: str,
    submissions: List[SubmissionItem],
    http_client: httpx.AsyncClient,
) -> bytes:
    """
    Creates an export ZIP archive containing:
    - betterilias-feedback.json manifest with canonical IDs and mappings
    - submissions/team-<id>/ or submissions/user-<id>/ containing downloaded student files
    - feedback/team-<id>/ or feedback/user-<id>/ directory placeholders for return feedback
    """
    zip_buffer = io.BytesIO()

    manifest: Dict[str, Any] = {
        "format": "betterilias-feedback-v1",
        "exercise_ref_id": exercise_ref_id,
        "assignment_id": ass_id,
        "assignment_title": assignment_title,
        "units": [],
    }

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for sub in submissions:
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
            }

            # Create empty feedback placeholder folder in zip
            zf.writestr(f"feedback/{unit_folder}/.keep", "")

            # Download submitted files into submissions/
            for sf in sub.files:
                if sf.download_url:
                    try:
                        resp = await http_client.get(sf.download_url, follow_redirects=True)
                        if resp.status_code == 200:
                            file_path = f"submissions/{unit_folder}/{sf.filename}"
                            zf.writestr(file_path, resp.content)
                            unit_info["files"].append(sf.filename)
                    except Exception:
                        pass

            manifest["units"].append(unit_info)

        # Write manifest file
        zf.writestr("betterilias-feedback.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    zip_buffer.seek(0)
    return zip_buffer.getvalue()
