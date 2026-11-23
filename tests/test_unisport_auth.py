"""Synthetic signed tokens only. Never logs in to SWITCH or uses a real account."""
import asyncio
import base64
import hashlib
import json
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlsplit

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
import jwt
import pytest

from backend.config import settings
from backend.main import app
from backend.services import unisport_auth as auth


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    monkeypatch.setattr(settings, 'unisport_enabled', True)


@pytest.fixture
def signing():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid='test', use='sig', alg='RS256')
    def sign(expected_nonce, **changes):
        claims = dict(iss=auth.ISSUER, sub='synthetic-account', aud=auth.CLIENT,
            exp=int(time.time()) + 900, iat=int(time.time()), nonce=expected_nonce)
        claims.update(changes)
        return jwt.encode(claims, key, algorithm='RS256', headers={'kid': 'test'})
    return sign, {'keys': [jwk]}


def begin(owner='owner'):
    transaction = auth.start(owner, 'synthetic-ip')
    return transaction, auth.record(owner)[1]


def callback(state, **fields):
    return auth.CALLBACK + '?' + urlencode(dict(state=state, code='synthetic-code', **fields))


def test_start_is_pkce_bound_private_and_independent():
    first, data = begin()
    second, other = begin('other')
    params = parse_qs(urlsplit(first['authorization_url']).query)
    assert params['redirect_uri'] == [auth.CALLBACK]
    assert params['client_id'] == [auth.CLIENT]
    assert params['code_challenge_method'] == ['S256']
    assert params['response_mode'] == ['form_post']
    challenge = base64.urlsafe_b64encode(hashlib.sha256(data['verifier'].encode()).digest()).decode().rstrip('=')
    assert params['code_challenge'] == [challenge]
    assert 'verifier' not in first and 'offline_access' not in params['scope'][0]
    assert data['nonce'] != other['nonce'] and first['state'] != second['state']


@pytest.mark.parametrize('changes', [
    {'iss': 'https://other.example/'}, {'aud': 'other'}, {'nonce': 'other'},
    {'exp': 1}, {'iat': int(time.time()) + 900}, {'sub': ''}, {'sub': None},
    {'exp': '9999999999'}, {'iat': True}, {'azp': 'other'},
    {'aud': [auth.CLIENT, 'other']}, {'auth_time': 'yesterday'},
])
def test_id_token_rejects_invalid_claims(signing, changes):
    sign, keys = signing
    with pytest.raises(auth.LoginError):
        auth.validate_id_token(sign('nonce', **changes), keys, 'nonce')


def test_id_token_requires_matching_key_and_pinned_algorithm(signing):
    sign, keys = signing
    token = sign('nonce')
    assert auth.validate_id_token(token, keys, 'nonce')['sub'] == 'synthetic-account'
    for invalid in ({'keys': []}, {'keys': keys['keys'] * 2}, {'keys': [None]}, [], {'keys': [{**keys['keys'][0], 'use': 'enc'}]}):
        with pytest.raises(auth.LoginError):
            auth.validate_id_token(token, invalid, 'nonce')
    with pytest.raises(auth.LoginError):
        auth.validate_id_token(jwt.encode({'nonce': 'nonce'}, 'x' * 64, algorithm='HS256'), keys, 'nonce')


@pytest.mark.parametrize('make', [
    lambda s: callback('wrong'), lambda s: callback(s) + '&state=' + s,
    lambda s: callback(s) + '#fragment', lambda s: callback(s).replace(auth.CALLBACK, auth.CALLBACK + '/'),
    lambda s: callback(s, iss='https://other.example/'), lambda s: callback(s, id_token='injected'),
    lambda s: callback(s).replace(s, '%C3%A4'),
])
@pytest.mark.asyncio
async def test_bad_callbacks_do_not_dispatch_or_consume(monkeypatch, make):
    tx, _ = begin()
    async def forbidden(*args, **kwargs):
        pytest.fail('Bad callbacks must never dispatch')
    monkeypatch.setattr(auth, 'provider_json', forbidden)
    with pytest.raises(auth.LoginError):
        await auth.complete('owner', make(tx['state']))
    assert auth.record('owner')[1]['phase'] == 'pending'


@pytest.mark.asyncio
async def test_complete_and_affiliation_are_verified_no_refresh_saved(signing, monkeypatch):
    tx, data = begin()
    sign, keys = signing
    token = sign(data['nonce'])
    calls = []
    async def provider(url, owner, **kwargs):
        calls.append((url, owner, kwargs))
        if url == auth.TOKEN:
            assert kwargs['data']['code_verifier'] == data['verifier']
            return dict(id_token=token, refresh_token='must-not-be-stored')
        if url == auth.JWKS: return keys
        assert kwargs['headers'] == {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
        return [{'affiliation': 'student@example.edu'}, {'affiliation': 'staff@example.edu'}]
    monkeypatch.setattr(auth, 'provider_json', provider)
    await auth.complete('owner', callback(tx['state']))
    connected = auth.record('owner')[1]
    assert connected['phase'] == 'connected' and connected['affiliation'] is None
    assert connected['subject'] == 'synthetic-account'
    assert 'refresh' not in json.dumps(connected) and 'verifier' not in connected
    with pytest.raises(auth.LoginError): await auth.complete('owner', callback(tx['state']))
    with pytest.raises(auth.LoginError): await auth.select_affiliation('owner', 'invented')
    await auth.select_affiliation('owner', 'student@example.edu')
    assert auth.record('owner')[1]['affiliation'] == 'student@example.edu'
    assert len([call for call in calls if call[0] == auth.TOKEN]) == 1
    assert auth.record('other') is None


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['disconnect', 'replace', 'duplicate'])
async def test_inflight_exchange_cannot_resurrect_or_overwrite(signing, monkeypatch, action):
    tx, data = begin(); sign, keys = signing
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []
    async def provider(url, owner, **kwargs):
        calls.append(url)
        if url == auth.TOKEN:
            entered.set(); await release.wait()
            return {'id_token': sign(data['nonce'])}
        return keys
    monkeypatch.setattr(auth, 'provider_json', provider)
    task = asyncio.create_task(auth.complete('owner', callback(tx['state'])))
    await entered.wait()
    if action == 'disconnect': auth.disconnect('owner')
    elif action == 'replace': begin()
    else:
        with pytest.raises(auth.LoginError): await auth.complete('owner', callback(tx['state']))
    release.set()
    if action == 'duplicate':
        await task
        assert auth.record('owner')[1]['phase'] == 'connected'
    else:
        with pytest.raises(auth.LoginError): await task
        current = auth.record('owner')
        assert current is None if action == 'disconnect' else current[1]['phase'] == 'pending'
    assert calls.count(auth.TOKEN) == 1


@pytest.mark.asyncio
async def test_uncertain_exchange_requires_new_login(monkeypatch):
    tx, _ = begin(); calls = []
    async def provider(*args, **kwargs):
        calls.append(1); raise auth.LoginError()
    monkeypatch.setattr(auth, 'provider_json', provider)
    for _ in range(2):
        with pytest.raises(auth.LoginError): await auth.complete('owner', callback(tx['state']))
    assert calls == [1] and auth.record('owner') is None


def test_expiry_and_start_rate_limit(monkeypatch):
    begin()
    now = time.time()
    monkeypatch.setattr(auth.time, 'time', lambda: now + 601)
    assert auth.record('owner') is None
    for _ in range(10): begin()
    with pytest.raises(auth.LoginError): begin()


def test_http_api_separate_capabilities_flag_and_no_secrets():
    client = TestClient(app)
    credential = secrets.token_urlsafe(32)
    headers = {'X-Unisport-Session': credential}
    for path in ('/connection', '/affiliations', '/applications'):
        assert client.get('/api/unisport' + path, headers={'X-Session-Id': credential}).status_code == 401
    response = client.post('/api/unisport/auth/start', headers=headers)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    state = response.json()['state']
    status = client.get('/api/unisport/connection', headers=headers).json()
    assert status == {'phase': 'pending', 'affiliation': None}
    assert state not in json.dumps(status) and 'verifier' not in json.dumps(status)
    assert client.get('/api/unisport/connection', headers={'X-Unisport-Session': secrets.token_urlsafe(32)}).json()['phase'] == 'disconnected'
    assert client.post('/api/unisport/auth/complete', headers=headers, json={'callback': callback('wrong')}).status_code == 400
    assert client.delete('/api/unisport/connection', headers=headers).status_code == 200
    assert client.get('/api/unisport/applications', headers=headers).status_code == 401
    settings.unisport_enabled = False
    assert client.post('/api/unisport/auth/start', headers=headers).status_code == 404
