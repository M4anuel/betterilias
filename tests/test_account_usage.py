"""Verified account counts, admin-only names and 30-day inactivity retention."""
import json

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import activity
from backend.api.deps import get_optional_session_manager
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.services import unisport_auth as auth


@pytest.fixture
def clock(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'observability_dir',str(tmp_path/'metrics'))
    monkeypatch.setattr(settings,'sessions_dir',str(tmp_path/'sessions'))
    monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))
    monkeypatch.setattr(settings,'admin_api_key','k'*43)
    now=[2000000000.0];monkeypatch.setattr(activity.time,'time',lambda:now[0])
    return now


def key(subject):return activity.account_key(auth.ISSUER,auth.CLIENT,subject)


def test_distinct_verified_accounts_deduplicate_browsers_and_do_not_merge_names(clock):
    first=key('private-subject-one');second=key('private-subject-two')
    assert activity.account_summary()['retained']==0
    activity.record('private-session-one',account=first,name='Same Name')
    activity.record('private-session-two',account=first,name='Same Name')
    activity.record('private-session-three',account=second,name='Same Name')
    assert activity.summary()['last_24_hours']==3
    assert activity.account_summary()['last_24_hours']==2
    page=activity.account_page('same name')
    assert page['total']==2 and len({r['id'] for r in page['accounts']})==2
    raw=(settings.observability_path/'activity.sqlite3').read_bytes()
    assert b'private-subject' not in raw and b'private-session' not in raw


def test_named_records_expire_30_days_after_last_use(clock):
    first=key('one');second=key('two')
    activity.record('one',account=first,name='Retained Name')
    activity.record('two',account=second,name='Expired Marker')
    clock[0]+=29*86400;activity.record('another-browser',account=first,name='Retained Name')
    clock[0]+=2*86400;activity.prune()
    assert activity.account_summary()['retained']==1
    assert activity.account_page()['accounts'][0]['name']=='Retained Name'
    assert b'Expired Marker' not in (settings.observability_path/'activity.sqlite3').read_bytes()
    clock[0]+=30*86400;activity.prune()
    assert activity.account_summary()['retained']==0


def test_disabled_admin_dashboard_does_not_collect_names(clock,monkeypatch):
    identity=key('one');monkeypatch.setattr(settings,'admin_api_key','')
    assert key('one') is None
    activity.record('connection',account=identity,name='Must Not Persist')
    assert activity.account_summary()['retained']==0
    assert b'Must Not Persist' not in (settings.observability_path/'activity.sqlite3').read_bytes()


def test_only_actual_app_requests_record_named_activity(clock):
    test=FastAPI()
    def endpoint(manager=Depends(get_optional_session_manager)):return {'authenticated':manager is not None}
    for path in ('/api/content','/api/auth/status','/api/diagnostics/preference','/api/admin/example'):
        test.add_api_route(path,endpoint,methods=['GET','POST'])
    SessionManager('student').save_cookies({'PHPSESSID':'synthetic'},metadata={
        'source':'unisport_id_token','usage_account_key':key('one'),'user_name':'Synthetic Student'})
    with TestClient(test) as client:
        for path in ('/api/auth/status','/api/diagnostics/preference','/api/admin/example'):
            client.get(path,headers={'X-Session-Id':'student'})
        client.get('/api/content',headers={'X-Session-Id':'unknown'})
        assert activity.account_summary()['retained']==0
        client.get('/api/content',headers={'X-Session-Id':'student'})
    assert activity.account_page()['accounts'][0]['name']=='Synthetic Student'


def test_unisport_use_counts_shared_subject_but_login_status_does_not(clock,monkeypatch):
    monkeypatch.setattr(settings,'unisport_enabled',True)
    from backend.services import unisport_catalogue as unisport_public
    async def catalogue(*args, **kwargs):return {'items':[],'sports':[],'fetched_at':clock[0],'stale':False}
    monkeypatch.setattr(unisport_public,'catalogue',catalogue)
    owner=auth.digest('x'*43);data={'phase':'connected','token':'private-token','subject':'one','name':'Synthetic Student','affiliation':'member@unibe.ch'}
    with auth.database() as db:db.execute('INSERT INTO connections VALUES(?,?,?,?)',(owner,'state',clock[0]+600,json.dumps(data)))
    with TestClient(app) as client:
        headers={'X-Unisport-Session':'x'*43}
        assert client.get('/api/unisport/connection',headers=headers).status_code==200
        assert activity.account_summary()['retained']==0
        assert client.get('/api/unisport/catalogue',headers=headers).status_code==200
    activity.record('native-ilias-session',account=key('one'),name='Synthetic Student')
    assert activity.account_summary()['retained']==1


def test_names_are_admin_only_and_search_is_literal_unicode_and_private(clock):
    activity.record('one',account=key('one'),name='MÜLLER 100%_Student')
    assert activity.account_page('müller')['total']==1
    assert activity.account_page('%_')['total']==1
    assert activity.account_page('unmatched%')['total']==0
    with TestClient(app) as client:
        assert client.post('/api/admin/accounts/query',json={}).status_code==404
        assert client.post('/api/admin/accounts/query',headers={'X-Session-Id':'student'},json={}).status_code==404
        headers={'X-Admin-Key':'k'*43,'X-Admin-Request':'1'}
        response=client.post('/api/admin/accounts/query',headers=headers,json={'query':'müller','limit':1})
        assert response.status_code==200 and response.headers['cache-control']=='no-store'
        assert response.json()['accounts'][0]['name']=='MÜLLER 100%_Student'
        summary=client.get('/api/admin/summary',headers=headers).json()
        assert summary['accounts']['retention_days']==30 and summary['accounts']['retained']==1
        assert 'MÜLLER' not in json.dumps(summary)


def test_verified_exchange_supplies_hashed_usage_key_and_disclosure(clock,monkeypatch):
    from backend.services import unisport_ilias as bridge
    monkeypatch.setattr(settings,'ilias_base_url',bridge.ORIGIN)
    owner=auth.digest('x'*43)
    data={'phase':'connected','token':'private-token','subject':'private-subject','affiliation':'member@unibe.ch'}
    with auth.database() as db:db.execute('INSERT INTO connections VALUES(?,?,?,?)',(owner,'state',clock[0]+600,json.dumps(data)))
    async def exchange(account,identity,validate):
        validate();return {'PHPSESSID':'synthetic-cookie'},'Synthetic Student','a'*64
    monkeypatch.setattr(bridge,'exchange',exchange)
    with TestClient(app) as client:
        assert client.get('/api/auth/unibe/availability').json()['usage_retention_days']==30
        result=client.post('/api/auth/unibe/ilias-connection',headers={
            'X-Unisport-Session':'x'*43,'X-Unisport-Scope':auth.digest('state:private-subject'),
            'X-Unisport-Affiliation':'member@unibe.ch'})
        assert result.status_code==200
    session=SessionManager(result.json()['session_id'])
    assert session.load_metadata()['usage_account_key']==key('private-subject')
    assert 'private-subject' not in json.dumps(session.load_metadata())
    assert activity.account_summary()['retained']==0  # Connecting alone is not app use.
