"""Native repository authoring forms; no saved cmdNodes or CSRF tokens."""
from dataclasses import dataclass, field
import re
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup

from backend.config import settings
from backend.i18n import t
from backend.schemas import AuthoringContext
from backend.scrapers.dumper import safe_parser


def native_url(url: str, ref_id: str) -> str:
    absolute = urljoin(settings.ilias_base_url + '/', url)
    parsed = urlparse(absolute)
    base = urlparse(settings.ilias_base_url)
    if (parsed.scheme, parsed.netloc) != (base.scheme, base.netloc):
        raise ValueError(t('authoring.form_changed'))
    if parse_qs(parsed.query).get('ref_id') != [ref_id]:
        raise ValueError(t('authoring.form_changed'))
    return absolute


@safe_parser('authoring_context')
def parse_authoring_context(html_content: str, ref_id: str) -> AuthoringContext:
    soup = BeautifulSoup(html_content, 'lxml')
    creation = {}
    manage_url = sorting_url = page_editor_url = content_url = None
    can_manage = can_edit_page = False
    for node in soup.select('a[href], button[data-action], .c-toolbar button[onclick]'):
        if node.has_attr('disabled') or node.get('aria-disabled') == 'true':
            continue
        url = node.get('href') or node.get('data-action', '')
        if not url and node.get('onclick'):
            target = re.fullmatch(r"location\.href\s*=\s*'([^']+)'\s*;?", node['onclick'].strip())
            url = target[1] if target else ''
        query = parse_qs(urlparse(url).query)
        if query.get('ref_id') != [ref_id]:
            continue
        command = query.get('cmd', [''])[0].lower()
        if node.find_parent(id='subtab_view_content'):
            content_url = native_url(url, ref_id)
        if command == 'create' and query.get('new_type'):
            creation[query['new_type'][0]] = native_url(url, ref_id)
        can_manage |= command in ('manage', 'listobjects', 'editorder', 'enableadministrationpanel')
        can_edit_page |= command == 'editpageframe' or 'pageeditor' in query.get('cmdClass', [''])[0].lower()
        if command in ('manage', 'enableadministrationpanel'):
            manage_url = native_url(url, ref_id)
        if command == 'editorder':
            sorting_url = native_url(url, ref_id)
        if command == 'editpageframe':
            page_editor_url = native_url(url, ref_id)
    return AuthoringContext(ref_id=ref_id, can_create=bool(creation),
                            can_manage=can_manage, can_edit_page=can_edit_page,
                            creatable_types=list(creation), creation_urls=creation,
                            manage_url=manage_url, sorting_url=sorting_url, page_editor_url=page_editor_url, content_url=content_url)


@dataclass
class CreationForm:
    action: str
    values: dict[str, str] = field(default_factory=dict)
    licenses: list[dict] = field(default_factory=list)
    upload_url: str | None = None
    title_field: str = ''
    description_field: str = ''
    template_field: str = ''
    templates: list[dict] = field(default_factory=list)
    file_fields: list[str] = field(default_factory=list)


@safe_parser('authoring_file_names')
def parse_file_names(html_content: str) -> dict[str, str]:
    """The native action menu retains full filenames when titles omit extensions."""
    soup = BeautifulSoup(html_content, 'lxml')
    names = {}
    for item in soup.select('.ilContainerListItemOuter, .ilContainerListItem, .il_ContainerListItem'):
        title = item.select_one('h3 a[href], .il_ContainerItemTitle a[href]')
        action = item.select_one('button.dropdown-toggle[aria-label]')
        if not title or not action:
            continue
        label = re.match(r'^(?:Actions for|Aktionen für)\s+(.+)$', action['aria-label'])
        if not label:
            continue
        url = urlparse(title['href'])
        ref_id = parse_qs(url.query).get('ref_id', [None])[0]
        if not ref_id:
            permalink = re.search(r'/go/file/(\d+)', url.path)
            ref_id = permalink[1] if permalink else None
        if ref_id:
            names[ref_id] = label[1]
    return names


@safe_parser('authoring_creation_form')
def parse_creation_form(html_content: str, ref_id: str, object_type: str) -> CreationForm:
    soup = BeautifulSoup(html_content, 'lxml')
    form = next((f for f in soup.select('form[action]')
                 if parse_qs(urlparse(f['action']).query).get('new_type') == [object_type]), None)
    if form is None:
        raise ValueError(t('authoring.form_changed'))
    result = CreationForm(action=native_url(form['action'], ref_id))
    for node in form.select('input[name], textarea[name], select[name]'):
        if node.has_attr('disabled') or node.find_parent('template'):
            continue
        name = node['name']
        kind = node.get('type', '')
        if kind in ('submit', 'button', 'file'):
            continue
        if kind in ('radio', 'checkbox') and not node.has_attr('checked'):
            continue
        result.values[name] = node.get('value', '') if node.name == 'input' else node.get_text()
    submit = next((n for n in form.select('button[name], input[type=submit][name]')
                   if 'cancel' not in n.get('name', '').lower()), None)
    if submit:
        result.values[submit['name']] = submit.get('value', '')
    if object_type == 'fold':
        title = form.select_one('input[type=text][name]')
        description = form.select_one('textarea[name]')
        if not title or not description:
            raise ValueError(t('authoring.form_changed'))
        result.title_field, result.description_field = title['name'], description['name']
        radios = form.select('input[type=radio][name]')
        result.templates = [{'value': r['value'], 'label': form.find('label', attrs={'for': r.get('id')}).get_text(' ', strip=True),
                             'selected': r.has_attr('checked')} for r in radios]
        result.template_field = radios[0]['name'] if radios else ''
    else:
        result.file_fields = list(dict.fromkeys(node['name'] for node in form.select('input[name], textarea[name]')
                                                if re.fullmatch(r'form/input_\d+\[input_\d+\]\[\]', node['name'])))
        if len(result.file_fields) != 3:
            raise ValueError(t('authoring.form_changed'))
        for node in form.select('input[type=radio][name]'):
            label = form.find('label', attrs={'for': node.get('id')})
            result.licenses.append({'value': node['value'], 'label': label.get_text(' ', strip=True) if label else node['value'],
                                    'selected': node.has_attr('checked'), 'field': node['name']})
        match = re.search(r"il\.UI\.Input\.File\.init\(\s*'[^']*',\s*'([^']+)'", html_content)
        if not match or not result.licenses:
            raise ValueError(t('authoring.form_changed'))
        result.upload_url = native_url(match[1], ref_id)
    return result
