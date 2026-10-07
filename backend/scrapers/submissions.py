import re
import urllib.parse
from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from backend.config import settings
from backend.schemas import (
    AssignmentItem,
    ExerciseInfo,
    ExerciseInfoResponse,
    ExerciseInfoSection,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    StudentAssignmentDetail,
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
    Parse an ILIAS Exercise participants / submissions page (TA grading view).
    Extracts assignment selector, student/team submissions table, grades, evaluation statements,
    direct download actions, and form submission metadata.
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

    # 2. Extract Available Assignments (from <select name="ass_id"> or subtabs)
    available_assignments: List[AssignmentItem] = []
    active_assignment_id: Optional[str] = None

    ass_select = soup.find("select", attrs={"name": "ass_id"})
    if ass_select:
        for opt in ass_select.find_all("option"):
            opt_val = opt.get("value", "")
            opt_title = _clean_text(opt)
            is_sel = opt.has_attr("selected")
            if is_sel:
                active_assignment_id = opt_val
            available_assignments.append(
                AssignmentItem(
                    ass_id=opt_val,
                    title=opt_title,
                    url=f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilexercisemanagementgui&cmd=members&ref_id={exercise_ref_id}&ass_id={opt_val}",
                    is_selected=is_sel,
                )
            )

    # 3. Locate Main Grading Form & CSRF Token
    form = (
        soup.find("form", id=re.compile(r"form_exc_mem|exc_mem", re.I))
        or soup.find("form", action=re.compile(r"ilExerciseManagementGUI", re.I))
        or soup.find("form", action=re.compile(r"cmdClass=ilexercisemanagementgui", re.I))
    )
    form_action_url = None
    rtoken = None

    if form and form.get("action"):
        raw_act = form.get("action")
        form_action_url = urllib.parse.urljoin(settings.ilias_base_url, raw_act)
        m_tok = re.search(r"rtoken=([a-f0-9]+)", raw_act)
        if m_tok:
            rtoken = m_tok.group(1)

    if not rtoken:
        # Search anywhere in HTML for rtoken
        m_tok_all = re.search(r"rtoken=([a-f0-9]{32,64})", html_content)
        if m_tok_all:
            rtoken = m_tok_all.group(1)

    # 4. Locate Submissions Table
    table = (
        soup.find("table", id="exc_mem")
        or soup.select_one("table[id*='exc_mem'], table[id*='tbl_il_exc'], table[id*='members'], table[id*='participant']")
        or soup.select_one("table.ilTable, table.table")
    )

    if not table:
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
            available_assignments=available_assignments,
            active_assignment_id=active_assignment_id,
            submissions=[],
            form_action_url=form_action_url,
            rtoken=rtoken,
        )

    # Analyze Table Headers
    headers: List[str] = []
    raw_headers: List[str] = []
    header_row = table.select_one("thead tr") or table.select_one("tr")
    if header_row:
        for th in header_row.find_all(["th", "td"]):
            raw_h = _clean_text(th)
            clean_h = re.sub(r"(Descending|Ascending|absteigend|aufsteigend)", "", raw_h, flags=re.I).strip()
            raw_headers.append(clean_h)
            headers.append(clean_h.lower())

    def col_idx(pattern: str) -> Optional[int]:
        for idx, h in enumerate(headers):
            if re.search(pattern, h, re.IGNORECASE):
                return idx
        return None

    name_col = col_idx(r"^(team|name|teilnehmer|student|participant|login)")
    sent_on_col = col_idx(r"(sent on|versendet)")
    submitted_col = col_idx(r"(submitted on|abgegeben am|abgabezeit)")
    if submitted_col is None:
        submitted_col = col_idx(r"(submitted|abgegeben|abgabe)")
    indiv_deadline_col = col_idx(r"(individual deadline|individuelle frist)")
    mark_col = col_idx(r"^(mark|note|punkte|points)$")
    graded_on_col = col_idx(r"(graded on|bewertet am|korrigiert am)")
    eval_on_col = col_idx(r"(evaluation on|rückmeldung am)")
    grade_col = col_idx(r"^(grade|bewertung|status)")
    eval_col = col_idx(r"(evaluation statement|kommentar|feedback)")
    notice_col = col_idx(r"(note for tutors|notiz für tutoren|notice|notiz)")
    files_col = col_idx(r"(datei|files|upload|abgelieferte)")
    actions_col = col_idx(r"(actions|aktionen)")

    rows = table.select("tbody tr") or table.select("tr")

    submissions: List[SubmissionItem] = []
    submitted_count = 0
    graded_count = 0

    for row in rows:
        cells = row.find_all("td")
        if not cells or len(cells) < 2:
            continue

        # Extract Member / Participant ID
        member_id = None
        cb_input = row.select_one("input[type='checkbox'][name*='sel_part_ids'], input[type='checkbox'][name*='id']")
        if cb_input and cb_input.get("value"):
            member_id = cb_input.get("value")

        if not member_id:
            hid_input = row.select_one("input[type='hidden'][name*='listed_part_ids'], input[type='hidden'][name*='user_id']")
            if hid_input and hid_input.get("value"):
                member_id = hid_input.get("value")

        # Student / Team Name and Team Members Extraction
        name_cell = cells[name_col] if name_col is not None and name_col < len(cells) else cells[1 if len(cells) > 1 else 0]
        
        team_members: List[str] = []
        team_id = None
        login = None

        for s in name_cell.stripped_strings:
            m_team = re.match(r"^\((\d+)\)$", s)
            m_login = re.match(r"^\(([a-zA-Z0-9_\.\-]+)\)$", s)
            if m_team:
                team_id = m_team.group(1)
            elif m_login:
                login = m_login.group(1)
            elif s and not s.startswith("(") and s.lower() not in [h.lower() for h in headers]:
                clean_s = " ".join(s.split()).strip()
                if clean_s and clean_s not in team_members:
                    team_members.append(clean_s)

        raw_name = _clean_text(name_cell)
        if not raw_name or raw_name.lower() in [h.lower() for h in headers]:
            continue

        if not team_id:
            team_match = re.search(r"\((\d+)\)", raw_name)
            if team_match:
                team_id = team_match.group(1)

        if not login and not team_id:
            login_match = re.search(r"\(([a-zA-Z0-9_\.\-]+)\)", raw_name)
            if login_match:
                login = login_match.group(1)

        if team_members:
            student_name = " • ".join(team_members)
        else:
            student_name = re.sub(r"\(\d+\)", "", raw_name).strip()
            if student_name:
                team_members = [student_name]

        if not member_id:
            member_id = re.sub(r"\W+", "_", student_name.strip().lower())

        files: List[SubmissionFile] = []
        if files_col is not None and files_col < len(cells):
            files_cell = cells[files_col]
            for a in files_cell.find_all("a", href=True):
                fname = _clean_text(a)
                furl = urllib.parse.urljoin(settings.ilias_base_url, a["href"])
                if fname and not any(k in fname.lower() for k in ["download submissions", "keine dateien"]):
                    files.append(SubmissionFile(filename=fname, download_url=furl))

        # Submission Timestamp
        submission_time = None
        submission_status = "not_submitted"
        if submitted_col is not None and submitted_col < len(cells):
            subm_text = _clean_text(cells[submitted_col])
            is_neg = any(k in subm_text.lower() for k in ["nein", "no", "keine", "not submitted", "nicht abgegeben", "not graded", "nicht bewertet"])
            has_date = bool(re.search(r"\d{2}\.\d{2}\.\d{4}|\d+\.\s*[a-zA-Z]{3}|\d+:\d+", subm_text))
            is_pos = any(k in subm_text.lower() for k in ["ja", "yes", "abgegeben", "submitted"]) or has_date

            if is_pos and not is_neg:
                submission_time = subm_text
                submission_status = "submitted"
                if "late" in subm_text.lower() or "verspätet" in subm_text.lower():
                    submission_status = "late"
            elif files:
                submission_status = "submitted"
                submission_time = subm_text if subm_text and not is_neg else None

        # Graded on, Evaluation on, Sent on, Individual Deadline
        graded_on = None
        if graded_on_col is not None and graded_on_col < len(cells):
            g_text = _clean_text(cells[graded_on_col])
            if g_text and not any(k in g_text.lower() for k in ["nein", "no", "keine"]):
                graded_on = g_text

        evaluation_on = None
        if eval_on_col is not None and eval_on_col < len(cells):
            e_text = _clean_text(cells[eval_on_col])
            if e_text and not any(k in e_text.lower() for k in ["nein", "no", "keine"]):
                evaluation_on = e_text

        sent_on = None
        if sent_on_col is not None and sent_on_col < len(cells):
            s_text = _clean_text(cells[sent_on_col])
            if s_text and not any(k in s_text.lower() for k in ["nein", "no", "keine"]):
                sent_on = s_text

        individual_deadline = None
        if indiv_deadline_col is not None and indiv_deadline_col < len(cells):
            idl_text = _clean_text(cells[indiv_deadline_col])
            if idl_text and not any(k in idl_text.lower() for k in ["keine", "none", "-"]):
                individual_deadline = idl_text

        # Grade / Status Dropdown or input
        passed_status = "not_graded"
        status_select = row.select_one(f"select[name*='status[{member_id}]'], select[name*='status[']")
        if status_select:
            selected_opt = status_select.find("option", selected=True)
            if selected_opt:
                val = selected_opt.get("value", "").lower()
                text = _clean_text(selected_opt).lower()
                if "passed" in val or "bestanden" in text:
                    passed_status = "passed"
                elif "failed" in val or "nicht bestanden" in text:
                    passed_status = "failed"
                elif "not" in val or "nicht bewertet" in text:
                    passed_status = "not_graded"
        elif grade_col is not None and grade_col < len(cells):
            grade_text = _clean_text(cells[grade_col]).lower()
            if "passed" in grade_text or "bestanden" in grade_text:
                passed_status = "passed"
            elif "failed" in grade_text or "nicht bestanden" in grade_text:
                passed_status = "failed"

        mark = None
        mark_input = row.select_one(f"input[name*='mark[{member_id}]'], input[name*='grade[']")
        if mark_input:
            mark = mark_input.get("value")
        elif mark_col is not None and mark_col < len(cells):
            m_text = _clean_text(cells[mark_col])
            if m_text and m_text not in ["-", "–"]:
                mark = m_text

        # Evaluation Statement / Feedback
        feedback = None
        if eval_col is not None and eval_col < len(cells):
            feedback = _clean_text(cells[eval_col]) or None
        eval_textarea = row.select_one(f"textarea[name*='feedback[{member_id}]'], textarea[name*='feedback[']")
        if eval_textarea and eval_textarea.get_text(strip=True):
            feedback = eval_textarea.get_text(strip=True)

        # Note for Tutors
        notice = None
        if notice_col is not None and notice_col < len(cells):
            notice = _clean_text(cells[notice_col]) or None
        notice_input = row.select_one(
            f"textarea[name*='notice[{member_id}]'], input[name*='notice[{member_id}]'], textarea[name*='notice['], input[name*='notice[']"
        )
        if notice_input:
            notice = notice_input.get_text(strip=True) or notice_input.get("value") or notice

        # Action Buttons in this row
        download_url = None
        feedback_mail_url = None
        team_log_url = None
        evaluation_by_file_url = None

        # Find action buttons/links
        for el in row.find_all(["button", "a"]):
            el_text = _clean_text(el).lower()
            raw_act = el.get("data-action") or el.get("href")
            if not raw_act or raw_act == "#":
                continue

            full_url = urllib.parse.urljoin(settings.ilias_base_url, raw_act)

            if "download" in el_text:
                download_url = full_url
                fname = f"Submission_{student_name}.zip"
                m_count = re.search(r"\((\d+)\)", el_text)
                if m_count and m_count.group(1) == "1":
                    fname = f"Submission_{student_name}"
                files.append(SubmissionFile(filename=fname, download_url=full_url))
                submission_status = "submitted"
            elif "mail" in el_text or "email" in el_text:
                feedback_mail_url = full_url
            elif "evaluation by file" in el_text or "file" in el_text or "datei" in el_text:
                evaluation_by_file_url = full_url
            elif "log" in el_text:
                team_log_url = full_url

        if submission_status in ["submitted", "late"]:
            submitted_count += 1
        if passed_status in ["passed", "failed"] or (mark and mark.strip()):
            graded_count += 1

        # Hidden inputs in this row
        hidden_inputs: Dict[str, str] = {}
        for h_in in row.select("input[type='hidden']"):
            name = h_in.get("name")
            if name:
                hidden_inputs[name] = h_in.get("value", "")

        # Extract all visible columns into additional_columns
        additional_columns: Dict[str, str] = {}
        for idx, rh in enumerate(raw_headers):
            if idx < len(cells) and rh:
                if any(k in rh.lower() for k in ["selection", "auswahl", "actions", "aktionen"]):
                    continue
                cell_text = _clean_text(cells[idx])
                if cell_text:
                    additional_columns[rh] = cell_text

        submissions.append(
            SubmissionItem(
                member_id=str(member_id),
                student_name=student_name,
                team_members=team_members,
                login=login,
                team_id=team_id,
                team_name=f"Team {team_id}" if team_id else None,
                submission_status=submission_status,
                submission_time=submission_time,
                graded_on=graded_on,
                evaluation_on=evaluation_on,
                sent_on=sent_on,
                individual_deadline=individual_deadline,
                files=files,
                download_url=download_url,
                mark=mark,
                passed_status=passed_status,
                feedback=feedback,
                notice=notice,
                feedback_mail_url=feedback_mail_url,
                team_log_url=team_log_url,
                evaluation_by_file_url=evaluation_by_file_url,
                can_grade=True,
                hidden_form_fields=hidden_inputs if hidden_inputs else None,
                additional_columns=additional_columns,
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
        available_assignments=available_assignments,
        active_assignment_id=active_assignment_id,
        submissions=submissions,
        form_action_url=form_action_url,
        rtoken=rtoken,
    )


@safe_parser(context_name="student_assignment_detail")
def parse_student_assignment_detail(html_content: str, exercise_ref_id: str, ass_id: str) -> StudentAssignmentDetail:
    """
    Parse an ILIAS student assignment presentation page (ilAssignmentPresentationGUI).
    Extracts instructions, schedule, prompt files, team status/members, submission status,
    and tutor feedback/evaluation statement.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Title
    title_el = (
        soup.select_one("h1.ilHeader, h1.il-item-title, h1:not(.modal-title)")
        or soup.select_one(".panel-title")
        or soup.select_one(".ilTopTitle")
    )
    title = _clean_text(title_el) or f"Assignment {ass_id}"

    panels = soup.find_all("div", class_="panel")

    instructions = None
    start_time = None
    ended_on = None
    time_remaining = None
    is_ended = False
    exercise_files: List[SubmissionFile] = []
    team_members: List[str] = []
    team_status_text = None
    create_team_url = None
    manage_team_url = None
    submitted_files: List[SubmissionFile] = []
    last_submission = None
    submission_status = "not_submitted"
    evaluation_statement = None
    passed_status = "not_graded"
    mark = None

    for p in panels:
        p_title_el = p.find(["h2", "h3", "h4", ".panel-title"])
        p_title = _clean_text(p_title_el).lower() if p_title_el else ""
        body = p.find("div", class_="panel-body") or p

        # 1. Schedule & Instructions
        if any(w in p_title for w in ["instruction", "arbeitsanweisung", "terminplan", "schedule"]):
            for line in body.get_text(separator="\n").split("\n"):
                line = line.strip()
                if any(w in line.lower() for w in ["startzeit", "start time"]) and ":" in line:
                    start_time = line.split(":", 1)[1].strip()
                elif any(w in line.lower() for w in ["ended on", "abgabetermin"]) and ":" in line:
                    ended_on = line.split(":", 1)[1].strip()
                elif any(w in line.lower() for w in ["remaining", "verbleibende"]) and ":" in line:
                    time_remaining = line.split(":", 1)[1].strip()

            body_text = body.get_text()
            if "time is up" in body_text.lower() or "abgelaufen" in body_text.lower():
                is_ended = True
                time_remaining = "Time is up"

            inst_p = body.select_one(".ilAssignmentInstructions, p")
            if inst_p:
                instructions = _clean_text(inst_p)

        # 2. Files (Prompt materials provided by lecturer)
        elif any(w in p_title for w in ["file", "datei"]):
            for a in p.find_all("a", href=True):
                href = a.get("href", "")
                full_url = urllib.parse.urljoin(settings.ilias_base_url, href)
                raw_text = _clean_text(a)

                # Find file name from param or previous sibling
                fname = raw_text
                m_file = re.search(r"file=([^&]+)", href)
                if m_file:
                    fname = urllib.parse.unquote(m_file.group(1))
                elif "download" in raw_text.lower():
                    prev = a.find_previous_sibling()
                    if prev:
                        fname = _clean_text(prev)

                exercise_files.append(
                    SubmissionFile(filename=fname, download_url=full_url)
                )

        # 3. Team Information
        elif "team" in p_title:
            manage_a = p.find("a", string=re.compile(r"(manage|verwalten)", re.I))
            if manage_a and manage_a.get("href"):
                manage_team_url = urllib.parse.urljoin(settings.ilias_base_url, manage_a["href"])

            create_a = p.find("a", string=re.compile(r"(create|erstellen)", re.I))
            if create_a and create_a.get("href"):
                create_team_url = urllib.parse.urljoin(settings.ilias_base_url, create_a["href"])

            text = body.get_text(separator=" ")
            members_match = re.findall(r"\[([^\]]+)\]", text)
            if members_match:
                team_members = members_match
            elif "keinem team" in text.lower():
                team_status_text = "Sie gehören noch keinem Team an."

        # 4. Student Submission
        elif any(w in p_title for w in ["submission", "einreichung", "abgabe"]):
            for line in body.get_text(separator="\n").split("\n"):
                line = line.strip()
                if any(w in line.lower() for w in ["last submission", "letzten abgabe"]) and ":" in line:
                    last_submission = line.split(":", 1)[1].strip()

            for a in p.find_all("a", href=True):
                href = a.get("href", "")
                full_url = urllib.parse.urljoin(settings.ilias_base_url, href)
                txt = _clean_text(a)
                if any(w in href.lower() for w in ["download", "submission", "file"]):
                    submitted_files.append(
                        SubmissionFile(filename=txt or "Submitted_File", download_url=full_url)
                    )
                    submission_status = "submitted"

            if last_submission and last_submission != "Bisher keine Abgabe":
                submission_status = "submitted"

        # 5. Tutor Feedback & Evaluation
        elif any(w in p_title for w in ["evaluation", "bewertung"]):
            text = body.get_text(separator="\n")
            if "passed" in text.lower() or "bestanden" in text.lower():
                passed_status = "passed"
            elif "failed" in text.lower() or "nicht bestanden" in text.lower():
                passed_status = "failed"

            # Parse lines for the statement
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            stmt_lines = []
            capturing = False
            for l in lines:
                if any(h in l.lower() for h in ["evaluation statement", "rückmeldung"]):
                    capturing = True
                    continue
                if capturing:
                    if l.lower() in ["status", "passed", "failed", "not graded", "bestanden"]:
                        break
                    stmt_lines.append(l)

            if stmt_lines:
                evaluation_statement = "\n".join(stmt_lines)

    return StudentAssignmentDetail(
        exercise_ref_id=exercise_ref_id,
        ass_id=ass_id,
        title=title,
        instructions=instructions,
        start_time=start_time,
        ended_on=ended_on,
        time_remaining=time_remaining,
        is_ended=is_ended,
        exercise_files=exercise_files,
        team_members=team_members,
        team_status_text=team_status_text,
        create_team_url=create_team_url,
        manage_team_url=manage_team_url,
        submitted_files=submitted_files,
        last_submission=last_submission,
        submission_status=submission_status,
        evaluation_statement=evaluation_statement,
        passed_status=passed_status,
        mark=mark,
    )


@safe_parser(context_name="student_submitted_files")
def parse_student_submitted_files_screen(
    html_content: str, base_url: str = settings.ilias_base_url
) -> Tuple[List[SubmissionFile], Optional[str]]:
    """
    Parses the ILIAS student submissionScreen (ilExSubmissionFileGUI&cmd=submissionScreen).
    Extracts direct download links, file names, and timestamps of submitted files.
    """
    soup = BeautifulSoup(html_content, "lxml")
    submitted_files: List[SubmissionFile] = []
    last_submission: Optional[str] = None

    table = soup.select_one("table.table-striped, table.fullwidth, table")
    if not table:
        return submitted_files, last_submission

    rows = table.select("tbody tr")
    for r in rows:
        row_text = r.get_text(strip=True)
        if "empty" in row_text.lower() or "keine" in row_text.lower():
            continue

        cells = r.find_all("td")
        if not cells:
            continue

        # Look for download link
        download_a = r.select_one("a[href*='cmd=download']")
        download_url = None
        if download_a and download_a.get("href"):
            download_url = urllib.parse.urljoin(base_url, download_a["href"])

        # Extract file name
        label = r.select_one("label")
        if label:
            filename = _clean_text(label)
        elif len(cells) > 1:
            filename = _clean_text(cells[1])
        else:
            filename = "Submitted_File"

        # Extract date
        upload_time = None
        for c in cells:
            txt = _clean_text(c)
            if re.search(r"\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+\s*\d{4}|\d{2}\.\d{2}\.\d{4}", txt):
                upload_time = txt
                break

        if upload_time and not last_submission:
            last_submission = upload_time

        # Extract delivered_id
        delivered_inp = r.select_one("input[name='delivered[]'], input[name*='delivered']")
        delivered_id = delivered_inp.get("value") if delivered_inp else None
        if not delivered_id and download_url:
            m = re.search(r"delivered=(\d+)", download_url)
            if m:
                delivered_id = m.group(1)

        if download_url or filename:
            submitted_files.append(
                SubmissionFile(
                    filename=filename,
                    download_url=download_url or "",
                    upload_time=upload_time,
                    delivered_id=delivered_id,
                )
            )

    return submitted_files, last_submission


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

    # Extract active mode if viewcontrol is present
    active_mode = "all"
    mode_group = soup.select_one(".il-viewcontrol-mode")
    if mode_group:
        engaged_btn = mode_group.select_one("button.engaged, [aria-pressed='true']")
        if engaged_btn:
            txt = _clean_text(engaged_btn).lower()
            if "ongoing" in txt or "laufend" in txt:
                active_mode = "ongoing"
            elif "future" in txt or "upcoming" in txt or "zukünftig" in txt:
                active_mode = "future"
            elif "past" in txt or "beendet" in txt:
                active_mode = "past"
            elif "all" in txt or "alle" in txt:
                active_mode = "all"

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

        # Check for Create Team button
        create_team_url = None
        ct_el = item.find(lambda e: e.name in ["button", "a"] and re.search(r"create\s*team|team\s*erstellen", e.get_text(), re.I))
        if ct_el:
            raw_ct = ct_el.get("data-action") or ct_el.get("href")
            if raw_ct:
                create_team_url = urllib.parse.urljoin(settings.ilias_base_url, raw_ct)

        # Classification
        time_text = (time_remaining or "").lower()
        is_ended = "ended" in time_text or "beendet" in time_text or any("ended" in k.lower() for k in props.keys())
        is_upcoming = "starting on" in time_text or "beginnt am" in time_text or any("starting" in k.lower() for k in props.keys())
        is_ongoing = not is_ended and not is_upcoming and bool(time_remaining or props.get("Edit Until"))
        ass_type = props.get("Type") or props.get("Typ")

        assignments.append(
            AssignmentItem(
                ass_id=ass_id,
                title=title,
                url=full_url,
                time_remaining=time_remaining,
                edit_until=props.get("Edit Until") or props.get("Abgabe bis") or props.get("Ended On"),
                requirement=props.get("Requirement") or props.get("Verpflichtend"),
                status=props.get("Status"),
                is_ongoing=is_ongoing,
                is_ended=is_ended,
                create_team_url=create_team_url,
                ass_type=ass_type,
                is_selected=False,
                properties=props,
            )
        )

    return ExerciseOverviewResponse(
        exercise_ref_id=exercise_ref_id,
        title=exercise_title,
        breadcrumbs=breadcrumbs,
        submissions_and_grades_url=ta_link,
        has_ta_access=bool(ta_link),
        active_mode=active_mode,
        assignments=assignments,
    )


@safe_parser(context_name="exercise_info")
def parse_exercise_info(html_content: str, ref_id: str) -> ExerciseInfoResponse:
    """
    Parse an Exercise Info screen (ilinfoscreengui -> showSummary).
    Extracts sections like Overview, Mandatory criteria, Pass Mode, Tutor Evaluation, Additional Info.
    """
    soup = BeautifulSoup(html_content, "lxml")
    title_el = soup.select_one("h1.il-page-content-header, h1.ilHeader, h1")
    title = _clean_text(title_el) or f"Exercise Info {ref_id}"

    sections: List[ExerciseInfoSection] = []
    sec_elems = soup.select(".ilInfoScreenSec")
    for sec in sec_elems:
        header_el = sec.select_one(".ilFormHeader h2, .ilFormHeader h3, h2, h3") or sec.find_previous(["h2", "h3"])
        sec_title = _clean_text(header_el) if header_el else "Information"

        props: Dict[str, str] = {}
        for row in sec.select(".form-group"):
            lbl = row.select_one(".il_InfoScreenProperty, label, .control-label, .il-property-name")
            val = row.select_one(".il_InfoScreenPropertyValue, .form-control-static, .il-property-value, p")
            if lbl and val:
                k = _clean_text(lbl)
                v = _clean_text(val)
                if not v:
                    img = val.select_one("img")
                    if img and img.get("alt"):
                        v = img.get("alt")
                if k and v:
                    props[k] = v

        if not props:
            for dt, dd in zip(sec.select("dt"), sec.select("dd")):
                props[_clean_text(dt)] = _clean_text(dd)

        if props:
            sections.append(ExerciseInfoSection(title=sec_title, properties=props))

    return ExerciseInfoResponse(ref_id=ref_id, title=title, sections=sections)


class StudentUploadFormInfo(BaseModel):
    upload_url: Optional[str] = None
    form_action: Optional[str] = None
    input_name: str = "form/input_0/input_1"
    file_identifier: str = "filename"
    hidden_inputs: Dict[str, str] = Field(default_factory=dict)


@safe_parser(context_name="student_upload_form")
def parse_student_upload_form(
    html_content: str, base_url: str = settings.ilias_base_url
) -> StudentUploadFormInfo:
    """
    Parses the ILIAS student file upload form screen (cmdClass=ilExSubmissionFileGUI&cmd=uploadForm).
    Extracts the Repo Standard Upload Handler AJAX URL, file identifier, form action,
    input field name, and any hidden inputs.
    """
    soup = BeautifulSoup(html_content, "lxml")
    upload_url: Optional[str] = None
    file_identifier = "filename"
    form_action: Optional[str] = None
    input_name = "form/input_0/input_1"
    hidden_inputs: Dict[str, str] = {}

    # 1. Locate the addUpload form
    form = soup.find("form", action=lambda a: bool(a and ("addUpload" in a or "ilexercisehandlergui" in a)))
    if not form:
        form = soup.find("form", enctype="multipart/form-data")

    if form:
        if form.has_attr("action"):
            form_action = urllib.parse.urljoin(base_url, form["action"])
        for inp in form.find_all("input", type="hidden"):
            name = inp.get("name")
            val = inp.get("value", "")
            if name:
                hidden_inputs[name] = val

    # 2. Locate the file input field name
    field_elem = soup.find("fieldset", attrs={"data-il-ui-component": "file-field-input"})
    if field_elem and field_elem.get("data-il-ui-input-name"):
        input_name = field_elem["data-il-ui-input-name"]

    # 3. Locate the Dropzone / Repo upload URL and file_identifier in the JS initialization
    for script in soup.find_all("script"):
        text = script.string or ""
        if "Input.File.init" in text:
            m = re.search(
                r"Input\.File\.init\(\s*['\"][^'\"]+['\"],\s*['\"]([^'\"]+)['\"],\s*['\"]([^'\"]*)['\"],\s*['\"]([^'\"]+)['\"]",
                text,
            )
            if m:
                raw_upload_url = m.group(1)
                file_identifier = m.group(3)
                if raw_upload_url:
                    upload_url = urllib.parse.urljoin(base_url, raw_upload_url)
                break

    return StudentUploadFormInfo(
        upload_url=upload_url,
        form_action=form_action,
        input_name=input_name,
        file_identifier=file_identifier,
        hidden_inputs=hidden_inputs,
    )

