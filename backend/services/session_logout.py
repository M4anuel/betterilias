"""Read the authenticated account menu's current CSRF-protected logout link."""
from urllib.parse import parse_qsl
import httpx
from bs4 import BeautifulSoup
from backend.auth.indicators import authenticated_control
from backend.config import settings
from backend.scrapers.dumper import safe_parser


def native_target(value):
    base=httpx.URL(settings.ilias_base_url.rstrip('/')+'/')
    target=base.join(value)
    return target if (target.scheme,target.host,target.port)==(base.scheme,base.host,base.port) and not target.username and not target.password and not target.fragment and target.path==base.path.rstrip('/')+'/ilias.php' else None


@safe_parser('authenticated_logout_link')
def logout_link(html):
    if authenticated_control(html) is None:return None
    soup=BeautifulSoup(html,'lxml')
    for anchor in soup.select('.il-maincontrols-metabar a[href], .il-metabar-slates a[href]'):
        try:
            target=native_target(anchor['href'])
            if target is None:continue
            pairs=parse_qsl(target.query.decode('ascii'),keep_blank_values=True)
            values={key.lower():value for key,value in pairs}
            if (len(values)==len(pairs) and set(values)<={'baseclass','cmd','rtoken','lang','client_id'}
                and values.get('baseclass','').lower()=='ilstartupgui' and values.get('cmd','').lower()=='dologout'
                and 0<len(values.get('rtoken',''))<=512):return target
        except (httpx.InvalidURL,ValueError,UnicodeError):continue
    return None


async def end_native_session(client):
    base=settings.ilias_base_url.rstrip('/')
    target=httpx.URL(base+'/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToProfile')
    for _ in range(4):
        async with client.stream('GET',target,follow_redirects=False) as page:
            if page.is_redirect:
                target=native_target(page.headers.get('location',''))
                if target is None:return False
                pairs=parse_qsl(target.query.decode('ascii'),keep_blank_values=True)
                values={key.lower():value.lower() for key,value in pairs}
                if (len(values)!=len(pairs) or set(values)-{'baseclass','cmd','cmdclass','cmdnode','client_id','rtoken'}
                    or values.get('baseclass','') not in ('ildashboardgui','ilpersonaldesktopgui')
                    or values.get('cmdclass','') not in ('','ilpersonalprofilegui','ildashboardgui')
                    or values.get('cmd','') not in ('','jumptoprofile','showpersonaldata')):return False
                continue
            if page.status_code!=200:return False
            body=bytearray()
            async for chunk in page.aiter_bytes():
                body.extend(chunk)
                if len(body)>2_000_000:return False
        target=logout_link(body.decode('utf-8',errors='replace'))
        if target is None:return False
        # One authenticated mutation only. No retry or SSO redirect following.
        async with client.stream('GET',target,follow_redirects=False) as result:
            return result.is_redirect
    return False
