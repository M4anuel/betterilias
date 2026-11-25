"""Explicit UniBE ID-token exchange into a fresh, positively verified ILIAS jar."""
from urllib.parse import parse_qsl

from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.outbound_http import BudgetTransport
from backend.outbound_network import EgressTransport
from backend.outbound_targets import TargetPolicy
from backend.scrapers.dumper import safe_parser

ORIGIN = 'https://ilias.unibe.ch'
DESKTOP = ORIGIN + '/ilias.php?baseClass=ilPersonalDesktopGUI'
ENTRY = str(httpx.URL(ORIGIN + '/mobile-auth', params={'redirect': DESKTOP}))
ALIAS = str(httpx.URL(ORIGIN + '/Customizing/global/plugins/Origins2/mobileauth.php', params={'redirect': DESKTOP}))
MAX_BYTES = 4_000_000


class ExchangeFailed(Exception):
    """Fixed message only: upstream bodies, URLs, cookies and tokens are private."""


@safe_parser(context_name='unisport_ilias_identity')
def desktop_identity(html):
    soup = BeautifulSoup(html, 'lxml')
    # Positive user controls precede archived-course access notices/help links.
    avatar = soup.select_one('.il-maincontrols-metabar a.il-user-avatar, #il_mbt_usr, span.il-avatar-initials, a.il-user-avatar')
    if avatar is None:
        return None
    return (avatar.get('title') or avatar.get_text(' ', strip=True) or 'ILIAS')[:300]


def desktop_target(url):
    if url.scheme != 'https' or url.host != 'ilias.unibe.ch' or url.port not in (None, 443) or url.username or url.password or url.fragment:
        return False
    pairs = parse_qsl(url.query.decode('ascii'), keep_blank_values=True)
    values = {key.lower(): value.lower() for key, value in pairs}
    return (url.path in ('/', '/index.php', '/ilias.php') and len(values) == len(pairs)
        and set(values) <= {'baseclass', 'cmdclass', 'cmd', 'cmdnode', 'client_id'}
        and values.get('baseclass', '') in ('', 'ilpersonaldesktopgui', 'ildashboardgui', 'ilmembershipoverviewgui')
        and values.get('cmdclass', '') in ('', 'ilpersonaldesktopgui', 'ildashboardgui', 'ilmembershipoverviewgui')
        and values.get('cmd', '') in ('', 'jumptoselecteditems'))


async def exchange(account, owner, validate, *, transport=None, budget=None):
    # Never send the campus token to a self-hosted/custom ILIAS instance.
    configured = httpx.URL(settings.ilias_base_url)
    if str(configured).rstrip('/') != ORIGIN:
        raise ExchangeFailed()
    policy = TargetPolicy(native_url=ORIGIN, media_origins=[], allow_local=False)
    wire = BudgetTransport('unisport-ilias:' + owner,
        inner=EgressTransport(policy=policy, inner=transport), budget=budget, retries=0, max_bytes=0)
    async with httpx.AsyncClient(transport=wire, follow_redirects=False, trust_env=False,
            timeout=httpx.Timeout(20, connect=10), headers={'User-Agent': settings.user_agent}) as client:
        client.cookies.set('ilClientId', settings.ilias_client_id, domain='ilias.unibe.ch', path='/')
        async def read(url, headers=None):
            validate()
            async with client.stream('GET', url, headers=headers) as response:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise ExchangeFailed()
                return response.status_code, response.headers, bytes(body)

        credentials = {'Authorization': account.id_token.get_secret_value(), 'X-UNICAMPUS-AFFILIATION': account.affiliation}
        status, headers, _ = await read(ENTRY, credentials)
        if status in (301, 302, 303, 307, 308):
            target = httpx.URL(ENTRY).join(headers.get('location', ''))
            # Only the observed exact alias may receive the token a second time.
            if str(target) == ALIAS:
                status, headers, _ = await read(ALIAS, credentials)
        if status in (301, 302, 303, 307, 308):
            if not headers.get('location') or not desktop_target(httpx.URL(ALIAS).join(headers['location'])):
                raise ExchangeFailed()
        elif status != 200:
            raise ExchangeFailed()
        # Never forward either token header on post-login navigation. The cookie
        # alone must authenticate the independent personal-dashboard request.
        url = httpx.URL(DESKTOP)
        for _ in range(5):
            status, headers, body = await read(url)
            if status in (301, 302, 303, 307, 308):
                url = url.join(headers.get('location', ''))
                if not headers.get('location') or not desktop_target(url):
                    raise ExchangeFailed()
                continue
            if status != 200 or 'text/html' not in headers.get('content-type', '').lower():
                raise ExchangeFailed()
            user = desktop_identity(body.decode('utf-8', errors='replace'))
            if not user:
                raise ExchangeFailed()
            break
        else:
            raise ExchangeFailed()
        cookies = {}
        for cookie in client.cookies.jar:
            name, value = cookie.name, cookie.value
            if (cookie.domain.lstrip('.') not in ('ilias.unibe.ch', 'unibe.ch')
                    or not '/ilias.php'.startswith(cookie.path or '/')
                    or not (name in ('PHPSESSID', 'ilClientId') or name.startswith(('_shibsession_', 'il_')))):
                continue
            if (not value or len(value) > 8192 or any(ord(c) < 33 or ord(c) > 126 or c in '\",;\\' for c in value)
                    or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in name)
                    or name in cookies and cookies[name] != value):
                raise ExchangeFailed()
            cookies[name] = value
        if not cookies.get('PHPSESSID'):
            raise ExchangeFailed()
        validate()
        return cookies, user
