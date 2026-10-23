"""Discover voluntary course membership actions and their real ILIAS forms."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import CourseMembership, MembershipField
from backend.scrapers.dashboard import _extract_ref_id_from_url


def membership_link(soup, course_id: str, action: str) -> Optional[str]:
    command = 'join' if action == 'join' else 'unsubscribe'
    for link in soup.select('a[href], button[data-action]'):
        if link.has_attr('disabled') or link.get('aria-disabled') == 'true':
            continue
        href = link.get('href') or link.get('data-action') or ''
        params = parse_qs(urlparse(href).query)
        if _extract_ref_id_from_url(href) == course_id and params.get('cmd', [''])[0].lower() == command:
            return urljoin(settings.ilias_base_url, href)
    return None


def membership_form(soup, course_id: str, action: str):
    command = 'cmd[join]' if action == 'join' else 'cmd[performUnsubscribe]'
    for form in soup.select('form[action]'):
        if _extract_ref_id_from_url(form['action']) != course_id:
            continue
        submit = form.find(['input', 'button'], attrs={'name': command})
        if submit and not submit.has_attr('disabled'):
            return form, submit
    return None, None


def parse_membership(soup, course_id: str) -> CourseMembership:
    join = bool(membership_link(soup, course_id, 'join') or membership_form(soup, course_id, 'join')[0])
    leave = bool(membership_link(soup, course_id, 'leave') or membership_form(soup, course_id, 'leave')[0])
    return CourseMembership(is_enrolled=True if leave else False if join else None, can_join=join, can_leave=leave)


@dataclass
class PreparedMembership:
    url: str
    payload: Dict[str, str] = field(default_factory=dict)
    fields: List[MembershipField] = field(default_factory=list)
    message: str = ''
    supported: bool = True


def prepare_membership_form(html: str, course_id: str, action: str) -> Optional[PreparedMembership]:
    soup = BeautifulSoup(html, 'lxml')
    form, submit = membership_form(soup, course_id, action)
    if form is None:
        return None
    prepared = PreparedMembership(url=urljoin(settings.ilias_base_url, form['action']))
    # Keep the command and CSRF fields supplied by the live form, never client URLs/tokens.
    for control in form.select('input[name], textarea[name], select[name]'):
        if control.has_attr('disabled'):
            continue
        name = control['name']
        kind = control.get('type', 'text').lower()
        if kind in ('submit', 'button', 'reset'):
            continue
        if kind == 'hidden':
            prepared.payload[name] = control.get('value', '')
            continue
        if control.name != 'input' or kind not in ('text', 'password', 'checkbox'):
            prepared.supported = False
            continue
        label = form.find('label', attrs={'for': control.get('id')}) if control.get('id') else None
        group = control.find_parent(class_='form-group')
        if label is None and group:
            label = group.find('label')
        prepared.fields.append(MembershipField(
            name=name, label=label.get_text(' ', strip=True) if label else name,
            field_type=kind, required=control.has_attr('required') or control.get('aria-required') == 'true',
            value=control.get('value', '1') if kind == 'checkbox' else '',
        ))
    prepared.payload[submit['name']] = submit.get('value') or submit.get_text(' ', strip=True)
    details = form.select('.form-group, .ilFormHeader, .alert, .il_Description')
    messages = [el.get_text(' ', strip=True) for el in details]
    for alert in soup.select('.alert-info, .alert-warning, .il-info, .il_InfoScreenProperty'):
        messages.append(alert.get_text(' ', strip=True).replace('-confirmation_message-', '').strip())
    prepared.message = '\n'.join(dict.fromkeys(m for m in messages if m))
    return prepared
