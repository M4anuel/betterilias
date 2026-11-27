"""Shared-login status never exports provider credentials or guesses a tenant."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.services import unisport_auth as auth, unisport_ilias as bridge


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))
    monkeypatch.setattr(settings,'sessions_dir',str(tmp_path/'sessions'))
    monkeypatch.setattr(settings,'unisport_enabled',False)
    monkeypatch.setattr(settings,'admin_api_key','')
    monkeypatch.setattr(settings,'ilias_base_url',bridge.ORIGIN)


def connection():
    owner=auth.digest('x'*43);state='synthetic-generation'
    data={'phase':'connected','token':'private-synthetic-token','subject':'private-synthetic-subject',
        'affiliation':'member@unibe.ch','name':'Synthetic Student','expires_at':time.time()+600}
    with auth.database() as db:
        db.execute('INSERT INTO connections VALUES(?,?,?,?)',(owner,state,data['expires_at'],json.dumps(data)))
    return owner,state,data,{'X-Unisport-Session':'x'*43}


def test_shared_login_is_independent_of_hidden_unisport_and_never_accepts_ambient_session(monkeypatch):
    owner,state,data,headers=connection()
    async def choices(*args):return ['member@unibe.ch','member@other.edu']
    monkeypatch.setattr(auth,'affiliations',choices)
    with TestClient(app) as client:
        client.cookies.set('betterilias_session','ambient')
        assert client.get('/api/unisport/availability').json()=={'enabled':False}
        assert client.get('/api/auth/unibe/availability').json()=={'enabled':True,'usage_retention_days':None}
        assert client.get('/api/auth/unibe/connection').status_code==401
        response=client.get('/api/auth/unibe/connection',headers=headers)
    assert response.status_code==200 and response.headers['cache-control']=='no-store'
    result=response.json()
    assert result['phase']=='connected' and result['user_name']=='Synthetic Student'
    assert result['affiliations']==['member@unibe.ch','member@other.edu']
    assert result['expires_at']==data['expires_at'] and result['scope']==auth.digest(state+':'+data['subject'])
    assert data['token'] not in response.text and data['subject'] not in response.text


@pytest.mark.parametrize('failure',['expired','revoked','network','replaced'])
def test_expiry_and_revocation_differ_from_temporary_failure(monkeypatch,failure):
    owner,state,data,headers=connection()
    if failure=='expired':
        with auth.database() as db:db.execute('UPDATE connections SET expires=0 WHERE owner=?',(owner,))
    async def choices(*args):
        if failure=='network':raise auth.LoginError()
        if failure=='replaced':
            with auth.database() as db:db.execute('UPDATE connections SET state=? WHERE owner=?',('replacement',owner))
        raise auth.CredentialRejected()
    monkeypatch.setattr(auth,'affiliations',choices)
    with TestClient(app) as client:response=client.get('/api/auth/unibe/connection',headers=headers)
    if failure=='network':
        assert response.status_code==502 and auth.record(owner)==(state,data)
    elif failure=='replaced':
        assert response.status_code==409 and auth.record(owner)[0]=='replacement'
    else:
        assert response.status_code==200 and response.json()['phase']=='disconnected'
        assert auth.record(owner) is None


def test_custom_ilias_origin_does_not_enable_shared_unibe_login(monkeypatch):
    monkeypatch.setattr(settings,'ilias_base_url','https://custom.example')
    with TestClient(app) as client:
        assert client.get('/api/auth/unibe/availability').json()=={'enabled':False,'usage_retention_days':None}
        assert client.post('/api/auth/unibe/start',headers={'X-Unisport-Session':'x'*43}).status_code==404


def test_affiliation_draft_is_bound_to_displayed_account_generation(monkeypatch):
    owner,state,data,headers=connection();calls=[]
    async def choices(*args):calls.append(True);return ['member@unibe.ch']
    monkeypatch.setattr(auth,'affiliations',choices)
    with TestClient(app) as client:
        rejected=client.put('/api/auth/unibe/affiliation',headers={**headers,'X-Unisport-Scope':'b'*64},json={'affiliation':'member@unibe.ch'})
        assert rejected.status_code==400 and calls==[]
        accepted=client.put('/api/auth/unibe/affiliation',headers={**headers,'X-Unisport-Scope':auth.digest(state+':'+data['subject'])},json={'affiliation':'member@unibe.ch'})
        assert accepted.status_code==200 and calls==[True]
