import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple
from bs4 import BeautifulSoup

from backend.config import settings
from backend.scrapers.dumper import safe_parser


@dataclass
class GradingFormData:
    action_url: str
    hidden_fields: Dict[str, str] = field(default_factory=dict)
    mark_field_name: Optional[str] = None
    status_field_name: Optional[str] = None
    feedback_field_name: Optional[str] = None
    notice_field_name: Optional[str] = None
    submit_button_name: Optional[str] = None
    submit_button_value: Optional[str] = None


@safe_parser(context_name="grading_form")
def extract_grading_form(html_content: str, member_id: Optional[str] = None) -> GradingFormData:
    """
    Extract hidden inputs, action URL, and payload field names from a student grading form.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Locate grading form
    # Could be form with cmd=saveStatus or form around the table / participant grading view
    form = (
        soup.select_one("form[action*='ilExercise'], form[action*='ilobjexercisegui'], form[name*='form_'], form#form_")
        or soup.select_one("form.il-form, form.form-horizontal")
        or soup.find("form")
    )

    if not form:
        raise ValueError("Could not find any <form> element on the grading page.")

    action_url = form.get("action", "")
    full_action_url = urllib.parse.urljoin(settings.ilias_base_url, action_url)

    # Scrape all hidden input fields
    hidden_fields: Dict[str, str] = {}
    for hidden in form.select("input[type='hidden']"):
        name = hidden.get("name")
        if name:
            hidden_fields[name] = hidden.get("value", "")

    # Identify field names for mark, status, and feedback
    mark_field_name = None
    status_field_name = None
    feedback_field_name = None
    notice_field_name = None

    for inp in form.find_all(["input", "select", "textarea"]):
        name = inp.get("name", "")
        if not name or inp.get("type") == "hidden":
            continue

        name_lower = name.lower()

        # If member_id is provided, prioritize fields matching that member_id
        if member_id and str(member_id) in name:
            if "mark" in name_lower or "grade" in name_lower or "points" in name_lower:
                mark_field_name = name
            elif "status" in name_lower or "passed" in name_lower:
                status_field_name = name
            elif "feedback" in name_lower:
                feedback_field_name = name
            elif "notice" in name_lower:
                notice_field_name = name
            continue

        if not mark_field_name and ("mark" in name_lower or "grade" in name_lower or "punkte" in name_lower):
            mark_field_name = name
        elif not status_field_name and ("status" in name_lower or "passed" in name_lower or "bestanden" in name_lower):
            status_field_name = name
        elif not feedback_field_name and ("feedback" in name_lower or "kommentar" in name_lower):
            feedback_field_name = name
        elif not notice_field_name and ("notice" in name_lower or "hinweis" in name_lower):
            notice_field_name = name

    # Submit button
    submit_btn = form.select_one("input[type='submit'], button[type='submit']")
    submit_name = submit_btn.get("name") if submit_btn else "cmd[saveStatus]"
    submit_val = submit_btn.get("value") if submit_btn else "Speichern"

    return GradingFormData(
        action_url=full_action_url,
        hidden_fields=hidden_fields,
        mark_field_name=mark_field_name or "mark",
        status_field_name=status_field_name or "status",
        feedback_field_name=feedback_field_name or "feedback",
        notice_field_name=notice_field_name,
        submit_button_name=submit_name,
        submit_button_value=submit_val,
    )


def verify_grading_success(response_html: str) -> Tuple[bool, str]:
    """
    Verify whether the grading POST request was processed successfully by ILIAS.
    """
    soup = BeautifulSoup(response_html, "lxml")

    # 1. Check for ILIAS success alert message
    success_elem = soup.select_one(
        ".ilSystemMessage.alert-success, .alert-success, .ilSuccessMessage, #il_message.alert-success"
    )
    if success_elem:
        msg = " ".join(success_elem.get_text().split()).strip()
        return True, msg or "Changes successfully saved in ILIAS."

    # 2. Check for ILIAS error alert message
    error_elem = soup.select_one(
        ".ilSystemMessage.alert-danger, .alert-danger, .ilFailureMessage, #il_message.alert-danger"
    )
    if error_elem:
        msg = " ".join(error_elem.get_text().split()).strip()
        return False, msg or "ILIAS returned an error."

    # 3. Check for text indications in page
    text = soup.get_text()
    if any(s in text for s in ["Erfolgreich gespeichert", "Änderungen gespeichert", "Saved successfully", "Gespeichert"]):
        return True, "Grading saved successfully."

    # If redirected back to members table or overview without error, consider it a success
    if "saveStatus" not in response_html and ("tbl_il_exc" in response_html or "viewMembers" in response_html):
        return True, "Grading form submitted and participant list updated."

    return False, "Could not verify success state from response."

