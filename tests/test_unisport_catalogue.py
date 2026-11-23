import asyncio
import json
import secrets
import time

from fastapi.testclient import TestClient
import pytest

from backend.config import settings
from backend.main import app
from backend.services import unisport_catalogue as public, unisport_auth as auth
from backend.services.unisport_client import UnisportReadError


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))
    monkeypatch.setattr(settings,'unisport_enabled',True)


def raw(identifier=1):
    return dict(id=identifier,title='Volleyball',sportName='Ball sports',registration='Register',status=1,
        offerNextDate={'begin':'2026-12-01T18:00:00+01:00','end':'2026-12-01T19:00:00+01:00'},
        location={'title':'Gym','subtitle':'Bern'},moreInfo={'url':'https://www.sport.unibe.ch/offer'},
        generalInfos=[{'title':'Equipment','content':'<p>Shoes</p><script>private()</script><img src=x onerror=alert(1)><p>Water</p>'}])


def test_projection_is_plain_safe_and_drops_personal_flags():
    value=raw();value.update(isBookmarked=True,access_token='must-not-escape')
    result=public.present_offer(value,detail=True)
    assert result['infos']==[{'title':'Equipment','content':'Shoes\nWater'}]
    assert '<' not in result['infos'][0]['content'] and 'private' not in result['infos'][0]['content']
    assert 'isBookmarked' not in result and 'access_token' not in result
    assert public.public_url('https://www.sport.unibe.ch/offer')
    for url in ('javascript:alert(1)','https://unibe.ch.evil.test/','http://unibe.ch/','https://user:secret@unibe.ch/',
            'https://evil.test\\foo.unibe.ch/','https://uni\nbe.ch/'):
        assert public.public_url(url) is None
    with pytest.raises(UnisportReadError):public.present_offer({'id':True,'title':'bad'})


@pytest.fixture
def upstream(monkeypatch):
    calls=[]
    class Client:
        def __init__(self,*args,**kwargs): assert not args and not kwargs
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def catalogue(self,locale):
            calls.append(('catalogue',locale));await asyncio.sleep(.02)
            return [raw(),raw(2),{**raw(3),'sportName':'Yoga'}]
        async def offer(self,identifier,locale,*,public):
            assert public is True;calls.append(('offer',identifier,locale));return raw(identifier)
    monkeypatch.setattr(public,'UnisportClient',Client)
    return calls


@pytest.mark.asyncio
async def test_complete_snapshot_and_sport_types_persist_coalesce_and_refresh(upstream):
    results=await asyncio.gather(*(public.catalogue('en') for _ in range(3)))
    assert results[0]==results[1]==results[2]
    assert results[0]['sports']==['Ball sports','Yoga'] and len(results[0]['items'])==3
    assert upstream==[('catalogue','en')]
    assert (await public.catalogue('en'))['fetched_at']==results[0]['fetched_at']
    await public.catalogue('de')
    await public.catalogue('en',refresh=True)
    assert upstream==[('catalogue','en'),('catalogue','de'),('catalogue','en')]
    with public.database() as db: assert db.execute('SELECT count(*) FROM cache').fetchone()[0]==2


@pytest.mark.asyncio
async def test_failed_refresh_retains_last_complete_snapshot(upstream,monkeypatch):
    previous=await public.catalogue('en')
    class Broken:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def catalogue(self,locale):raise UnisportReadError('incomplete_catalogue')
    monkeypatch.setattr(public,'UnisportClient',Broken)
    stale=await public.catalogue('en',refresh=True)
    assert stale['stale'] and stale['items']==previous['items'] and stale['fetched_at']==previous['fetched_at']
    assert public.read('catalogue:en')=={k:v for k,v in previous.items() if k!='stale'}
    with pytest.raises(UnisportReadError):await public.catalogue('de')
    assert public.read('catalogue:de') is None


@pytest.mark.asyncio
async def test_detail_cache_is_bounded_language_scoped_and_reused(upstream,monkeypatch):
    monkeypatch.setattr(public,'MAX_DETAILS',2)
    first=await public.offer(1,'en');assert first['offer']['infos'][0]['content']=='Shoes\nWater'
    assert await public.offer(1,'en')==first
    await public.offer(2,'en');await public.offer(3,'de')
    assert public.read('offer:en:1') is None
    assert public.read('offer:en:2') and public.read('offer:de:3')
    assert len(upstream)==3


def test_public_api_without_login_and_private_account_guards(upstream,monkeypatch):
    client=TestClient(app);credential=secrets.token_urlsafe(32);headers={'X-Unisport-Session':credential,'Accept-Language':'en'}
    response=client.get('/api/unisport/catalogue',headers=headers)
    assert response.status_code==200 and response.headers['cache-control']=='no-store'
    assert len(response.json()['items'])==3
    assert client.get('/api/unisport/offers/1',headers=headers).status_code==200
    assert client.get('/api/unisport/offers/0',headers=headers).status_code==422
    assert client.get('/api/unisport/bookmarks',headers=headers).status_code==401
    owner=auth.digest(credential);state='state';data=dict(phase='connected',token='synthetic-token',subject='account-one',affiliation='student')
    with auth.database() as db:db.execute('INSERT INTO connections VALUES (?,?,?,?)',(owner,state,time.time()+900,json.dumps(data)))
    scope=client.get('/api/unisport/connection',headers=headers).json()['scope']
    assert len(scope)==64 and scope!=data['subject']
    from backend.api.routes import unisport as routes
    class PersonalClient:
        def __init__(self,account): assert account.subject=='account-one'
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def bookmarks(self,locale):return [{**raw(),'offerNextDate':{'begin':'OLD OCCURRENCE'}},raw()]
        async def applications(self,locale):
            auth.disconnect(owner);return [{'id':1,'title':'must-not-escape-after-disconnect'}]
    monkeypatch.setattr(routes,'UnisportClient',PersonalClient)
    response=client.get('/api/unisport/bookmarks',headers={**headers,'X-Unisport-Scope':scope})
    assert response.json()=={'items':[{'id':1,'title':'Volleyball'}]}
    response=client.get('/api/unisport/bookmarks',headers={**headers,'X-Unisport-Scope':'b'*64})
    assert response.status_code==409 and response.headers['X-Unisport-Connection-Changed']=='1'
    response=client.get('/api/unisport/applications',headers={**headers,'X-Unisport-Scope':scope})
    assert response.status_code==409 and 'must-not-escape' not in response.text
