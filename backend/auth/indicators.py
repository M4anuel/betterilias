"""Positive account controls shared by session verification and resource reads."""
from urllib.parse import parse_qsl

from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.scrapers.dumper import safe_parser


@safe_parser(context_name='authenticated_account_control')
def authenticated_control(html):
    soup = BeautifulSoup(html, 'lxml')
    avatar = soup.select_one('.il-maincontrols-metabar a.il-user-avatar, #il_mbt_usr, span.il-avatar-initials, a.il-user-avatar')
    if avatar is not None:
        return {'name': avatar.get_text(strip=True) or avatar.get('title')}
    origin = httpx.URL(settings.ilias_base_url)
    for anchor in soup.select('.il-maincontrols-metabar a[href], .il-metabar-slates a[href]'):
        try:
            url = origin.join(anchor['href'])
            pairs = parse_qsl(url.query.decode('ascii'), keep_blank_values=True)
        except (httpx.InvalidURL, UnicodeError, ValueError):
            continue
        values = {key.lower(): value.lower() for key, value in pairs}
        # This is the account menu's server-selected own-profile command, not
        # a public profile, content link, guest navigation or generic avatar.
        if ((url.scheme, url.host, url.port) == (origin.scheme, origin.host, origin.port)
                and not url.username and not url.password and not url.fragment
                and url.path == '/ilias.php' and len(values) == len(pairs)
                and set(values) <= {'baseclass', 'cmd', 'cmdclass', 'cmdnode', 'client_id'}
                and values.get('baseclass') == 'ildashboardgui'
                and values.get('cmd') == 'jumptoprofile'
                and values.get('cmdclass', '') in ('', 'ildashboardgui', 'ilpersonalprofilegui')):
            return {'name': None}
    return None
