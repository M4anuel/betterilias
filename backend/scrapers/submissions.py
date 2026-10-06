import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import (
    AssignmentItem,
    ExerciseInfo,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    SubmissionFile,
    SubmissionItem,
)
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser
from backend.scrapers.materials import _extract_breadcrumbs


def _clean_text(elem) -> str:
    """Helper to get stripped text without extra whitespace."""
    if not elem:
        return ""
    return " ".join(elem.get_text().split()).strip()


@safe_parser(context_name="exercise_submissions")
def parse_exercise_submissions(html_content: str, exercise_ref_id: str) -> ExerciseSubmissionsResponse:
    """
    Parse an ILIAS Exercise participants / submissions page.
    Extracts assignment details and student submissions table.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # 1. Exercise Information
    title_elem = (
        soup.select_one("h1.ilHeader, h1.il-item-title, .ilMainHeader h1, h1")
        or soup.select_one(".ilTopTitle")
    )
    exercise_title = _clean_text(title_elem) or f"Exercise {exercise_ref_id}"

    # Extract Deadline / Due date & instructions if present
    deadline = None
    deadline_container = soup.select_one(".ilAssignmentDeadline, #il_prop_deadline")
    if deadline_container:
        deadline = _clean_text(deadline_container)
    else:
        deadline_elem = soup.find(string=re.compile(r"(Abgabetermin|Deadline|Due date|Abgabefrist)", re.IGNORECASE))
        if deadline_elem:
            parent = deadline_elem.parent
            if parent:
                sibling = parent.find_next_sibling()
                deadline = _clean_text(sibling) if sibling else _clean_text(parent)

    instructions = None
    inst_elem = soup.select_one(".il-item-description, #il_prop_instruction, .ilAssignmentInstructions")
    if inst_elem:
        instructions = _clean_text(inst_elem)

    # 2. Submissions Table
    submissions: List[SubmissionItem] = []
    
    # Locate participants table
    table = (
        soup.select_one("table[id*='tbl_il_exc'], table[id*='members'], table[id*='participant']")
        or soup.select_one("table.table, table.ilTable")
    )

    if not table:
        # Check if empty or only info message
        return ExerciseSubmissionsResponse(
            exercise=ExerciseInfo(
                ref_id=exercise_ref_id,
                title=exercise_title,
                instructions=instructions,
                deadline=deadline,
                total_participants=0,
                submitted_count=0,
                graded_count=0,
            ),
            submissions=[],
        )

    # Analyze Table Headers to map column indices
    headers: List[str] = []
    header_row = table.select_one("thead tr") or table.select_one("tr")
    if header_row:
        for th in header_row.find_all(["th", "td"]):
            headers.append(_clean_text(th).lower())

    def col_idx(pattern: str) -> Optional[int]:
        for idx, h in enumerate(headers):
            if re.search(pattern, h, re.IGNORECASE):
                return idx
        return None

    name_col = col_idx(r"(name|teilnehmer|student|participant|login)")
    status_col = col_idx(r"(abgegeben|status|submitted|abgabe)")
    files_col = col_idx(r"(datei|files|upload|abgelieferte|abgabe)")
    grade_col = col_idx(r"(note|punkte|mark|points|bewertung)")
    passed_col = col_idx(r"(bestanden|passed|status)")
    feedback_col = col_idx(r"(feedback|rückmeldung|kommentar|notice)")

    rows = table.select("tbody tr") or table.select("tr")

    submitted_count = 0
    graded_count = 0

    for row in rows:
        cells = row.find_all("td")
        if not cells or len(cells) < 2:
            continue

        # Look for member/user identifier
        # ILIAS tables often have checkboxes or inputs named user_id[], member_id[], id[], or part_id[]
        member_id = None
        user_input = row.select_one("input[name*='user_id'], input[name*='id['], input[name*='member_id'], input[type='checkbox']")
        if user_input and user_input.get("value"):
            member_id = user_input.get("value")

        # Name / Student login
        name_cell = cells[name_col] if name_col is not None and name_col < len(cells) else cells[0]
        student_name = _clean_text(name_cell)
        if not student_name or student_name.lower() in [h.lower() for h in headers]:
            continue

        login = None
        login_match = re.search(r"\(([^)]+)\)", student_name)
        if login_match:
            login = login_match.group(1)

        # Fallback member_id from links in name cell if not found in input
        if not member_id:
            member_link = name_cell.find("a", href=True)
            if member_link:
                href = member_link.get("href", "")
                m = re.search(r"(?:part_id|user_id|member_id)=(\d+)", href)
                if m:
                    member_id = m.group(1)
            if not member_id:
                # Deterministic fallback id based on clean student name
                member_id = re.sub(r"\W+", "_", student_name.strip().lower())

        # Submission status & timestamp
        submission_status = "not_submitted"
        submission_time = None
        if status_col is not None and status_col < len(cells):
            status_text = _clean_text(cells[status_col])
            if any(term in status_text.lower() for term in ["ja", "yes", "abgegeben", "submitted"]):
                submission_status = "submitted"
            elif "verspätet" in status_text.lower() or "late" in status_text.lower():
                submission_status = "late"
            submission_time = status_text if status_text else None

        # Files submitted
        files: List[SubmissionFile] = []
        files_cell = cells[files_col] if files_col is not None and files_col < len(cells) else None
        if files_cell:
            for file_link in files_cell.find_all("a", href=True):
                fname = _clean_text(file_link)
                furl = urllib.parse.urljoin(settings.ilias_base_url, file_link.get("href", ""))
                if fname:
                    files.append(SubmissionFile(filename=fname, download_url=furl))
            if files and submission_status == "not_submitted":
                submission_status = "submitted"

        # Grade / Mark input or value
        mark = None
        mark_input = row.select_one("input[name*='mark['], input[name*='grade['], input[name*='points[']")
        if mark_input:
            mark = mark_input.get("value")
        elif grade_col is not None and grade_col < len(cells):
            mark = _clean_text(cells[grade_col]) or None

        # Passed status (bestanden, nicht bestanden, nicht bewertet)
        passed_status = "not_graded"
        status_select = row.select_one("select[name*='status['], select[name*='passed[']")
        if status_select:
            selected_opt = status_select.find("option", selected=True)
            if selected_opt:
                val = selected_opt.get("value", "").lower()
                text = _clean_text(selected_opt).lower()
                if "not_graded" in val or "nicht bewertet" in text:
                    passed_status = "not_graded"
                elif "passed" in val or text == "bestanden":
                    passed_status = "passed"
                elif "failed" in val or "nicht bestanden" in text:
                    passed_status = "failed"
        elif passed_col is not None and passed_col < len(cells):
            passed_text = _clean_text(cells[passed_col]).lower()
            if "nicht bewertet" in passed_text:
                passed_status = "not_graded"
            elif "nicht bestanden" in passed_text or "failed" in passed_text:
                passed_status = "failed"
            elif "bestanden" in passed_text:
                passed_status = "passed"

        # Feedback & Notice
        feedback = None
        notice = None
        feedback_input = row.select_one("textarea[name*='feedback['], input[name*='feedback[']")
        if feedback_input:
            feedback = feedback_input.get_text() or feedback_input.get("value")
        elif feedback_col is not None and feedback_col < len(cells):
            feedback = _clean_text(cells[feedback_col]) or None

        if submission_status in ["submitted", "late"]:
            submitted_count += 1
        if passed_status in ["passed", "failed"] or (mark and mark.strip()):
            graded_count += 1

        # Hidden inputs in this row or form
        hidden_inputs: Dict[str, str] = {}
        for h_in in row.select("input[type='hidden']"):
            name = h_in.get("name")
            if name:
                hidden_inputs[name] = h_in.get("value", "")

        submissions.append(
            SubmissionItem(
                member_id=str(member_id),
                student_name=student_name,
                login=login,
                submission_status=submission_status,
                submission_time=submission_time,
                files=files,
                mark=mark,
                passed_status=passed_status,
                feedback=feedback,
                notice=notice,
                can_grade=True,
                hidden_form_fields=hidden_inputs if hidden_inputs else None,
            )
        )

    return ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(
            ref_id=exercise_ref_id,
            title=exercise_title,
            instructions=instructions,
            deadline=deadline,
            total_participants=len(submissions),
            submitted_count=submitted_count,
            graded_count=graded_count,
        ),
        submissions=submissions,
    )


@safe_parser(context_name="exercise_overview")
def parse_exercise_overview(html_content: str, exercise_ref_id: str) -> ExerciseOverviewResponse:
    """
    Parse an Exercise overview page (e.g. showOverview) containing sub-assignments.
    Extracts assignments, time remaining, deadlines, and the 'Submissions and Grades' TA link.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Extract Title
    title_el = (
        soup.select_one("h1.il-page-content-header, h1.ilHeader:not(.modal-title), h1.media-heading:not(.modal-title), h1:not(.modal-title)")
        or soup.select_one(".ilTopTitle")
    )
    exercise_title = _clean_text(title_el) or f"Exercise {exercise_ref_id}"

    # Extract Breadcrumbs
    breadcrumbs = _extract_breadcrumbs(soup)

    # Extract TA "Submissions and Grades" link
    ta_link = None
    ta_a = soup.find("a", string=re.compile(r"(Submissions and Grades|Abgaben und Noten|Teilnehmer|Members)", re.IGNORECASE))
    if ta_a and ta_a.has_attr("href"):
        ta_link = urllib.parse.urljoin(settings.ilias_base_url, ta_a["href"])

    # Extract Assignments
    assignments: List[AssignmentItem] = []
    for item in soup.select(".il-item.il-std-item"):
        title_a = item.select_one("h4.il-item-title a, .il-item-title a, h4.il-item-title button, .il-item-title button")
        if not title_a:
            continue

        title = title_a.get_text(strip=True)
        raw_href = title_a.get("href") or title_a.get("data-action") or ""
        full_url = urllib.parse.urljoin(settings.ilias_base_url, raw_href)

        # Extract ass_id
        ass_id = None
        m_ass = re.search(r"ass_id=(\d+)", raw_href)
        if m_ass:
            ass_id = m_ass.group(1)

        # Time remaining
        time_rem_el = item.select_one(".col-sm-3, .il-item-head .col-sm-3")
        time_remaining = time_rem_el.get_text(strip=True) if time_rem_el else None

        # Extract properties (Edit Until, Requirement, Status, etc.)
        props: Dict[str, str] = {}
        for p in item.select(".il-multi-line-cap-3"):
            pn = p.select_one(".il-item-property-name")
            pv = p.select_one(".il-item-property-value")
            if pn and pv:
                key = pn.get_text(strip=True)
                val = pv.get_text(strip=True)
                if key and val:
                    props[key] = val

        assignments.append(
            AssignmentItem(
                ass_id=ass_id,
                title=title,
                url=full_url,
                time_remaining=time_remaining,
                edit_until=props.get("Edit Until") or props.get("Abgabe bis"),
                requirement=props.get("Requirement") or props.get("Verpflichtend"),
                status=props.get("Status"),
                properties=props,
            )
        )

    return ExerciseOverviewResponse(
        exercise_ref_id=exercise_ref_id,
        title=exercise_title,
        breadcrumbs=breadcrumbs,
        submissions_and_grades_url=ta_link,
        assignments=assignments,
    )

