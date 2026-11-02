"""Discover the native participant table's filter and paging controls."""
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from backend.scrapers.dumper import safe_parser


NAV = 'exc_mem_table_nav'


def members_page_url(url: str, navigation: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k not in ('cmd', 'fallbackCmd', 'exc_mem_trows', NAV, NAV + '1', NAV + '2')]
    return urlunsplit(parts._replace(query=urlencode(query + [('cmd', 'members'), ('exc_mem_trows', '800'),
                                                             (NAV, navigation)]), fragment=''))


@dataclass
class SubmissionListingPage:
    found: bool = False
    action_url: Optional[str] = None
    security_fields: List[Tuple[str, str]] = field(default_factory=list)
    filters: List[Tuple[str, str]] = field(default_factory=list)
    reset: Optional[Tuple[str, str]] = None
    navigation: Optional[str] = None
    offset: int = 0
    total: Optional[int] = None
    pages: List[Tuple[int, str]] = field(default_factory=list)

    @property
    def filtered(self) -> bool:
        return any(value.strip() for _, value in self.filters)


@safe_parser(context_name='submission_listing')
def parse_submission_listing(html: str, page_url: str) -> SubmissionListingPage:
    soup = BeautifulSoup(html, 'lxml')
    table = soup.select_one("table[id*='exc_mem'], table[id*='tbl_il_exc'], table[id*='members'], table[id*='participant']")
    page = SubmissionListingPage(found=table is not None)
    if table is None:
        return page
    form = table.find_parent('form')
    scope = form if form is not None else soup
    page.action_url = urljoin(page_url, form.get('action') or page_url) if form else page_url

    for control in scope.select('input[name], select[name], textarea[name]'):
        name = control['name']
        if control.has_attr('disabled'):
            continue
        kind = control.get('type', '').lower()
        if name.startswith('flt_'):
            if kind in ('checkbox', 'radio') and not control.has_attr('checked'):
                continue
            if control.name == 'select':
                selected = control.select('option[selected]') or control.select('option')[:1]
                values = [opt.get('value', opt.get_text()) for opt in selected]
            else:
                values = [control.get_text() if control.name == 'textarea' else control.get('value', '')]
            page.filters.extend((name, value) for value in values)
        # Never replay participant IDs, marks, notices, template actions or column settings.
        elif kind == 'hidden' and re.fullmatch(r'(?:.*csrf.*|.*token.*|nonce)', name, re.I):
            page.security_fields.append((name, control.get('value', '')))

    button = scope.find(['input', 'button'], attrs={'name': 'cmd[membersReset]'})
    if button is not None:
        page.reset = (button['name'], button.get('value', button.get_text(strip=True)))

    current = scope.find('input', attrs={'name': NAV})
    navigation = current.get('value') if current else None
    if not navigation:
        current = scope.select_one(f'select[name="{NAV}1"] option[selected], select[name="{NAV}2"] option[selected]')
        navigation = current.get('value') if current else None
    candidates = []
    for selector in scope.select(f'select[name="{NAV}1"], select[name="{NAV}2"]'):
        candidates.extend(opt.get('value', '') for opt in selector.select('option'))
    for link in scope.select('.ilTableNav a[href]'):
        values = dict(parse_qsl(urlsplit(urljoin(page_url, link['href'])).query))
        if NAV in values:
            candidates.append(values[NAV])
    if navigation and re.fullmatch(r'[^:]*:(?:asc|desc):\d+', navigation, re.I):
        page.navigation = navigation
        page.offset = int(navigation.rsplit(':', 1)[1])
    for summary in scope.select('.ilTableFootLight'):
        match = re.search(r'(\d+)\s*[-–]\s*(\d+)\D+(\d+)', summary.get_text(' ', strip=True))
        if match:
            start, _, page.total = map(int, match.groups())
            page.offset = max(0, start - 1)
            break
    valid = [value for value in candidates if re.fullmatch(r'[^:]*:(?:asc|desc):\d+', value, re.I)]
    if not page.navigation and valid:
        page.navigation = valid[0].rsplit(':', 1)[0] + f':{page.offset}'
    order = page.navigation.rsplit(':', 1)[0] if page.navigation else None
    values = {value for value in valid if value.rsplit(':', 1)[0] == order}
    if order is not None:
        values.add(order + ':0')
    page.pages = sorted((int(value.rsplit(':', 1)[1]), members_page_url(page.action_url, value)) for value in values)
    return page
