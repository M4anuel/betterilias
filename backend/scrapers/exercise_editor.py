import logging
from backend.i18n import t
import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import (
    TAAssignmentDetailResponse,
    SaveTAAssignmentRequest,
    TAAssignmentListItem,
    TAAssignmentListResponse,
    TAInstructionFileItem,
)
from backend.scrapers.dumper import safe_parser

logger = logging.getLogger(__name__)


@safe_parser(context_name='ta_assignment_delete_form')
def parse_ta_assignment_delete_form(html: str, ref_id: str, ass_id: str) -> tuple[str, Dict[str, str]]:
    """Read the native confirmation, refusing missing or additional targets."""
    soup = BeautifulSoup(html, 'lxml')
    for form in soup.find_all('form', action=True):
        button = form.find(attrs={'name': 'cmd[deleteAssignments]'})
        if button is None:
            continue
        query = urllib.parse.parse_qs(urllib.parse.urlparse(form['action']).query)
        if query.get('ref_id') != [ref_id]:
            continue
        ids = {control.get('value') for control in form.select('[name="id[]"]') if not control.has_attr('disabled')}
        if ids != {ass_id}:
            continue
        payload = {control['name']: control.get('value', '') for control in form.select('input[type="hidden"][name]')
                   if not control.has_attr('disabled')}
        payload.update({'id[]': ass_id, 'cmd[deleteAssignments]': button.get('value') or button.get_text(strip=True)})
        return urllib.parse.urljoin(settings.ilias_base_url, form['action']), payload
    raise ValueError(t('delete.form_missing'))


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
    forms = []
    for candidate in soup.find_all('form'):
        query = {key.lower(): value for key, value in urllib.parse.parse_qs(
            urllib.parse.urlparse(candidate.get('action', '')).query).items()}
        if query.get('cmdclass', [''])[0].lower() != 'ilexassignmenteditorgui':
            continue
        if query.get('ref_id') and query['ref_id'] != [exercise_ref_id]:
            continue
        forms.append(candidate)
    form = next((form for form in forms if form.find(attrs={'name': 'cmd[saveAssignmentOrder]'})), None)
    if form is None:
        form = next((form for form in forms if form.select_one('input[name="id[]"], input[name^="order["]')), None)
    add_form = None
    for candidate in forms:
        query = {key.lower(): value for key, value in urllib.parse.parse_qs(
            urllib.parse.urlparse(candidate.get('action', '')).query).items()}
        command = query.get('fallbackcmd', query.get('cmd', ['']))[0].lower()
        if candidate.find(attrs={'name': 'cmd[addAssignment]'}) or command == 'addassignment':
            add_form = candidate
            break
    available_types = {}
    if add_form:
        for option in add_form.select('select[name="type"] option[value]'):
            if option['value'].isdigit() and not option.has_attr('disabled'):
                available_types[int(option['value'])] = _clean_text(option)
    form_action_url = None
    rtoken = None

    if form and form.get("action"):
        raw_act = form["action"]
        form_action_url = urllib.parse.urljoin(settings.ilias_base_url, raw_act)
        m_tok = re.search(r"rtoken=([a-f0-9]+)", raw_act)
        if m_tok:
            rtoken = m_tok.group(1)

    # 2. Locate the assignments table
    scope = form if form is not None else soup
    row_control = scope.select_one('input[name="id[]"]')
    # The native form has a layout/filter table before the assignment table.
    # Follow a row's selector to its nearest table instead of choosing table #1.
    table = row_control.find_parent('table') if row_control else None
    if table is None:
        table = scope.select_one('table[id^="excass"]')
    if table is None and form is not None:
        table = form.select_one('table.table-striped')
    if table is None and add_form is None:
        raise ValueError(t('editor.list_missing'))

    if table:
        for tr in table.find_all("tr"):
            if tr.find_parent('table') is not table:
                continue
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

            title = t("Assignment {p0}", p0=ass_id)
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
                        type_id = 6 if 'wiki' in low else 4
                    elif "blog" in low:
                        type_id = 2
                    elif "portfolio" in low:
                        type_id = 3
                    elif low in ('text', 'texteingabe'):
                        type_id = 5
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
        add_action_url=urllib.parse.urljoin(settings.ilias_base_url, add_form['action']) if add_form and add_form.get('action') else None,
        add_submit_command='cmd[addAssignment]' if add_form and add_form.find(attrs={'name': 'cmd[addAssignment]'}) else None,
        available_types=available_types,
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
    form = next((form for form in soup.find_all('form')
                 if 'ilExAssignmentEditorGUI' in form.get('action', '')
                 and form.find('input', attrs={'name': 'title'})
                 and form.find(attrs={'name': re.compile(r'^cmd\[(save|update)Assignment\]$')})), None)
    if form is None:
        raise ValueError(t('editor.form_missing'))
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

    # 1. Title
    title = ""
    title_inp = form.find("input", attrs={"name": "title"})
    if title_inp and title_inp.get("value"):
        title = title_inp["value"].strip()

    # 2. Type
    type_id = 1
    type_name = "File"
    type_select = form.find("select", attrs={"name": "type"})
    if type_select:
        sel_opt = type_select.find("option", selected=True)
        if sel_opt and sel_opt.get("value"):
            try:
                type_id = int(sel_opt["value"])
                type_name = _clean_text(sel_opt)
            except ValueError:
                pass
    else:
        type_hidden = form.find("input", attrs={"name": "type", "type": "hidden"})
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
    mand_inp = form.find("input", attrs={"name": "mandatory"})
    if mand_inp:
        mandatory = mand_inp.has_attr("checked")

    # 4. Work Instructions (HTML content inside textarea)
    instruction_html = ""
    inst_ta = form.find("textarea", attrs={"name": "instruction"})
    if inst_ta:
        instruction_html = inst_ta.get_text()

    # 5. Start Time
    start_time = None
    st_inp = form.find("input", attrs={"name": "start_time"})
    if st_inp and st_inp.get("value"):
        start_time = st_inp["value"].strip()

    # 6. Deadline mode & Deadline
    # In ILIAS: 0 = Fixed Date, -1 = No Deadline
    deadline_mode = 0
    dm_radio = form.find("input", attrs={"name": "deadline_mode", "checked": True})
    if dm_radio and dm_radio.get("value") is not None:
        try:
            deadline_mode = int(dm_radio["value"])
        except ValueError:
            deadline_mode = 0

    deadline = None
    dl_inp = form.find("input", attrs={"name": "deadline"})
    if dl_inp and dl_inp.get("value"):
        deadline = dl_inp["value"].strip()

    # 7. Grace Period (deadline2)
    has_grace_period = False
    deadline2 = None
    dl2_inp = form.find("input", attrs={"name": "deadline2"})
    if dl2_inp and dl2_inp.get("value"):
        deadline2 = dl2_inp["value"].strip()
        has_grace_period = bool(deadline2)

    # 8. Max files limit
    max_file_enabled = False
    max_file = None
    mf_tgl = form.find("input", attrs={"name": "max_file_tgl"})
    if mf_tgl:
        max_file_enabled = mf_tgl.has_attr("checked")
    mf_inp = form.find("input", attrs={"name": "max_file"})
    if mf_inp and mf_inp.get("value"):
        try:
            max_file = int(mf_inp["value"].strip())
        except ValueError:
            pass

    values, dependencies, disabled_fields, file_inputs = {}, {}, [], []
    controllers = {}
    for control in form.select('input[name]'):
        kind, name = control.get('type', '').lower(), control['name']
        if kind == 'radio':
            controllers[f"subform_{name}_{control.get('value', '')}"] = (name, control.get('value', ''))
        elif kind == 'checkbox':
            controllers[f'subform_{name}'] = (name, control.get('value', 'on'))
    for control in form.select('input[name], select[name], textarea[name]'):
        name, kind = control['name'], control.get('type', '').lower()
        if kind in ('submit', 'button', 'reset'):
            continue
        for ancestor in control.parents:
            if ancestor is form:
                break
            if ancestor.get('id') in controllers:
                parent_name, value = controllers[ancestor['id']]
                dependencies.setdefault(name, {})[parent_name] = value
        if control.has_attr('disabled') and kind != 'hidden':
            disabled_fields.append(name)
            continue
        if kind == 'file':
            file_inputs.append(name)
        elif kind in ('radio', 'checkbox'):
            if control.has_attr('checked'):
                values[name] = control.get('value', 'on')
        elif control.name == 'select':
            option = control.find('option', selected=True) or control.find('option')
            if option:
                values[name] = option.get('value', option.get_text())
        elif control.name == 'textarea':
            values[name] = control.get_text()
        else:
            values[name] = control.get('value', '')
    command = form.find(attrs={'name': re.compile(r'^cmd\[(save|update)Assignment\]$')})['name']

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
        form_values=values,
        form_fields=list(dict.fromkeys(control['name'] for control in form.select('input[name], select[name], textarea[name]'))),
        form_dependencies=dependencies,
        disabled_fields=disabled_fields,
        file_inputs=file_inputs,
        submit_command=command,
    )


@safe_parser(context_name='ta_assignment_validation')
def parse_ta_assignment_error(html_content: str) -> Optional[str]:
    """Return actual validation alerts, excluding help text and dialog templates."""
    soup = BeautifulSoup(html_content, 'lxml')
    messages = []
    selectors = '.alert-danger, .ilFailureMessage, .il-form-input-error, .has-error .help-block, .help-block.alert-warning'
    for element in soup.select(selectors):
        if element.find_parent(['dialog', 'template']) or element.find_parent(class_=re.compile(r'\bmodal')):
            continue
        if element.get('id', '').startswith(('desc_', 'date_desc_')):
            continue
        if element.name == 'textarea' or element.find_parent('textarea'):
            continue
        for hidden in element.select('.ilAccHeadingHidden, .sr-only'):
            hidden.decompose()
        message = _clean_text(element)
        container = element.find_parent(class_=re.compile(r'\bhas-error\b')) or element.find_parent(id=re.compile(r'^il_prop_cont_'))
        if container:
            label = container.select_one('label.control-label') or container.find('label')
            if label and message:
                field_name = _clean_text(label).strip(' *')
                if field_name:
                    message = f'{field_name}: {message}'
        if message and message not in messages:
            messages.append(message)
    return '\n'.join(messages) or None


def validate_ta_assignment_request(data: SaveTAAssignmentRequest) -> None:
    from datetime import datetime
    if not data.title.strip():
        raise ValueError(t('Bitte geben Sie einen Titel für die Übung an.'))
    if len(data.title.strip()) > 200:
        raise ValueError(t('editor.title_too_long'))
    if data.deadline_mode not in (-1, 0):
        raise ValueError(t('editor.deadline_mode'))
    if data.deadline_mode == 0 and not (data.deadline and data.deadline.strip()):
        raise ValueError(t('Bitte wählen Sie ein Abgabedatum aus oder stellen Sie den Modus auf "Kein Abgabetermin".'))
    if data.has_grace_period and data.deadline_mode == 0 and not (data.deadline2 and data.deadline2.strip()):
        raise ValueError(t('editor.grace_required'))
    dates = {}
    for name, value in [('start_time', data.start_time), ('deadline', data.deadline if data.deadline_mode == 0 else None),
                        ('deadline2', data.deadline2 if data.deadline_mode == 0 and data.has_grace_period else None)]:
        if value:
            try:
                dates[name] = datetime.fromisoformat(value)
                if dates[name].tzinfo is not None:
                    raise ValueError('Expected local time')
            except ValueError as exc:
                raise ValueError(t('editor.invalid_date', field=name)) from exc
    if dates.get('start_time') and dates.get('deadline') and dates['start_time'] > dates['deadline']:
        raise ValueError(t('Die Startzeit darf nicht nach dem Abgabetermin liegen.'))
    if dates.get('deadline2') and dates['deadline2'] < dates['deadline']:
        raise ValueError(t('Die Nachfrist darf nicht vor dem regulären Abgabetermin liegen.'))
    if data.max_file_enabled and (data.max_file is None or data.max_file < 1):
        raise ValueError(t('editor.max_files_positive'))


def normalize_instruction_html(html: str) -> str:
    """Use ILIAS mini-RTE tags; browser execCommand emits unsupported b/i/div."""
    soup = BeautifulSoup(html, 'html.parser')
    for element in soup.find_all(['b', 'i', 'div']):
        element.name = {'b': 'strong', 'i': 'em', 'div': 'p'}[element.name]
    return str(soup)


def build_ta_assignment_payload(form: TAAssignmentDetailResponse, data: SaveTAAssignmentRequest) -> Dict[str, str]:
    """Start from native defaults, then apply supported edits and active branches."""
    validate_ta_assignment_request(data)
    if form.type_id != data.type_id:
        raise ValueError(t('editor.type_immutable' if data.ass_id else 'editor.type_unavailable'))
    if not form.form_action or not form.submit_command:
        raise ValueError(t('editor.form_missing'))
    values = dict(form.form_values)
    protected = set(form.disabled_fields) - set(form.form_values)
    fields = set(form.form_fields)
    changes = {
        'title': data.title.strip(), 'type': str(data.type_id), 'instruction': normalize_instruction_html(data.instruction_html),
        'mandatory': '1' if data.mandatory else None,
        'start_time': (data.start_time or '').strip(), 'deadline_mode': str(data.deadline_mode),
        'deadline': (data.deadline or '').strip() if data.deadline_mode == 0 else None,
        'deadline2': (data.deadline2 or '').strip() if data.deadline_mode == 0 and data.has_grace_period else '',
        'max_file_tgl': '1' if data.max_file_enabled else None,
        'max_file': str(data.max_file) if data.max_file_enabled else None,
    }
    for name, value in changes.items():
        if name not in fields or name in protected:
            continue
        if value is None:
            values.pop(name, None)
        else:
            values[name] = value
    # Nested radios are preserved when their parent is selected, instead of
    # indiscriminately dropping every radio (including team-formation settings).
    while True:
        inactive = [name for name in values if any(values.get(parent) != expected
                    for parent, expected in form.form_dependencies.get(name, {}).items())]
        if not inactive:
            break
        for name in inactive:
            values.pop(name, None)
    values[form.submit_command] = 'Save'
    return values


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

        title_td = tr.select_one("td.c-table-data__cell--text") or tr.find('td')
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

