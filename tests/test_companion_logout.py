"""Native logout is explicit, bounded and isolated; no real ILIAS requests."""
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.services.session_logout import logout_link


@pytest.mark.parametrize('outcome',['success','network','rejected'])
def test_native_logout_revokes_only_selected_session_and_never_follows_sso(tmp_path,monkeypatch,outcome):
    monkeypatch.setattr(settings,'sessions_dir',str(tmp_path/'sessions'))
    monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))
    manager=SessionManager('alice');manager.save_cookies({'PHPSESSID':'alice-cookie'})
    other=SessionManager('bob');other.save_cookies({'PHPSESSID':'bob-cookie'})
    calls=[]
    def respond(request):
        calls.append(request)
        if outcome=='network':raise httpx.ConnectError('synthetic',request=request)
        if request.url.params['cmd']=='jumpToProfile':
            return httpx.Response(200,text='<div class="il-maincontrols-metabar"><a class="il-user-avatar">User</a><a href="ilias.php?baseClass=ilstartupgui&amp;cmd=doLogout&amp;rtoken=synthetic-token">Logout</a></div>')
        assert request.url.params['cmd']=='doLogout' and request.url.params['rtoken']=='synthetic-token'
        return httpx.Response(503 if outcome=='rejected' else 302,headers={'location':'https://login.eduid.ch/global-logout'})
    def client(self):return httpx.AsyncClient(base_url=settings.ilias_base_url,transport=httpx.MockTransport(respond))
    monkeypatch.setattr(SessionManager,'get_http_client',client)
    with TestClient(app) as browser:
        response=browser.post('/api/auth/logout',headers={'X-Session-Id':'alice','X-ILIAS-Logout':'1'})
    assert response.status_code==200
    assert response.json()['ilias_logout_confirmed'] is (outcome=='success')
    assert len(calls)==(1 if outcome=='network' else 2) and not manager.has_cookies() and other.has_cookies()


@pytest.mark.parametrize('href',[
    'https://other.example/ilias.php?baseClass=ilstartupgui&cmd=doLogout&rtoken=token',
    'ilias.php?baseClass=ilstartupgui&cmd=doLogout',
    'ilias.php?baseClass=ilstartupgui&cmd=delete&rtoken=token',
    'ilias.php?baseClass=ilstartupgui&cmd=doLogout&cmd=delete&rtoken=token',
    'ilias.php?baseClass=ilstartupgui&cmd=doLogout&rtoken=token#fragment',
])
def test_logout_parser_rejects_untrusted_or_unguarded_target(href):
    assert logout_link(f'<div class="il-maincontrols-metabar"><a class="il-user-avatar">User</a><a href="{href}">Logout</a></div>') is None


def test_real_unibe_metabar_supplies_csrf_protected_logout():
    from pathlib import Path
    html=(Path(__file__).parent/'fixtures/unibe/unibe_semester_hs2026.html').read_text(encoding='utf-8')
    target=logout_link(html)
    assert target is not None and target.params['cmd']=='doLogout' and target.params['rtoken']
