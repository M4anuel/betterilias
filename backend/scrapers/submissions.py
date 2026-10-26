from backend.i18n import t
import re
import urllib.parse
from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from backend.config import settings
from backend.schemas import (
    AssignmentItem,
    CourseUserCandidate,
    ExerciseInfo,
    ExerciseInfoResponse,
    ExerciseInfoSection,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    StudentAssignmentDetail,
    SubmissionFile,
    SubmissionItem,
    TeamMemberInfo,
)
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser
from backend.scrapers.materials import _extract_breadcrumbs


def _instruction_html(element) -> str:
    """Preserve native instruction markup without executable page content."""
    fragment = BeautifulSoup(element.decode_contents(), 'html.parser')
    for node in fragment.select('script, style, iframe, object, embed, template'):
        node.decompose()
    for node in fragment.find_all(True):
        for name in list(node.attrs):
            if name.lower().startswith('on') or name.lower() == 'srcdoc':
                del node[name]
        for name in ('href', 'src', 'xlink:href'):
            if node.has_attr(name):
                url = re.sub(r'[\x00-\x20]', '', node[name])
                if urllib.parse.urlparse(url).scheme.lower() not in ('', 'http', 'https', 'mailto'):
                    del node[name]
        if node.get('target') == '_blank':
            node['rel'] = 'noopener noreferrer'
    return fragment.decode_contents().strip()


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
    exercise_title = _clean_text(title_elem) or t("Exercise {p0}", p0=exercise_ref_id)

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
            elif urllib.parse.parse_qs(urllib.parse.urlparse(full_url).query).get("cmd", [""])[0].lower() == "showteamlog" or "log" in el_text:
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

    # Title: prefer primary assignment panel title over generic exercise container header ("Übungen")
    primary_panel_title = soup.select_one(".panel-primary > .panel-heading .panel-title, .panel-primary .panel-title")
    title_el = (
        primary_panel_title
        or soup.select_one("h1.ilHeader, h1.il-item-title, h1:not(.modal-title)")
        or soup.select_one(".panel-title")
        or soup.select_one(".ilTopTitle")
    )
    title = _clean_text(title_el) or t("Assignment {p0}", p0=ass_id)

    sub_panels = soup.select("div.panel.panel-sub")
    panels = sub_panels if sub_panels else soup.find_all("div", class_="panel")

    instructions = None
    is_team_upload = False
    start_time = None
    ended_on = None
    time_remaining = None
    is_ended = False
    exercise_files: List[SubmissionFile] = []
    team_members: List[str] = []
    team_member_details: List[TeamMemberInfo] = []
    team_status_text = None
    create_team_url = None
    manage_team_url = None
    delete_team_url = None
    upload_form_url = None
    submission_screen_url = None
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
            # First check structured .caption blocks inside .il-card (collapses multi-line values cleanly)
            for cap in body.select(".caption"):
                cap_line = _clean_text(cap)
                if ":" not in cap_line:
                    continue
                low = cap_line.lower()
                val = cap_line.split(":", 1)[1].strip()
                if any(w in low for w in ["startzeit", "start time"]) and val:
                    start_time = val
                elif any(w in low for w in ["ended on", "edit until", "abgabetermin", "abgabe bis", "bearbeiten bis"]) and val:
                    ended_on = val
                elif any(w in low for w in ["remaining", "verbleibende"]) and val:
                    time_remaining = val

            raw_lines = [l.strip() for l in body.get_text(separator="\n").split("\n") if l.strip()]
            for idx, line in enumerate(raw_lines):
                low = line.lower()
                if ":" in line:
                    val = line.split(":", 1)[1].strip()
                    if not val and idx + 1 < len(raw_lines) and ":" not in raw_lines[idx + 1]:
                        val = raw_lines[idx + 1].strip()
                    if any(w in low for w in ["startzeit", "start time"]) and val and not start_time:
                        start_time = val
                    elif any(w in low for w in ["ended on", "edit until", "abgabetermin", "abgabe bis", "bearbeiten bis"]) and val and not ended_on:
                        ended_on = val
                    elif any(w in low for w in ["remaining", "verbleibende"]) and val and not time_remaining:
                        time_remaining = val

            body_text = body.get_text()
            if "time is up" in body_text.lower() or "abgelaufen" in body_text.lower():
                is_ended = True
                time_remaining = t('schedule.time_up')

            inst_p = body.select_one(".ilAssignmentInstructions")
            if not inst_p:
                col8 = body.select_one(".col-sm-8")
                if col8 and _clean_text(col8):
                    inst_p = col8
                else:
                    for cand_p in body.find_all("p"):
                        if not cand_p.find_parent(class_="il-card"):
                            inst_p = cand_p
                            break
            if inst_p and _clean_text(inst_p):
                instructions = _instruction_html(inst_p)

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
            is_team_upload = True
            for el in p.find_all(["a", "button"]):
                el_txt = _clean_text(el)
                raw_target = el.get("href") or el.get("data-action")
                if not raw_target:
                    continue
                full_target = urllib.parse.urljoin(settings.ilias_base_url, raw_target)
                if re.search(r"(manage|verwalten)", el_txt, re.I) or "submissionScreenTeam" in raw_target:
                    manage_team_url = full_target
                elif re.search(r"(create|erstellen)", el_txt, re.I) or "createTeam" in raw_target:
                    create_team_url = full_target
                elif re.search(r"(delete|löschen)", el_txt, re.I) or "confirmDeleteTeam" in raw_target:
                    delete_team_url = full_target

            text = body.get_text(separator=" ")
            members_match = re.findall(r"\[([^\]]+)\]", text)
            if members_match:
                team_members = members_match
                for m in re.finditer(r"(?:([^;\[\n\r]+?)\s*)?\[([^\]]+)\]", text):
                    raw_prefix = (m.group(1) or "").strip()
                    login_val = m.group(2).strip()
                    for lbl in ["Team Members", "Team-Mitglieder", "Teammitglieder", "Team"]:
                        if raw_prefix.lower().startswith(lbl.lower()):
                            raw_prefix = raw_prefix[len(lbl):].strip()
                    member_name = raw_prefix if raw_prefix else None
                    team_member_details.append(
                        TeamMemberInfo(
                            login=login_val,
                            name=member_name,
                            is_self=(len(members_match) == 1),
                        )
                    )
            elif "keinem team" in text.lower() or "not assigned to a team" in text.lower():
                team_status_text = t('Sie gehören noch keinem Team an.')

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

            if last_submission and last_submission not in ["Bisher keine Abgabe", "No submission yet.", "-"]:
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

    # Scan all links/buttons for direct upload or submission screen actions
    for el in soup.find_all(["a", "button"]):
        raw_act = el.get("href") or el.get("data-action") or ""
        if "ilExSubmissionFileGUI" in raw_act:
            full_act = urllib.parse.urljoin(settings.ilias_base_url, raw_act)
            if "cmd=uploadForm" in raw_act:
                upload_form_url = full_act
            elif "cmd=submissionScreen" in raw_act:
                submission_screen_url = full_act

    return StudentAssignmentDetail(
        exercise_ref_id=exercise_ref_id,
        ass_id=ass_id,
        title=title,
        instructions=instructions,
        start_time=start_time,
        is_team_upload=is_team_upload,
        ended_on=ended_on,
        time_remaining=time_remaining,
        is_ended=is_ended,
        exercise_files=exercise_files,
        team_members=team_members,
        team_member_details=team_member_details,
        team_status_text=team_status_text,
        create_team_url=create_team_url,
        manage_team_url=manage_team_url,
        delete_team_url=delete_team_url,
        upload_form_url=upload_form_url,
        submission_screen_url=submission_screen_url,
        submitted_files=submitted_files,
        last_submission=last_submission,
        submission_status=submission_status,
        evaluation_statement=evaluation_statement,
        passed_status=passed_status,
        mark=mark,
    )


class ParsedTeamManagementScreen(BaseModel):
    members: List[TeamMemberInfo] = Field(default_factory=list)
    remove_form_action: Optional[str] = None
    remove_hidden_fields: Dict[str, str] = Field(default_factory=dict)
    add_autocomplete_action: Optional[str] = None
    list_users_url: Optional[str] = None
    avatar_abbrev: Optional[str] = None
    alert_error: Optional[str] = None


@safe_parser(context_name="team_management_screen")
def parse_team_management_screen(
    html_content: str, base_url: str = settings.ilias_base_url
) -> ParsedTeamManagementScreen:
    """
    Parses the ILIAS Team Management page (ilExSubmissionTeamGUI&cmd=submissionScreenTeam).
    Extracts current team members with their ILIAS user IDs (checkbox id[]),
    form action URLs for removing members and adding users from the course,
    and identifies the current user via avatar initials or single-member heuristics.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Extract avatar abbreviation if present (e.g., "MF" for m.fluckiger2)
    abbrev_el = soup.select_one(".il-avatar .abbreviation")
    avatar_abbrev = _clean_text(abbrev_el).upper() if abbrev_el else None

    # Check for failure alert
    alert_el = soup.select_one(".alert-danger, .ilFailureMessage")
    alert_error = _clean_text(alert_el) if alert_el else None

    # 1. Toolbar form (ilRepositorySearchGUI) & "Add Users From Current Course" button
    add_autocomplete_action = None
    list_users_url = None

    toolbar_form = soup.find("form", id="ilToolbar") or soup.find(
        "form", action=lambda a: bool(a and "ilRepositorySearchGUI" in a)
    )
    if toolbar_form and toolbar_form.get("action"):
        add_autocomplete_action = urllib.parse.urljoin(base_url, toolbar_form["action"])

    for btn in soup.find_all(["button", "a"]):
        raw_act = btn.get("data-action") or btn.get("href") or ""
        if "ilRepositorySearchGUI" in raw_act and "cmd=listUsers" in raw_act:
            list_users_url = urllib.parse.urljoin(base_url, raw_act)
            break

    if not list_users_url and add_autocomplete_action:
        # Derive listUsers URL from toolbar form action
        derived = re.sub(r"cmd=[^&]+", "cmd=listUsers", add_autocomplete_action)
        derived = re.sub(r"&rtoken=[^&]+", "", derived)
        list_users_url = derived

    # 2. Team members table form (ilExSubmissionTeamGUI)
    remove_form_action = None
    remove_hidden_fields: Dict[str, str] = {}
    members: List[TeamMemberInfo] = []

    team_form = soup.find(
        "form", action=lambda a: bool(a and "ilExSubmissionTeamGUI" in a and "cmd=post" in a)
    )
    if team_form:
        if team_form.get("action"):
            remove_form_action = urllib.parse.urljoin(base_url, team_form["action"])
        for inp in team_form.find_all("input", type="hidden"):
            name = inp.get("name")
            if name and name != "id[]":
                remove_hidden_fields[name] = inp.get("value", "")

        table = team_form.select_one("table.table-striped") or soup.select_one("table.table-striped") or team_form.select_one("table")
    else:
        table = soup.select_one("table.table-striped") or soup.select_one("table")

    if table:
        for tr in table.select("tbody tr"):
            cb = tr.find("input", {"name": "id[]"})
            user_id = cb.get("value") if cb else None
            cells = tr.find_all("td")
            if not cells:
                continue
            name_cell_text = _clean_text(cells[-1])
            if not name_cell_text or "keine" in name_cell_text.lower() or "empty" in name_cell_text.lower():
                continue

            m_login = re.search(r"\[([^\]]+)\]", name_cell_text)
            if m_login:
                login = m_login.group(1).strip()
                prefix = name_cell_text[: m_login.start()].strip()
                full_name = prefix if prefix else None
            else:
                login = name_cell_text
                full_name = None

            members.append(
                TeamMemberInfo(
                    user_id=user_id,
                    login=login,
                    name=full_name,
                    is_self=False,
                )
            )

    # Identify self among members
    if len(members) == 1:
        members[0].is_self = True
    elif len(members) > 1 and avatar_abbrev and len(avatar_abbrev) == 2:
        for m in members:
            # Check login pattern e.g. "m.fluckiger2" -> "MF"
            parts = re.split(r"[._\-]", m.login)
            if len(parts) >= 2 and parts[0] and parts[1]:
                initials = (parts[0][0] + parts[1][0]).upper()
                if initials == avatar_abbrev:
                    m.is_self = True
                    break
            if m.name:
                name_parts = [p for p in m.name.split() if p]
                if len(name_parts) >= 2:
                    initials = (name_parts[0][0] + name_parts[-1][0]).upper()
                    if initials == avatar_abbrev:
                        m.is_self = True
                        break

    return ParsedTeamManagementScreen(
        members=members,
        remove_form_action=remove_form_action,
        remove_hidden_fields=remove_hidden_fields,
        add_autocomplete_action=add_autocomplete_action,
        list_users_url=list_users_url,
        avatar_abbrev=avatar_abbrev,
        alert_error=alert_error,
    )


class ParsedCourseUserListScreen(BaseModel):
    current_user_id: Optional[str] = None
    add_user_form_action: Optional[str] = None
    hidden_fields: Dict[str, str] = Field(default_factory=dict)
    max_rows_url: Optional[str] = None
    has_next_page: bool = False
    candidates: List[CourseUserCandidate] = Field(default_factory=list)


@safe_parser(context_name="course_users_list_screen")
def parse_course_users_list_screen(
    html_content: str, base_url: str = settings.ilias_base_url
) -> ParsedCourseUserListScreen:
    """
    Parses the ILIAS Repository Search course user list page (ilRepositorySearchGUI&cmd=listUsers / storedUserList).
    Extracts current_user_id from rep_search_<uid>_table_nav, pagination max_rows_url (_trows=800),
    form action for cmd[addUser], and all listed course participants.
    """
    soup = BeautifulSoup(html_content, "lxml")

    current_user_id = None
    m_uid = re.search(r"rep_search_(\d+)_(?:table_nav|trows)|tblfsh?rep_search_(\d+)", html_content)
    if m_uid:
        current_user_id = m_uid.group(1) or m_uid.group(2)

    form = soup.find(
        "form", action=lambda a: bool(a and "ilRepositorySearchGUI" in a and "cmd=post" in a)
    )
    add_user_form_action = None
    hidden_fields: Dict[str, str] = {}
    if form:
        if form.get("action"):
            add_user_form_action = urllib.parse.urljoin(base_url, form["action"])
        for inp in form.find_all("input", type="hidden"):
            name = inp.get("name")
            if name and name != "user[]":
                hidden_fields[name] = inp.get("value", "")

    # Check if there is pagination ("Next" / "Weiter") and a "_trows=800" link
    has_next_page = False
    max_rows_url = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        txt = _clean_text(a).lower()
        if "storeduserlist" in href.lower():
            if txt in ["next", "weiter", ">", "»"]:
                has_next_page = True
            if "trows=800" in href:
                max_rows_url = urllib.parse.urljoin(base_url, href)

    # Parse candidate rows from table.table-striped
    candidates: List[CourseUserCandidate] = []
    table = (form.select_one("table.table-striped") if form else None) or soup.select_one("table.table-striped")
    if table:
        # Determine column indices from thead (note: checkbox column can be <td> inside <thead>)
        thead_tr = table.select_one("thead tr")
        headers = [_clean_text(cell).lower() for cell in thead_tr.find_all(["th", "td"])] if thead_tr else []
        last_idx, first_idx, login_idx = 1, 2, 3
        for idx, h in enumerate(headers):
            if any(k in h for k in ["last name", "nachname"]):
                last_idx = idx
            elif any(k in h for k in ["first name", "vorname"]):
                first_idx = idx
            elif any(k in h for k in ["login", "benutzername", "account"]):
                login_idx = idx

        for tr in table.select("tbody tr"):
            cb = tr.find("input", {"name": "user[]"})
            if not cb or not cb.get("value"):
                continue
            uid = cb["value"].strip()
            tds = tr.find_all("td")
            lastname = _clean_text(tds[last_idx]) if len(tds) > last_idx else ""
            firstname = _clean_text(tds[first_idx]) if len(tds) > first_idx else ""
            login = _clean_text(tds[login_idx]) if len(tds) > login_idx else ""

            full_name = f"{firstname} {lastname}".strip()
            candidates.append(
                CourseUserCandidate(
                    user_id=uid,
                    login=login,
                    firstname=firstname,
                    lastname=lastname,
                    full_name=full_name,
                    in_team=False,
                    is_self=bool(current_user_id and uid == current_user_id),
                )
            )

    return ParsedCourseUserListScreen(
        current_user_id=current_user_id,
        add_user_form_action=add_user_form_action,
        hidden_fields=hidden_fields,
        max_rows_url=max_rows_url,
        has_next_page=has_next_page,
        candidates=candidates,
    )


class ParsedTeamConfirmRemoveScreen(BaseModel):
    action_url: Optional[str] = None
    member_ids: List[str] = Field(default_factory=list)
    hidden_fields: Dict[str, str] = Field(default_factory=dict)
    confirm_cmd_name: str = "cmd[removeTeamMember]"
    confirm_cmd_value: str = "Remove"


@safe_parser(context_name="remove_team_confirmation_screen")
def parse_remove_team_confirmation_screen(
    html_content: str, base_url: str = settings.ilias_base_url
) -> ParsedTeamConfirmRemoveScreen:
    """
    Parses the ILIAS confirmation dialog when removing team members or deleting a team
    (e.g. manage_team_remove_teammate_dialog.html).
    """
    soup = BeautifulSoup(html_content, "lxml")

    form = soup.find(
        "form", action=lambda a: bool(a and "ilExSubmissionTeamGUI" in a and "cmd=post" in a)
    )
    if not form:
        return ParsedTeamConfirmRemoveScreen()

    action_url = urllib.parse.urljoin(base_url, form["action"]) if form.get("action") else None
    member_ids: List[str] = []
    hidden_fields: Dict[str, str] = {}

    for inp in form.find_all("input", type="hidden"):
        name = inp.get("name")
        val = inp.get("value", "")
        if name == "id[]":
            if val and val not in member_ids:
                member_ids.append(val)
        elif name:
            hidden_fields[name] = val

    confirm_cmd_name = "cmd[removeTeamMember]"
    confirm_cmd_value = "Remove"
    for sub in form.find_all("input", type="submit"):
        name = sub.get("name", "")
        if name and "cancel" not in name.lower() and "submissionscreenteam" not in name.lower():
            confirm_cmd_name = name
            confirm_cmd_value = sub.get("value", "Remove")
            break

    return ParsedTeamConfirmRemoveScreen(
        action_url=action_url,
        member_ids=member_ids,
        hidden_fields=hidden_fields,
        confirm_cmd_name=confirm_cmd_name,
        confirm_cmd_value=confirm_cmd_value,
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

    # Ignore calendars, navigation tables and empty placeholder rows. Only an
    # actual delivered-file control/download identifies a submission record.
    rows = [row for row in soup.select('table tbody tr')
            if row.select_one("input[name='delivered[]'], a[href*='cmd=download'][href*='delivered=']")]
    for r in rows:
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
        table = r.find_parent('table')
        headers = table.select('thead tr')
        if headers:
            columns = headers[-1].find_all(['th', 'td'], recursive=False)
            for index, column in enumerate(columns):
                if index < len(cells) and (column.select_one("a[href*='timestamp']") or
                        _clean_text(column).lower() in ('date', 'datum')):
                    upload_time = _clean_text(cells[index]) or None
                    break
        for c in cells:
            if upload_time:
                break
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
    exercise_title = _clean_text(title_el) or t("Exercise {p0}", p0=exercise_ref_id)

    # Extract Breadcrumbs
    breadcrumbs = _extract_breadcrumbs(soup)

    # Extract TA "Submissions and Grades" link
    ta_link = None
    ta_a = soup.find("a", string=re.compile(r"(Submissions and Grades|Abgaben und Noten|Teilnehmer|Members)", re.IGNORECASE))
    if ta_a and ta_a.has_attr("href"):
        ta_link = urllib.parse.urljoin(settings.ilias_base_url, ta_a["href"])

    # Extract TA "Edit" / "Bearbeiten" assignments link
    edit_assignments_url = None
    edit_a = soup.find("a", string=re.compile(r"^\s*(Edit|Bearbeiten)\s*$", re.IGNORECASE)) or soup.find(
        "a", href=lambda h: bool(h and "ilExAssignmentEditorGUI" in h and "listAssignments" in h)
    )
    if edit_a and edit_a.has_attr("href"):
        edit_assignments_url = urllib.parse.urljoin(settings.ilias_base_url, edit_a["href"])

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
        edit_assignments_url=edit_assignments_url,
        has_ta_access=bool(ta_link or edit_assignments_url),
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
    title = _clean_text(title_el) or t("Exercise information {p0}", p0=ref_id)

    sections: List[ExerciseInfoSection] = []
    sec_elems = soup.select(".ilInfoScreenSec")
    for sec in sec_elems:
        header_el = sec.select_one(".ilFormHeader h2, .ilFormHeader h3, h2, h3") or sec.find_previous(["h2", "h3"])
        sec_title = _clean_text(header_el) if header_el else t("Informationen")

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
    input_name: Optional[str] = None
    token_input_name: Optional[str] = None
    file_identifier: Optional[str] = None
    file_field: str = "file"
    max_files: Optional[int] = None
    current_files: int = 0
    max_size: Optional[int] = None
    disabled: bool = False
    chunked: bool = False
    chunk_size: Optional[int] = None
    hidden_inputs: Dict[str, str] = Field(default_factory=dict)


@safe_parser(context_name="student_upload_form")
def parse_student_upload_form(
    html_content: str, base_url: str = settings.ilias_base_url
) -> StudentUploadFormInfo:
    return parse_native_file_upload_form(html_content, base_url, command='addUpload')


@safe_parser(context_name='native_file_upload_form')
def parse_native_file_upload_form(
    html_content: str, base_url: str = settings.ilias_base_url, *, command: str,
) -> StudentUploadFormInfo:
    """
    Parses the ILIAS student file upload form screen (cmdClass=ilExSubmissionFileGUI&cmd=uploadForm).
    Extracts the Repo Standard Upload Handler AJAX URL, file identifier, form action,
    input field name, and any hidden inputs.
    """
    import ast
    from html import unescape

    soup = BeautifulSoup(html_content, "lxml")
    info = StudentUploadFormInfo()
    form = next((form for form in soup.find_all('form')
                 if urllib.parse.parse_qs(urllib.parse.urlparse(form.get('action', '')).query).get('cmd') == [command]
                 and form.select_one('[data-il-ui-component="file-field-input"]')), None)
    if form is None:
        return info

    info.form_action = urllib.parse.urljoin(base_url, form['action'])
    field = form.select_one('[data-il-ui-component="file-field-input"]')
    info.input_name = field.get('data-il-ui-input-name')
    for inp in form.select('input[type="hidden"][name]'):
        if inp.find_parent('template') is None and field not in inp.parents and not inp.has_attr('disabled'):
            info.hidden_inputs[inp['name']] = inp.get('value', '')

    # Live HTML contains the dynamic token input; browser-saved pages can have an
    # empty <template>. ILIAS DynamicInputsNameSource defines its fallback name.
    if info.input_name:
        tokens = [inp for inp in field.select('input[type="hidden"][name]')
                  if inp['name'].startswith(info.input_name + '[')]
        info.token_input_name = tokens[-1]['name'] if tokens else f'{info.input_name}[input_0][]'

    for script in soup.find_all('script'):
        text = script.string or ''
        for match in re.finditer(r'\b(?:il\.)?UI\.Input\.File\.init\s*\(', text):
            args = _student_upload_js_arguments(text, match.end())
            if len(args) < 9:
                continue
            # Decode string literals only, never execute JavaScript from ILIAS.
            try:
                widget_id = ast.literal_eval(args[0])
            except (ValueError, SyntaxError):
                continue
            if widget_id != field.get('id'):
                continue
            strings = [ast.literal_eval(value.replace(r'\/', '/')) for value in args[:4]]
            info.upload_url = urllib.parse.urljoin(base_url, unescape(strings[1])) if strings[1] else None
            info.file_identifier = strings[3] or None
            info.current_files = int(args[4])
            info.max_files = int(args[5])
            info.max_size = int(args[6])
            info.disabled = args[8].strip() == 'true'
            info.chunked = len(args) > 10 and args[10].strip() == 'true'
            info.chunk_size = int(args[11]) if len(args) > 11 else None
            # Dropzone appends an index when uploadMultiple is enabled, even
            # when only one file is sent (parallelUploads is 1 in ILIAS).
            info.file_field = 'file[0]' if info.max_files > 1 and not info.chunked else 'file'
            return info
    return info


def _student_upload_js_arguments(text: str, start: int) -> List[str]:
    """Split a literal JS call while respecting strings and nested JSON."""
    args, depth, quote, escaped, token_start = [], 0, None, False, start
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
        elif char in ('"', "'", '`'):
            quote = char
        elif char in '([{':
            depth += 1
        elif char == ')' and depth == 0:
            args.append(text[token_start:index].strip())
            return args
        elif char in ')]}':
            depth -= 1
        elif char == ',' and depth == 0:
            args.append(text[token_start:index].strip())
            token_start = index + 1
    return []


@safe_parser(context_name='student_submission_navigation')
def parse_student_submission_navigation(
    html_content: str, ref_id: str, ass_id: str, base_url: str = settings.ilias_base_url,
) -> Dict[str, str]:
    """Read the current user's controller links for this assignment only."""
    soup = BeautifulSoup(html_content, 'lxml')
    links = {}
    for element in soup.select('a[href], button[data-action]'):
        url = urllib.parse.urljoin(base_url, element.get('href') or element.get('data-action', ''))
        query = {key.lower(): value for key, value in urllib.parse.parse_qs(urllib.parse.urlparse(url).query).items()}
        if query.get('ref_id') != [ref_id] or query.get('ass_id') != [ass_id]:
            continue
        controller = query.get('cmdclass', [''])[0].lower()
        command = query.get('cmd', [''])[0].lower()
        if controller == 'ilassignmentpresentationgui':
            links.setdefault('presentation', url)
        elif controller == 'ilexsubmissionfilegui' and command in ('submissionscreen', 'uploadform'):
            links.setdefault('submission' if command == 'submissionscreen' else 'upload', url)
    return links


@safe_parser(context_name='student_upload_errors')
def parse_student_upload_errors(html_content: str) -> Optional[str]:
    soup = BeautifulSoup(html_content, 'lxml')
    messages = []
    for element in soup.select('.alert-danger, .ilFailureMessage, .c-input__error, .ilFormError'):
        if element.find_parent(['template']) or element.find_parent(class_=re.compile(r'\bmodal(?:-dialog)?\b')):
            continue
        message = element.get_text(' ', strip=True)
        if message and message not in messages:
            messages.append(message)
    return '\n'.join(messages) or None



@safe_parser(context_name="team_first_added_member")
def parse_team_first_added_member(html_content: str) -> Optional[str]:
    """Read the first addition from a team log requested in timestamp ascending order.

    Creation events and the actor column do not identify the first student.
    Preserve row order for events with identical displayed timestamps.
    """
    soup = BeautifulSoup(html_content, "lxml")
    additions = []
    months = {
        "jan": 1, "feb": 2, "mar": 3, "mär": 3, "apr": 4,
        "may": 5, "mai": 5, "jun": 6, "jul": 7, "aug": 8,
        "sep": 9, "oct": 10, "okt": 10, "nov": 11, "dec": 12, "dez": 12,
    }
    for row in soup.select("table tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 3:
            continue
        details = _clean_text(cells[2])
        match = re.fullmatch(r"Added member (.+?)\.", details, re.I)
        if not match:
            match = re.fullmatch(r"Mitglied (.+?) hinzugef[üu]gt\.", details, re.I)
        if match:
            date = re.search(r"(\d{1,2})\.\s*(\d{1,2}|[^\W\d_]+)\.?\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?", _clean_text(cells[0]))
            timestamp = None
            if date:
                day, month, year, hour, minute, second = date.groups()
                month = int(month) if month.isdigit() else months.get(month.casefold()[:3])
                if month:
                    timestamp = (int(year), month, int(day), int(hour), int(minute), int(second or 0))
            additions.append((timestamp, match.group(1).strip()))
    if not additions:
        return None
    if all(timestamp is not None for timestamp, _ in additions):
        return min(additions, key=lambda item: item[0])[1]
    # The service explicitly requests ascending timestamps, even if a future
    # ILIAS date format is not recognized here.
    return additions[0][1]


def first_added_surname(name: str, members: List[str]) -> str:
    """Resolve the log's given-name-first name using native surname-first names."""
    normalized = " ".join(name.casefold().split())
    for member in members:
        surname, separator, given = member.partition(",")
        if separator and " ".join(f"{given} {surname}".casefold().split()) == normalized:
            return surname.strip()
    # The original member may have left the team and no longer appear in its row.
    return name.partition(",")[0].strip() if "," in name else name.split()[-1]
