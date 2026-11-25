"""Synthetic tokens/cookies only: token confinement, positive identity and tenant activation."""
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from backend.config import settings
from backend.main import app
from backend.auth.session import SessionManager
from backend.services import unisport_auth as auth, unisport_ilias as bridge
from backend.services.unisport_client import UnisportAccount

HTML = '''<form id="form_pd" action="/ilias.php?baseClass=ildashboardgui&amp;cmdClass=ilPersonalProfileGUI&amp;cmd=post&amp;rtoken=synthetic">
<input type="hidden" name="ne_un" value="synthetic-unique-login">
<input name="usr_firstname" value="Synthetic"><input name="usr_lastname" value="Student"></form>
<p>Kein Zugriffsrecht: archived course</p>'''
KEY = bridge.profile_identity(HTML)[1]
TOKEN = 'synthetic-private-id-token'


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path/'coordination'))
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path/'sessions'))
    monkeypatch.setattr(settings, 'unisport_enabled', True)
    monkeypatch.setattr(settings, 'ilias_base_url', bridge.ORIGIN)


class Budget:
    async def acquire(self, identity):
        class Permit:
            async def close(self): pass
        return Permit()


def account(): return UnisportAccount('synthetic-subject', SecretStr(TOKEN), 'student@example.edu')


@pytest.mark.asyncio
async def test_exact_alias_exchange_and_cookie_only_positive_dashboard():
    calls=[]
    def handler(request):
        calls.append(request)
        if str(request.url) == bridge.ENTRY:
            assert request.headers['authorization']==TOKEN
            assert request.headers['x-unicampus-affiliation']=='student@example.edu'
            return httpx.Response(302, headers={'location':bridge.ALIAS})
        if str(request.url) == bridge.ALIAS:
            assert request.headers['authorization']==TOKEN
            return httpx.Response(302, headers={'location':bridge.DESKTOP,'set-cookie':'PHPSESSID=verified-synthetic; Path=/; HttpOnly; Secure'})
        assert str(request.url)==bridge.PROFILE
        assert 'authorization' not in request.headers and 'x-unicampus-affiliation' not in request.headers
        assert 'PHPSESSID=verified-synthetic' in request.headers['cookie']
        return httpx.Response(200, text=HTML, headers={'content-type':'text/html'})
    cookies,user,key=await bridge.exchange(account(),'owner',lambda:None,transport=httpx.MockTransport(handler),budget=Budget())
    assert len(calls)==3 and cookies['PHPSESSID']=='verified-synthetic' and user=='Synthetic Student'
    assert key == KEY
    assert TOKEN not in json.dumps(cookies)


@pytest.mark.asyncio
@pytest.mark.parametrize('mode',['external','alias_extra_query','login','error','http','loop','anonymous','generic_desktop','missing_cookie','large','timeout'])
async def test_rejected_exchanges_never_invent_authenticated_session(mode):
    calls=[]
    def handler(request):
        calls.append(request)
        if str(request.url)==bridge.ENTRY:
            if mode=='timeout':raise httpx.ReadTimeout('synthetic timeout')
            destinations={'external':'https://example.invalid/','alias_extra_query':bridge.ALIAS+'&token=extra',
                'login':bridge.ORIGIN+'/login.php','error':bridge.ORIGIN+'/Customizing/global/plugins/Origins2/error.php',
                'http':bridge.DESKTOP.replace('https:','http:'),'loop':bridge.ENTRY}
            if mode in destinations:return httpx.Response(302,headers={'location':destinations[mode]})
            return httpx.Response(200,headers={'set-cookie':'PHPSESSID=anonymous-synthetic; Path=/'})
        assert 'authorization' not in request.headers
        body={'anonymous':'<form><input name="username"><input name="password"></form>',
            'generic_desktop':'<div class="il-view-content">Guest content</div>',
            'large':'x'*(bridge.MAX_BYTES+1)}.get(mode,HTML)
        if mode=='missing_cookie':return httpx.Response(200,text=HTML,headers={'content-type':'text/html','set-cookie':'PHPSESSID=; Max-Age=0; Path=/'})
        return httpx.Response(200,text=body,headers={'content-type':'text/html'})
    with pytest.raises((bridge.ExchangeFailed,httpx.HTTPError)):
        await bridge.exchange(account(),'owner',lambda:None,transport=httpx.MockTransport(handler),budget=Budget())
    assert all(request.url.host=='ilias.unibe.ch' for request in calls)
    assert len(calls)<=2


@pytest.mark.asyncio
async def test_custom_ilias_origin_never_receives_token(monkeypatch):
    monkeypatch.setattr(settings,'ilias_base_url','https://self-hosted.example')
    def forbidden(request):pytest.fail('No credential request to a custom ILIAS origin')
    with pytest.raises(bridge.ExchangeFailed):
        await bridge.exchange(account(),'owner',lambda:None,transport=httpx.MockTransport(forbidden),budget=Budget())


def connection():
    owner=auth.digest('x'*43);state='synthetic-state';data=dict(phase='connected',token=TOKEN,subject='synthetic',affiliation='student')
    with auth.database() as db:db.execute('INSERT INTO connections VALUES (?,?,?,?)',(owner,state,time.time()+900,json.dumps(data)))
    return owner,state,data,{'X-Unisport-Session':'x'*43,'X-Unisport-Scope':auth.digest(state+':synthetic'),'X-Unisport-Affiliation':'student'}


def test_endpoint_uses_fresh_capability_and_preserves_other_tenants(monkeypatch):
    owner,state,data,headers=connection()
    old=SessionManager('existing-tenant');old.save_cookies({'PHPSESSID':'old-cookie'},metadata={'user_name':'Old Account'})
    async def verified(account,identity,validate):
        assert identity==owner and account.id_token.get_secret_value()==TOKEN
        validate();return {'PHPSESSID':'new-verified-cookie'},'Synthetic Student',KEY
    monkeypatch.setattr(bridge,'exchange',verified)
    async def other_identity(*args): return 'Old Account', 'b'*64
    monkeypatch.setattr(bridge,'existing_identity',other_identity)
    with TestClient(app) as client:
        client.cookies.set('betterilias_session','existing-tenant')
        result=client.post('/api/unisport/ilias-connection',headers={**headers,'X-Session-Id':'existing-tenant'})
        assert result.status_code==200
        body=result.json();sid=body['session_id']
        assert body['authenticated'] is True and len(sid)==43 and sid!='existing-tenant'
        assert result.headers['cache-control']=='no-store' and 'set-cookie' not in result.headers
        assert TOKEN not in result.text and 'new-verified-cookie' not in result.text
        assert SessionManager(sid).load_cookies()=={'PHPSESSID':'new-verified-cookie'}
        assert SessionManager(sid).load_metadata()=={'source':'unisport_id_token','user_name':'Synthetic Student','ilias_account_key':KEY,'user_agent':settings.user_agent}
        assert body['renewed'] is False
        assert old.load_cookies()=={'PHPSESSID':'old-cookie'}
        assert client.post('/api/unisport/ilias-connection').status_code==401
        assert client.post('/api/unisport/ilias-connection',headers={**headers,'X-Unisport-Scope':'b'*64}).status_code==409
        assert client.post('/api/unisport/ilias-connection',headers={**headers,'X-Unisport-Affiliation':'staff'}).status_code==409


@pytest.mark.parametrize('change',['disconnect','affiliation','replacement','expired','failed'])
def test_failed_or_replaced_connection_cannot_persist_new_credentials(monkeypatch,change):
    owner,state,data,headers=connection()
    old=SessionManager('existing-tenant');old.save_cookies({'PHPSESSID':'old-cookie'})
    async def changing(account,identity,validate):
        if change=='failed':raise bridge.ExchangeFailed()
        with auth.database() as db:
            if change=='disconnect':db.execute('DELETE FROM connections WHERE owner=?',(owner,))
            elif change=='affiliation':db.execute('UPDATE connections SET data=? WHERE owner=?',(json.dumps({**data,'affiliation':'staff'}),owner))
            elif change=='expired':db.execute('UPDATE connections SET expires=0 WHERE owner=?',(owner,))
            else:db.execute('UPDATE connections SET state=? WHERE owner=?',('new-state',owner))
        return {'PHPSESSID':'never-save'},'Synthetic Student',KEY
    monkeypatch.setattr(bridge,'exchange',changing)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers=headers)
        assert result.status_code==(422 if change=='failed' else 409)
        if change=='failed': assert result.headers['x-ilias-verification-stage']=='verification'
    assert list(settings.sessions_path.glob('*.json'))==[old.cookie_file]
    assert old.load_cookies()=={'PHPSESSID':'old-cookie'}


@pytest.mark.parametrize('legacy', [False, True])
def test_same_account_reuses_capability_and_preserves_metadata(monkeypatch, legacy):
    _,_,_,headers=connection()
    old=SessionManager('existing-tenant')
    meta={'user_name':'Different display name','source':'extension','draft_marker':'keep','user_agent':'old-browser-agent'}
    if not legacy:meta.update(source='unisport_id_token',ilias_account_key=KEY)
    old.save_cookies({'PHPSESSID':'old-cookie'},metadata=meta)
    async def verified(*args):return {'PHPSESSID':'renewed-cookie'},'Synthetic Student',KEY
    async def old_identity(cookies,*args):
        assert cookies=={'PHPSESSID':'old-cookie'}
        return 'Old display name',KEY
    monkeypatch.setattr(bridge,'exchange',verified)
    monkeypatch.setattr(bridge,'existing_identity',old_identity)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers={**headers,'X-Session-Id':old.session_id})
    assert result.status_code==200 and result.json()['renewed'] is True
    assert result.json()['session_id']==old.session_id
    assert old.load_cookies()=={'PHPSESSID':'renewed-cookie'}
    assert old.load_metadata()['draft_marker']=='keep'
    assert old.load_metadata()['user_agent']==settings.user_agent
    assert len(list(settings.sessions_path.glob('*.json')))==1


@pytest.mark.parametrize('change',['logout','cookies','identity'])
def test_renewal_cannot_resurrect_or_overwrite_changed_session(monkeypatch,change):
    _,_,_,headers=connection()
    old=SessionManager('existing-tenant')
    old.save_cookies({'PHPSESSID':'old-cookie'},metadata={'ilias_account_key':KEY,'source':'unisport_id_token'})
    async def verified(*args):
        if change=='logout':old.clear_session()
        elif change=='cookies':old.save_cookies({'PHPSESSID':'changed-cookie'})
        else:old.save_metadata({'ilias_account_key':'b'*64})
        return {'PHPSESSID':'never-save'},'Synthetic Student',KEY
    monkeypatch.setattr(bridge,'exchange',verified)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers={**headers,'X-Session-Id':old.session_id})
    assert result.status_code==409
    assert old.load_cookies().get('PHPSESSID')!='never-save'
    if change=='logout':assert not old.cookie_file.exists()


def test_ambient_session_is_never_a_renewal_target(monkeypatch):
    _,_,_,headers=connection()
    old=SessionManager('existing-tenant')
    old.save_cookies({'PHPSESSID':'old-cookie'},metadata={'ilias_account_key':KEY,'source':'unisport_id_token'})
    async def verified(*args):return {'PHPSESSID':'new-cookie'},'Synthetic Student',KEY
    monkeypatch.setattr(bridge,'exchange',verified)
    with TestClient(app) as client:
        client.cookies.set('betterilias_session',old.session_id)
        result=client.post('/api/unisport/ilias-connection',headers=headers)
    assert result.status_code==200 and result.json()['renewed'] is False
    assert result.json()['session_id']!=old.session_id and old.load_cookies()['PHPSESSID']=='old-cookie'


@pytest.mark.asyncio
async def test_real_profile_redirect_shape_and_token_confinement():
    calls=[]
    def handler(request):
        calls.append(request)
        if str(request.url)==bridge.ENTRY:
            return httpx.Response(302,headers={'location':bridge.ALIAS})
        if str(request.url)==bridge.ALIAS:
            return httpx.Response(302,headers={'location':bridge.DESKTOP,'set-cookie':'PHPSESSID=synthetic; Path=/'})
        assert 'authorization' not in request.headers and 'x-unicampus-affiliation' not in request.headers
        if str(request.url)==bridge.PROFILE:
            return httpx.Response(302,headers={'location':'/ilias.php?baseClass=ildashboardgui&cmdNode=synthetic&cmdClass=ilPersonalProfileGUI'})
        return httpx.Response(200,text=HTML,headers={'content-type':'text/html'})
    cookies,user,key=await bridge.exchange(account(),'owner',lambda:None,transport=httpx.MockTransport(handler),budget=Budget())
    assert len(calls)==4 and key==KEY and user=='Synthetic Student'


@pytest.mark.parametrize('html',[
    '<span class="il-avatar">Lecturer</span>',
    '<a class="il-user-avatar" title="Same Name">SN</a>',
    HTML.replace('ilPersonalProfileGUI','ilPublicUserProfileGUI'),
    HTML.replace('value="synthetic-unique-login"','value=""'),
    HTML.replace('cmd=post','cmd=delete'),
    HTML.replace('action="/ilias.php','action="https://other.invalid/ilias.php'),
])
def test_only_own_profile_proves_account(html):
    assert bridge.profile_identity(html) is None


@pytest.mark.parametrize('source',['chrome-extension','firefox-extension'])
def test_companion_sync_cannot_overwrite_unibe_session(monkeypatch,source):
    old=SessionManager('existing-tenant')
    old.save_cookies({'PHPSESSID':'unibe-cookie'},metadata={'source':'unisport_id_token','ilias_account_key':KEY,'user_name':'Synthetic Student'})
    async def valid(self):return True,'Synthetic Student'
    monkeypatch.setattr(SessionManager,'verify_session',valid)
    with TestClient(app) as client:
        result=client.post('/api/auth/sync',json={'session_id':old.session_id,'cookies':{'PHPSESSID':'browser-cookie'},'source':source})
    assert result.status_code==200 and result.json()['session_id']!=old.session_id
    assert old.load_cookies()=={'PHPSESSID':'unibe-cookie'}


@pytest.mark.asyncio
@pytest.mark.parametrize('destination',[
    'https://other.invalid/ilias.php', '/login.php',
    '/ilias.php?baseClass=ilpublicuserprofilegui&cmd=getHTML&user=123',
    '/ilias.php?baseClass=ildashboardgui&cmdClass=ilPersonalProfileGUI&cmd=savePersonalData',
    '/ilias.php?baseClass=ildashboardgui&baseClass=ilDashboardGUI',
    '/ilias.php?baseClass=ildashboardgui&cmdClass=ilPersonalProfileGUI&user=123',
    bridge.PROFILE,
])
async def test_cookie_only_profile_probe_rejects_unrelated_or_looped_redirects(destination):
    calls=[]
    def handler(request):
        calls.append(request)
        assert request.url.host=='ilias.unibe.ch' and 'authorization' not in request.headers
        return httpx.Response(302,headers={'location':destination})
    with pytest.raises(bridge.ExchangeFailed):
        await bridge.existing_identity({'PHPSESSID':'synthetic'},'owner',lambda:None,transport=httpx.MockTransport(handler),budget=Budget())
    assert len(calls)<=5


def test_unverifiable_legacy_account_is_isolated_even_with_same_display_name(monkeypatch):
    _,_,_,headers=connection()
    old=SessionManager('existing-tenant')
    old.save_cookies({'PHPSESSID':'expired'},metadata={'user_name':'Synthetic Student'})
    async def verified(*args):return {'PHPSESSID':'new-cookie'},'Synthetic Student',KEY
    async def expired(*args):raise bridge.ExchangeFailed('profile_identity')
    monkeypatch.setattr(bridge,'exchange',verified)
    monkeypatch.setattr(bridge,'existing_identity',expired)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers={**headers,'X-Session-Id':old.session_id})
    assert result.status_code==200 and result.json()['renewed'] is False
    assert result.json()['session_id']!=old.session_id and old.load_cookies()=={'PHPSESSID':'expired'}


@pytest.mark.parametrize('upstream',[False,True])
def test_expected_verification_failure_has_safe_stage_and_completed_rejection_audit(monkeypatch,upstream):
    from backend import observability
    _,_,_,headers=connection();events=[]
    monkeypatch.setattr(observability,'emit',lambda event,**fields:events.append((event,fields)))
    async def failed(*args):
        observability.mark_dispatch()
        if upstream:raise httpx.ReadTimeout('private synthetic upstream detail')
        raise bridge.ExchangeFailed('profile_identity')
    monkeypatch.setattr(bridge,'exchange',failed)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers=headers)
    assert result.status_code==(502 if upstream else 422)
    assert result.headers['x-ilias-verification-stage']==('upstream' if upstream else 'profile_identity')
    assert 'private synthetic' not in result.text and TOKEN not in result.text
    outcomes=[fields for event,fields in events if event=='write.finished']
    assert outcomes[-1]['outcome']=='rejected' and outcomes[-1]['reason']=='operation_rejected'
