import logging
import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import (
    TAAssignmentDetailResponse,
    TAAssignmentListItem,
    TAAssignmentListResponse,
    TAInstructionFileItem,
)
from backend.scrapers.dumper import safe_parser

logger = logging.getLogger(__name__)


def _clean_text(elem) -> str:
    if not elem:
        return ""
    return " ".join(elem.get_text().split()).strip()


@safe_parser(context_name="ta_assignments_list")
def parse_ta_assignments_list(html_content: str, exercise_ref_id: str) -> TAAssignmentListResponse:
    """
    Parses the ILIAS TA assignment editor overview table (ilExAssignmentEditorGUI&cmd=listAssignments).
    Extracts assignments, ordering values, submission types, deadlines, and CSRF token.
    """
    soup = BeautifulSoup(html_content, "lxml")
    assignments: List[TAAssignmentListItem] = []

    # 1. Locate the assignments order / deletion form
    form = soup.find(
        "form",
        action=lambda a: bool(
            a and "ilExAssignmentEditorGUI" in a and ("saveAssignmentOrder" in a or "post" in a)
        ),
    )
    form_action_url = None
    rtoken = None

    if form and form.get("action"):
        raw_act = form["action"]
        form_action_url = urllib.parse.urljoin(settings.ilias_base_url, raw_act)
        m_tok = re.search(r"rtoken=([a-f0-9]+)", raw_act)
        if m_tok:
            rtoken = m_tok.group(1)

    # 2. Locate the assignments table
    table = None
    if form:
        table = form.find("table")
    if not table:
        table = soup.find("table", class_=lambda c: bool(c and "table-striped" in c))

    if table:
        for tr in table.find_all("tr"):
            cb = tr.find("input", attrs={"name": "id[]"})
            if not cb or not cb.get("value"):
                continue

            ass_id = cb["value"].strip()

            # Find presentation order
            order_input = tr.find("input", attrs={"name": f"order[{ass_id}]"}) or tr.find(
                "input", attrs={"name": re.compile(rf"^order\[{ass_id}\]", re.I)}
            )
            order_val = 0
            if order_input and order_input.get("value"):
                try:
                    order_val = int(order_input["value"].strip())
                except ValueError:
                    order_val = 0

            tds = tr.find_all("td")
            # Typical columns:
            # 0: Selection checkbox
            # 1: Title (with edit link)
            # 2: Type of Submission
            # 3: Presentation Order
            # 4: Start Time
            # 5: Deadline
            # 6: Mandatory
            # 7: Peer-Feedback
            # 8: Work Instructions
            # 9: Actions

            title = f"Assignment {ass_id}"
            edit_url = None
            if len(tds) > 1:
                title_cell = tds[1]
                title = _clean_text(title_cell)
                edit_a = title_cell.find("a", href=True)
                if edit_a:
                    edit_url = urllib.parse.urljoin(settings.ilias_base_url, edit_a["href"])

            if not edit_url:
                edit_link_elem = tr.find("a", href=re.compile(r"cmd=editAssignment", re.I))
                if edit_link_elem:
                    edit_url = urllib.parse.urljoin(settings.ilias_base_url, edit_link_elem["href"])

            type_name = "File"
            type_id = 1
            if len(tds) > 2:
                raw_type = _clean_text(tds[2])
                if raw_type:
                    type_name = raw_type
                    low = raw_type.lower()
                    if "team" in low:
                        type_id = 4
                    elif "blog" in low:
                        type_id = 2
                    elif "portfolio" in low:
                        type_id = 3
                    else:
                        type_id = 1

            start_time = None
            if len(tds) > 4:
                st = _clean_text(tds[4])
                if st and st != "-":
                    start_time = st

            deadline = None
            if len(tds) > 5:
                dl = _clean_text(tds[5])
                if dl and dl != "-":
                    deadline = dl

            mandatory = True
            if len(tds) > 6:
                m_txt = _clean_text(tds[6]).lower()
                if any(k in m_txt for k in ["no", "nein", "false", "0"]):
                    mandatory = False

            has_work_instructions = False
            instruction_files_count = 0
            if len(tds) > 8:
                wi_text = _clean_text(tds[8])
                if wi_text:
                    has_work_instructions = True
                    m_f = re.search(r"(\d+)\s*file", wi_text, re.I)
                    if m_f:
                        instruction_files_count = int(m_f.group(1))

            assignments.append(
                TAAssignmentListItem(
                    ass_id=ass_id,
                    title=title,
                    order_val=order_val,
                    type_name=type_name,
                    type_id=type_id,
                    start_time=start_time,
                    deadline=deadline,
                    mandatory=mandatory,
                    instruction_files_count=instruction_files_count,
                    has_work_instructions=has_work_instructions,
                    edit_url=edit_url,
                )
            )

    return TAAssignmentListResponse(
        exercise_ref_id=exercise_ref_id,
        assignments=assignments,
        form_action_url=form_action_url,
        rtoken=rtoken,
    )


@safe_parser(context_name="ta_assignment_form")
def parse_ta_assignment_form(
    html_content: str, exercise_ref_id: str, ass_id: Optional[str] = None
) -> TAAssignmentDetailResponse:
    """
    Parses the ILIAS assignment creation or edit form (addAssignment / editAssignment).
    Extracts title, submission type, mandatory flag, HTML instructions, schedule dates,
    and CSRF tokens.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Locate main form
    form = soup.find(
        "form",
        action=lambda a: bool(
            a and "ilExAssignmentEditorGUI" in a and ("saveAssignment" in a or "post" in a)
        ),
    )
    form_action = None
    rtoken = None
    hidden_inputs: Dict[str, str] = {}

    if form:
        if form.get("action"):
            raw_act = form["action"]
            form_action = urllib.parse.urljoin(settings.ilias_base_url, raw_act)
            m_tok = re.search(r"rtoken=([a-f0-9]+)", raw_act)
            if m_tok:
                rtoken = m_tok.group(1)

        for inp in form.find_all("input", type="hidden"):
            n = inp.get("name")
            v = inp.get("value", "")
            if n:
                hidden_inputs[n] = v

        for rad in form.find_all("input", type="radio"):
            if rad.has_attr("checked") and rad.get("name"):
                hidden_inputs[rad["name"]] = rad.get("value", "")

    # 1. Title
    title = ""
    title_inp = soup.find("input", attrs={"name": "title"})
    if title_inp and title_inp.get("value"):
        title = title_inp["value"].strip()

    # 2. Type
    type_id = 1
    type_name = "File"
    type_select = soup.find("select", attrs={"name": "type"})
    if type_select:
        sel_opt = type_select.find("option", selected=True)
        if sel_opt and sel_opt.get("value"):
            try:
                type_id = int(sel_opt["value"])
                type_name = _clean_text(sel_opt)
            except ValueError:
                pass
    else:
        type_hidden = soup.find("input", attrs={"name": "type", "type": "hidden"})
        if type_hidden and type_hidden.get("value"):
            try:
                type_id = int(type_hidden["value"])
                if type_id == 4:
                    type_name = "Team Upload"
                elif type_id == 2:
                    type_name = "Blog"
                elif type_id == 3:
                    type_name = "Portfolio"
            except ValueError:
                pass

    # 3. Mandatory
    mandatory = True
    mand_inp = soup.find("input", attrs={"name": "mandatory"})
    if mand_inp:
        mandatory = mand_inp.has_attr("checked")

    # 4. Work Instructions (HTML content inside textarea)
    instruction_html = ""
    inst_ta = soup.find("textarea", attrs={"name": "instruction"})
    if inst_ta:
        instruction_html = inst_ta.get_text()

    # 5. Start Time
    start_time = None
    st_inp = soup.find("input", attrs={"name": "start_time"})
    if st_inp and st_inp.get("value"):
        start_time = st_inp["value"].strip()

    # 6. Deadline mode & Deadline
    # In ILIAS: 0 = Fixed Date, -1 = No Deadline
    deadline_mode = 0
    dm_radio = soup.find("input", attrs={"name": "deadline_mode", "checked": True})
    if dm_radio and dm_radio.get("value") is not None:
        try:
            deadline_mode = int(dm_radio["value"])
        except ValueError:
            deadline_mode = 0

    deadline = None
    dl_inp = soup.find("input", attrs={"name": "deadline"})
    if dl_inp and dl_inp.get("value"):
        deadline = dl_inp["value"].strip()

    # 7. Grace Period (deadline2)
    has_grace_period = False
    deadline2 = None
    dl2_inp = soup.find("input", attrs={"name": "deadline2"})
    if dl2_inp and dl2_inp.get("value"):
        deadline2 = dl2_inp["value"].strip()
        has_grace_period = bool(deadline2)

    # 8. Max files limit
    max_file_enabled = False
    max_file = None
    mf_tgl = soup.find("input", attrs={"name": "max_file_tgl"})
    if mf_tgl:
        max_file_enabled = mf_tgl.has_attr("checked")
    mf_inp = soup.find("input", attrs={"name": "max_file"})
    if mf_inp and mf_inp.get("value"):
        try:
            max_file = int(mf_inp["value"].strip())
        except ValueError:
            pass

    return TAAssignmentDetailResponse(
        ass_id=ass_id,
        exercise_ref_id=exercise_ref_id,
        title=title,
        type_id=type_id,
        type_name=type_name,
        mandatory=mandatory,
        instruction_html=instruction_html,
        start_time=start_time,
        deadline_mode=deadline_mode,
        deadline=deadline,
        has_grace_period=has_grace_period,
        deadline2=deadline2,
        max_file_enabled=max_file_enabled,
        max_file=max_file,
        instruction_files=[],
        form_action=form_action,
        rtoken=rtoken,
        hidden_inputs=hidden_inputs,
    )


@safe_parser(context_name="instruction_files")
def parse_instruction_files(
    html_content: str, base_url: str = settings.ilias_base_url
) -> List[TAInstructionFileItem]:
    """
    Parses the ILIAS instruction files page (ilResourceCollectionGUI) associated with an assignment.
    Extracts uploaded instruction files, their resource IDs (for deletion), file size, and download URLs.
    """
    soup = BeautifulSoup(html_content, "lxml")
    files: List[TAInstructionFileItem] = []

    # 1. Parse from main table rows
    for tr in soup.select("tr.c-table-data__row, tbody tr"):
        if tr.find_parent("dialog") or tr.find_parent(class_="c-modal--interruptive"):
            continue

        cb = tr.select_one(".c-table-data__row-selector, input[type='checkbox']")
        file_id = cb.get("value") if cb else None

        title_td = tr.select_one("td.c-table-data__cell--text, td")
        filename = ""
        if title_td:
            txt = _clean_text(title_td)
            if txt.startswith("Title:"):
                txt = txt[len("Title:") :].strip()
            filename = txt

        # Look for Size
        size_val = None
        size_td = tr.select("td.c-table-data__cell--text")
        if len(size_td) > 1:
            stxt = _clean_text(size_td[1])
            if stxt.startswith("Size:"):
                stxt = stxt[len("Size:") :].strip()
            size_val = stxt

        download_url = None
        for a_or_b in tr.find_all(["a", "button"]):
            act = a_or_b.get("data-action") or a_or_b.get("href") or ""
            if "cmd=download" in act:
                download_url = urllib.parse.urljoin(base_url, act)
                m_res = re.search(r"rcgui_resource_id(?:%5B%5D|\[\])=([^&]+)", act)
                if m_res and not file_id:
                    file_id = urllib.parse.unquote(m_res.group(1))
                break

        if file_id and filename:
            files.append(
                TAInstructionFileItem(
                    file_id=file_id,
                    filename=filename,
                    file_size=size_val,
                    download_url=download_url,
                )
            )

    # 2. Also check interruptive modal if present (e.g. created_exercise_instruction_files_page_with_file.html)
    if not files:
        for mtr in soup.select("tr.c-modal--interruptive__items__standard"):
            hid = mtr.find("input", attrs={"name": "interruptive_items[]"})
            if hid and hid.get("value"):
                fid = hid["value"]
                fname = _clean_text(mtr).replace(fid, "").strip()
                files.append(
                    TAInstructionFileItem(
                        file_id=fid,
                        filename=fname,
                    )
                )

    return files

