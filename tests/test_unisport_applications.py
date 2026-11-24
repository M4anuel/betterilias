"""Private UI cache isolation, refresh/coalescing and write invalidation."""
import asyncio
import json
import time

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest

from backend.config import settings
from backend.main import app
from backend.services import unisport_auth as auth, unisport_applications as cache
from backend.services.unisport_client import UnisportAccount


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))
    monkeypatch.setattr(settings,'unisport_enabled',True)


def account(subject='synthetic',affiliation='student'):
    return UnisportAccount(subject,SecretStr('synthetic-token'),affiliation)


@pytest.mark.asyncio
async def test_cache_coalesces_and_preserves_original_timestamp():
    calls=[]
    async def load():
        calls.append(1);await asyncio.sleep(.025);return [{'id':42,'title':'Synthetic offer'}]
    async def get(refresh=False):return await cache.snapshot('owner','state',account(),'en',load,lambda:None,refresh=refresh)
    first,second=await asyncio.gather(get(),get())
    assert first==second and calls==[1]
    assert await get()==first and calls==[1]
    newer,duplicate=await asyncio.gather(get(True),get(True))
    assert newer==duplicate and len(calls)==2 and newer['fetched_at']>=first['fetched_at']


@pytest.mark.asyncio
async def test_owner_generation_affiliation_and_language_are_separate():
    calls=[]
    async def load():calls.append(1);return [{'id':len(calls)}]
    for owner,state,affiliation,language in [('a','first','student','en'),('b','first','student','en'),
            ('a','second','student','en'),('a','first','staff','en'),('a','first','student','de')]:
        result=await cache.snapshot(owner,state,account(affiliation=affiliation),language,load,lambda:None)
        assert result['items'][0]['id']==len(calls)
    assert len(calls)==5


@pytest.mark.asyncio
async def test_expired_and_disconnected_results_are_not_cached():
    calls=[]
    async def load():calls.append(1);return []
    await cache.snapshot('a','state',account(),'en',load,lambda:None)
    with auth.database() as db:db.execute('UPDATE unisport_applications_cache SET fetched=?',(time.time()-61,))
    await cache.snapshot('a','state',account(),'en',load,lambda:None)
    assert len(calls)==2
    checks=[]
    def validate():
        checks.append(1)
        if len(checks)==2:raise ValueError('connection replaced')
    with pytest.raises(ValueError):await cache.snapshot('b','state',account(),'en',load,validate)
    with auth.database() as db:assert db.execute('SELECT count(*) FROM unisport_applications_cache WHERE owner=?',('b',)).fetchone()[0]==0


@pytest.mark.asyncio
async def test_mutation_invalidates_all_connections_of_that_account_and_blocks_old_inflight_cache():
    rows=[{'id':42}];started=asyncio.Event();release=asyncio.Event()
    async def load():started.set();await release.wait();return list(rows)
    read=asyncio.create_task(cache.snapshot('a','state',account(),'en',load,lambda:None))
    await started.wait()
    async def write():
        async with cache.mutation(account()):rows.clear()
    mutation=asyncio.create_task(write());await asyncio.sleep(.03)
    assert not mutation.done()
    release.set();await read;await mutation
    async def fresh():return list(rows)
    assert (await cache.snapshot('a','state',account(),'en',fresh,lambda:None))['items']==[]
    with auth.database() as db:assert db.execute('SELECT count(*) FROM unisport_applications_cache').fetchone()[0]==1


def test_http_legacy_list_snapshot_refresh_and_affiliation_guard(monkeypatch):
    from backend.api.routes import unisport as routes
    owner=auth.digest('x'*43);state='state';data=dict(phase='connected',token='synthetic-token',subject='synthetic',affiliation='student')
    with auth.database() as db:db.execute('INSERT INTO connections VALUES (?,?,?,?)',(owner,state,time.time()+900,json.dumps(data)))
    calls=[]
    class Native:
        def __init__(self,owned):assert owned.subject=='synthetic'
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def applications(self,locale):calls.append(1);return [{'id':42,'title':'Synthetic offer'}]
    monkeypatch.setattr(routes,'UnisportClient',Native)
    headers={'X-Unisport-Session':'x'*43,'X-Unisport-Scope':auth.digest(state+':synthetic'),'X-Unisport-Affiliation':'student'}
    with TestClient(app) as client:
        legacy=client.get('/api/unisport/applications',headers=headers)
        snapshot=client.get('/api/unisport/applications?metadata=true',headers=headers)
        assert legacy.json()==snapshot.json()['items'] and len(calls)==1
        assert snapshot.headers['cache-control']=='no-store'
        assert client.get('/api/unisport/applications?metadata=true',headers=headers).json()==snapshot.json()
        assert client.get('/api/unisport/applications?refresh=true',headers=headers).status_code==200 and len(calls)==2
        assert client.get('/api/unisport/applications',headers={**headers,'X-Unisport-Affiliation':'staff'}).status_code==409
        assert client.get('/api/unisport/applications',headers={}).status_code==401
        client.delete('/api/unisport/connection',headers=headers)
        assert client.get('/api/unisport/applications',headers=headers).status_code==401
    with auth.database() as db:assert db.execute('SELECT count(*) FROM unisport_applications_cache').fetchone()[0]==0
