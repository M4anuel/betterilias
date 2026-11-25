"""UniBE ID-token exchange with cookie-only proof of the unique ILIAS login."""
from urllib.parse import parse_qsl
import hashlib

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
PROFILE = ORIGIN + '/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToProfile'


class ExchangeFailed(Exception):
    """Fixed message only: upstream bodies, URLs, cookies and tokens are private."""
    def __init__(self, stage='verification'):
        self.stage = stage
        super().__init__(stage)


@safe_parser(context_name='unisport_ilias_profile')
def profile_identity(html):
    """Only the server-selected own-profile editor proves the account's login.

    Public profile avatars and lecturer names are deliberately insufficient.
    Persist a digest of the unique login, never the form or its personal fields.
    """
    soup = BeautifulSoup(html, 'lxml')
    form = soup.select_one('form#form_pd')
    if form is None:
        return None
    action = httpx.URL(ORIGIN).join(form.get('action', ''))
    if not profile_target(action, form=True):
        return None
    logins = form.select('input[name="ne_un"][type="hidden"]')
    if len(logins) != 1 or not (login := logins[0].get('value', '').strip()) or len(login) > 512:
        return None
    first = form.select_one('input[name="usr_firstname"]')
    last = form.select_one('input[name="usr_lastname"]')
    name = ' '.join(node.get('value', '').strip() for node in (first, last) if node is not None)
    return (name or 'ILIAS')[:300], hashlib.sha256((ORIGIN + '\0' + login).encode()).hexdigest()


def profile_target(url, *, form=False):
    if url.scheme != 'https' or url.host != 'ilias.unibe.ch' or url.port not in (None, 443) or url.username or url.password or url.fragment or url.path != '/ilias.php':
        return False
    pairs = parse_qsl(url.query.decode('ascii'), keep_blank_values=True)
    values = {key.lower(): value.lower() for key, value in pairs}
    return (len(values) == len(pairs)
        and set(values) <= {'baseclass', 'cmdclass', 'cmd', 'cmdnode', 'rtoken'}
        and values.get('baseclass') == 'ildashboardgui'
        and values.get('cmdclass', '') in ('', 'ilpersonalprofilegui')
        and values.get('cmd', '') in (('post',) if form else ('', 'jumptoprofile', 'showpersonaldata')))


async def read_profile(read, validate):
    url = httpx.URL(PROFILE)
    for _ in range(5):
        status, headers, body = await read(url)
        if status in (301, 302, 303, 307, 308):
            url = url.join(headers.get('location', ''))
            if not headers.get('location') or not profile_target(url):
                raise ExchangeFailed('profile_redirect')
            continue
        if status != 200 or 'text/html' not in headers.get('content-type', '').lower():
            raise ExchangeFailed('profile_response')
        result = profile_identity(body.decode('utf-8', errors='replace'))
        if result is None:
            raise ExchangeFailed('profile_identity')
        validate()
        return result
    raise ExchangeFailed('profile_redirect')


async def existing_identity(cookies, owner, validate, *, transport=None, budget=None):
    """Cookie-only proof for a legacy session; never follows arbitrary redirects."""
    policy = TargetPolicy(native_url=ORIGIN, media_origins=[], allow_local=False)
    wire = BudgetTransport('unisport-ilias:' + owner, inner=EgressTransport(policy=policy, inner=transport), budget=budget, retries=0, max_bytes=0)
    async with httpx.AsyncClient(transport=wire, follow_redirects=False, trust_env=False,
            timeout=httpx.Timeout(20, connect=10), headers={'User-Agent': settings.user_agent}) as client:
        for name, value in cookies.items():
            client.cookies.set(name, value, domain='ilias.unibe.ch', path='/')
        async def read(url):
            validate()
            async with client.stream('GET', url) as response:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise ExchangeFailed('profile_size')
                return response.status_code, response.headers, bytes(body)
        return await read_profile(read, validate)


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
        raise ExchangeFailed('origin')
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
                        raise ExchangeFailed('response_size')
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
                raise ExchangeFailed('exchange_redirect')
        elif status != 200:
            raise ExchangeFailed('exchange_response')
        # The own-profile route is independent of dashboard/semester plugins.
        # Neither token header is forwarded; cookies alone must prove identity.
        user, account_key = await read_profile(read, validate)
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
                raise ExchangeFailed('cookies')
            cookies[name] = value
        if not cookies.get('PHPSESSID'):
            raise ExchangeFailed('cookies')
        validate()
        return cookies, user, account_key
