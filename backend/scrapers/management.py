"""Parse authoritative container controls separately from the rendered page layout."""
from dataclasses import dataclass, field
import re
import math
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from backend.i18n import t
from backend.schemas import ManagedMaterial, MaterialItem
from backend.scrapers.authoring import native_url, parse_file_names
from backend.scrapers.dumper import safe_parser
from backend.scrapers.materials import _parse_single_item, _detect_material_type
from backend.scrapers.dashboard import _extract_ref_id_from_url


@dataclass
class ManagementForm:
    action: str
    values: list[tuple[str, str]] = field(default_factory=list)
    items: list[ManagedMaterial] = field(default_factory=list)
    positions: dict[str, tuple[str, str]] = field(default_factory=dict)


CONTAINER_CLASSES = {'ilobjfoldergui', 'ilobjcoursegui', 'ilobjgroupgui', 'ilobjcategorygui', 'ilobjrootfoldergui', 'ilobjecttablegui'}


def container_action(url: str, ref_id: str, confirmation=False) -> str:
    action = native_url(url, ref_id)
    query = parse_qs(urlparse(action).query)
    gui = query.get('cmdClass', [''])[0].lower()
    command = query.get('cmd', [''])[0].lower()
    if gui and gui not in CONTAINER_CLASSES:
        raise ValueError(t('management.form_changed'))
    if not confirmation and (command not in ('', 'post') or query.get('fallbackCmd') or query.get('item_ref_id')):
        raise ValueError(t('management.form_changed'))
    return action


def hidden_values(form) -> list[tuple[str, str]]:
    return [(n['name'], n.get('value', '')) for n in form.select('input[type=hidden][name]')
            if not n.has_attr('disabled') and not n.find_parent('template')]


@safe_parser('container_management')
def parse_management(html_content: str, ref_id: str) -> ManagementForm | None:
    soup = BeautifulSoup(html_content, 'lxml')
    file_names = parse_file_names(html_content)
    for form in soup.select('form[action]'):
        if not form.select_one('input[name="cmd[delete]"], button[name="cmd[delete]"]'):
            continue
        hidden = hidden_values(form)
        if any(name.startswith('cmd[') for name, _ in hidden):
            raise ValueError(t('management.form_changed'))
        result = ManagementForm(container_action(form['action'], ref_id),
                                [(name, value) for name, value in hidden if name not in ('id', 'id[]', 'ref_id', 'item_ref_id')])
        # Never treat one page of a paginated management list as the whole folder.
        for node in form.select('a[href], button[data-action]'):
            query = parse_qs(urlparse(node.get('href') or node.get('data-action', '')).query)
            if query.get('ref_id') == [ref_id] and any(
                (re.match(r'tbl_.+_nav$', key) or key in ('offset', 'page'))
                for key in query
            ):
                raise ValueError(t('management.inspection_incomplete'))
        seen = set()
        for checkbox in form.select('input[name="id[]"][type=checkbox]'):
            ref = checkbox.get('value', '')
            if not ref.isdigit() or ref == ref_id:
                raise ValueError(t('management.form_changed'))
            row = checkbox.find_parent(class_='ilContainerListItemOuter') or checkbox.find_parent('tr')
            parsed = _parse_single_item(row, set()) if row else None
            if parsed is None and row:
                title = row.select_one('h3 a[href], .il_ContainerItemTitle a[href]')
                icon = row.select_one('img[src]')
                if title and _extract_ref_id_from_url(title['href']) == ref:
                    parsed = MaterialItem(ref_id=ref, title=title.get_text(' ', strip=True), url=title['href'],
                                          item_type=_detect_material_type(title['href'], '', icon.get('src') if icon else None))
            if parsed is None or parsed.ref_id != ref or ref in seen:
                raise ValueError(t('management.form_changed'))
            icon = row.select_one('img[src]')
            container = re.search(r'icon_(fold|grp|crs|cat|sess|lso|itgr)(?:\.|_)', icon.get('src', '') if icon else '')
            if container:
                parsed.item_type = container[1]
            if parsed.item_type == 'file' and ref in file_names:
                parsed.title = file_names[ref]
            seen.add(ref)
            result.items.append(ManagedMaterial(**parsed.model_dump(), can_delete=not checkbox.has_attr('disabled') and parsed.item_type in ('file', 'fold')))
        return result
    return None


@safe_parser('container_sorting')
def parse_sorting(html_content: str, ref_id: str) -> ManagementForm | None:
    soup = BeautifulSoup(html_content, 'lxml')
    for form in soup.select('form[action]'):
        if not form.select_one('[name="cmd[saveSorting]"]'):
            continue
        result = ManagementForm(container_action(form['action'], ref_id), hidden_values(form))
        for control in form.select('input[name^="position["]'):
            name = control['name']
            match = re.fullmatch(r'position\[(\d+)\]', name)
            if not match or control.has_attr('disabled'):
                # Preserve sub-session/group positions without flattening their structure.
                if not control.has_attr('disabled'):
                    result.values.append((name, control.get('value', '')))
                continue
            value = control.get('value', '').replace(',', '.')
            if not math.isfinite(float(value)) or match[1] in result.positions:
                raise ValueError(t('management.form_changed'))
            result.positions[match[1]] = (name, value)
        return result
    return None


@safe_parser('repository_delete_confirmation')
def parse_delete_confirmation(html_content: str, ref_id: str, selected: set[str]) -> ManagementForm:
    soup = BeautifulSoup(html_content, 'lxml')
    for form in soup.select('form[action]'):
        query = parse_qs(urlparse(form['action']).query)
        commands = [node['name'].lower() for node in form.select('[name^="cmd["]')]
        native_command = query.get('cmd', [''])[0].lower()
        if native_command == 'post':
            native_command = query.get('fallbackCmd', [''])[0].lower()
        if native_command != 'confirmeddelete' and 'cmd[confirmeddelete]' not in commands:
            continue
        result = ManagementForm(container_action(form['action'], ref_id, confirmation=True), hidden_values(form))
        query_ids = set(query.get('id', [''])[0].split(',')) - {''}
        hidden_ids = {value for _, value in result.values if value in selected}
        if query_ids and query_ids != selected:
            raise ValueError(t('management.confirmation_changed'))
        legacy_ids = {n.get('value', '') for n in form.select('input[name="id[]"]')}
        if legacy_ids and legacy_ids != selected:
            raise ValueError(t('management.confirmation_changed'))
        if not query_ids and legacy_ids != selected:
            raise ValueError(t('management.confirmation_changed'))
        # Modern ILIAS forms contain one required hidden field per selected reference.
        if query_ids and hidden_ids != selected:
            raise ValueError(t('management.confirmation_changed'))
        if any(name.startswith('form/input_') and value.isdigit() and value not in selected for name, value in result.values):
            raise ValueError(t('management.confirmation_changed'))
        for node in form.select('input[type=checkbox][name], select[name]'):
            # Additional-reference choices deliberately remain unselected.
            if node.has_attr('required'):
                raise ValueError(t('management.confirmation_changed'))
        submit = form.select_one('[name="cmd[confirmedDelete]"]')
        if submit:
            result.values.append((submit['name'], submit.get('value', '')))
        return result
    raise ValueError(t('management.confirmation_changed'))
