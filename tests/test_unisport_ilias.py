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

HTML = '<a class="il-user-avatar" title="Synthetic Student">SS</a><p>Kein Zugriffsrecht: archived course</p>'
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
        assert str(request.url)==bridge.DESKTOP
        assert 'authorization' not in request.headers and 'x-unicampus-affiliation' not in request.headers
        assert 'PHPSESSID=verified-synthetic' in request.headers['cookie']
        return httpx.Response(200, text=HTML, headers={'content-type':'text/html'})
    cookies,user=await bridge.exchange(account(),'owner',lambda:None,transport=httpx.MockTransport(handler),budget=Budget())
    assert len(calls)==3 and cookies['PHPSESSID']=='verified-synthetic' and user=='Synthetic Student'
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
        validate();return {'PHPSESSID':'new-verified-cookie'},'Synthetic Student'
    monkeypatch.setattr(bridge,'exchange',verified)
    with TestClient(app) as client:
        client.cookies.set('betterilias_session','existing-tenant')
        result=client.post('/api/unisport/ilias-connection',headers={**headers,'X-Session-Id':'existing-tenant'})
        assert result.status_code==200
        body=result.json();sid=body['session_id']
        assert body['authenticated'] is True and len(sid)==43 and sid!='existing-tenant'
        assert result.headers['cache-control']=='no-store' and 'set-cookie' not in result.headers
        assert TOKEN not in result.text and 'new-verified-cookie' not in result.text
        assert SessionManager(sid).load_cookies()=={'PHPSESSID':'new-verified-cookie'}
        assert SessionManager(sid).load_metadata()=={'source':'unisport_id_token','user_name':'Synthetic Student'}
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
        return {'PHPSESSID':'never-save'},'Synthetic Student'
    monkeypatch.setattr(bridge,'exchange',changing)
    with TestClient(app) as client:
        result=client.post('/api/unisport/ilias-connection',headers=headers)
        assert result.status_code==(502 if change=='failed' else 409)
    assert list(settings.sessions_path.glob('*.json'))==[old.cookie_file]
    assert old.load_cookies()=={'PHPSESSID':'old-cookie'}
