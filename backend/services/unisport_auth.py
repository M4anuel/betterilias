"""Companion-assisted SWITCH prototype. No ILIAS credentials or refresh tokens.

Transactions and connections share the local coordination volume across workers.
Only hashes of browser capabilities are stored; provider tokens stay server-side.
"""
import base64
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from urllib.parse import urlencode, urlsplit, parse_qsl

import httpx
import jwt

from backend.config import settings
from backend.outbound_budget import OutboundBudget
from backend.outbound_network import EgressTransport
from backend.outbound_targets import TargetPolicy

ISSUER = 'https://login.eduid.ch/'
AUTHORIZE = ISSUER + 'idp/profile/oidc/authorize'
TOKEN = ISSUER + 'idp/profile/oidc/token'
JWKS = ISSUER + 'idp/profile/oidc/keyset'
CLIENT = 'unibe-campusapp'
CALLBACK = 'ch.unibe.campusapp://campusapp.unibe.ch'
UNIAPP = 'https://api.uniapp-backend.unibe.ch'
TTL = 600


class LoginError(Exception):
    """Never propagate provider bodies, codes, keys or claims to diagnostics."""


class CredentialRejected(LoginError):
    """The protected UniApp endpoint explicitly rejected these credentials."""


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def database():
    directory = settings.coordination_path / 'unisport'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / 'connections.sqlite3'
    # Create privately before SQLite opens it (including on first concurrent use).
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    db = sqlite3.connect(path, timeout=5)
    try:
        db.execute('PRAGMA secure_delete=ON')
        db.execute('CREATE TABLE IF NOT EXISTS connections (owner TEXT PRIMARY KEY, state TEXT, expires REAL, data TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS starts (identity TEXT PRIMARY KEY, since REAL, count INTEGER)')
        with db:
            yield db
    finally:
        db.close()


def start(owner, address):
    now = time.time()
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    data = dict(phase='pending', nonce=nonce, verifier=verifier)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM connections WHERE expires < ?', (now,))
        db.execute('DELETE FROM starts WHERE since < ?', (now - TTL,))
        identity = digest(address)
        count = db.execute('SELECT count FROM starts WHERE identity=?', (identity,)).fetchone()
        if (count and count[0] >= 10) or db.execute('SELECT count(*) FROM connections').fetchone()[0] >= 1000:
            raise LoginError()
        db.execute('INSERT INTO starts VALUES (?, ?, 1) ON CONFLICT(identity) DO UPDATE SET count=count+1', (identity, now))
        db.execute('INSERT OR REPLACE INTO connections VALUES (?, ?, ?, ?)', (owner, state, now + TTL, json.dumps(data)))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    url = AUTHORIZE + '?' + urlencode(dict(client_id=CLIENT, redirect_uri=CALLBACK, response_type='code',
        response_mode='form_post',
        scope='openid swissEduIDBase swissEduIDExtended profile email https://login.eduid.ch/authz/User.Read',
        state=state, nonce=nonce, code_challenge=challenge, code_challenge_method='S256', prompt='login'))
    return dict(authorization_url=url, state=state, expires_at=now + TTL)


def record(owner):
    with database() as db:
        row = db.execute('SELECT state, expires, data FROM connections WHERE owner=?', (owner,)).fetchone()
        if row and row[1] <= time.time():
            db.execute('DELETE FROM connections WHERE owner=?', (owner,))
            return None
    return (row[0], json.loads(row[2])) if row else None


def disconnect(owner):
    with database() as db:
        db.execute('DELETE FROM connections WHERE owner=?', (owner,))


async def provider_json(url, owner, *, method='GET', data=None, headers=None, transport=None):
    """Pinned origins, bounded bodies, no ambient cookies/proxies/redirects/retries."""
    origin = ISSUER.rstrip('/') if url.startswith(ISSUER) else UNIAPP
    policy = TargetPolicy(native_url=origin, media_origins=[], allow_local=False)
    permit = await OutboundBudget().acquire('unisport:' + owner)
    try:
        async with httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=transport),
                timeout=20, follow_redirects=False, trust_env=False) as client:
            async with client.stream(method, url, data=data, headers=headers) as response:
                if origin == UNIAPP and response.status_code in (401, 403):
                    raise CredentialRejected()
                if response.status_code != 200:
                    raise LoginError()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 1_000_000:
                        raise LoginError()
                return json.loads(body)
    except (httpx.HTTPError, ValueError, UnicodeError):
        raise LoginError() from None
    finally:
        await permit.close()


def validate_id_token(token, keys, nonce):
    try:
        if not isinstance(keys, dict) or not isinstance(keys.get('keys'), list) or any(not isinstance(key, dict) for key in keys['keys']):
            raise LoginError()
        header = jwt.get_unverified_header(token)
        if header.get('alg') != 'RS256' or any(k in header for k in ('jku', 'x5u', 'crit')) or not header.get('kid'):
            raise LoginError()
        candidates = [key for key in keys['keys'] if key.get('kid') == header['kid'] and key.get('kty') == 'RSA'
            and key.get('use', 'sig') == 'sig' and key.get('alg', 'RS256') == 'RS256'
            and 'verify' in key.get('key_ops', ['verify'])]
        if len(candidates) != 1:
            raise LoginError()
        key = jwt.PyJWK.from_dict(candidates[0], algorithm='RS256').key
        claims = jwt.decode(token, key, algorithms=['RS256'], issuer=ISSUER, audience=CLIENT, leeway=5,
            options={'require': ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce']})
        if not isinstance(claims['nonce'], str) or not hmac.compare_digest(claims['nonce'], nonce):
            raise LoginError()
        if not isinstance(claims['sub'], str) or not claims['sub'].strip():
            raise LoginError()
        if any(type(claims[k]) is not int for k in ('exp', 'iat')) or claims['exp'] <= claims['iat']:
            raise LoginError()
        if ('azp' in claims and claims['azp'] != CLIENT) or (isinstance(claims['aud'], list) and len(claims['aud']) > 1 and claims.get('azp') != CLIENT):
            raise LoginError()
        if 'auth_time' in claims and type(claims['auth_time']) is not int:
            raise LoginError()
        return claims
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise LoginError() from None


def callback_parameters(callback, expected_state):
    try:
        url = urlsplit(callback)
        if url.fragment or callback.split('?', 1)[0] != CALLBACK:
            raise LoginError()
        pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True, max_num_fields=16, errors='strict')
        values = dict(pairs)
        if len(values) != len(pairs) or not hmac.compare_digest(values.get('state', ''), expected_state):
            raise LoginError()
        if values.get('iss', ISSUER) != ISSUER or any(k in values for k in ('id_token', 'access_token')):
            raise LoginError()
        return values
    except (ValueError, UnicodeError, TypeError):
        raise LoginError() from None


async def complete(owner, callback):
    current = record(owner)
    if not current or current[1]['phase'] != 'pending':
        raise LoginError()
    state, data = current
    values = callback_parameters(callback, state)
    # Consume before dispatch. Never retry an uncertain code exchange.
    with database() as db:
        changed = db.execute('UPDATE connections SET data=? WHERE owner=? AND state=? AND data=? AND expires>?',
            (json.dumps(dict(phase='exchanging')), owner, state, json.dumps(data), time.time())).rowcount
    if not changed:
        raise LoginError()
    try:
        if 'error' in values or not values.get('code') or len(values['code']) > 8192:
            raise LoginError()
        tokens = await provider_json(TOKEN, owner, method='POST', data=dict(grant_type='authorization_code',
            client_id=CLIENT, redirect_uri=CALLBACK, code=values['code'], code_verifier=data['verifier']))
        token = tokens.get('id_token') if isinstance(tokens, dict) else None
        if not isinstance(token, str) or len(token) > 64000:
            raise LoginError()
        keys = await provider_json(JWKS, owner)
        claims = validate_id_token(token, keys, data['nonce'])
        name = claims.get('name')
        if not isinstance(name, str) or not name.strip():
            name = ' '.join(claims.get(key, '').strip() for key in ('given_name', 'family_name') if isinstance(claims.get(key), str))
        expires_at = min(claims['exp'], time.time() + 3600)
        connected = dict(phase='connected', token=token, subject=claims['sub'], affiliation=None,
            name=name.strip()[:300] or None, expires_at=expires_at)
        with database() as db:
            changed = db.execute('UPDATE connections SET data=?, expires=? WHERE owner=? AND state=? AND expires>?',
                (json.dumps(connected), expires_at, owner, state, time.time())).rowcount
        if not changed:
            raise LoginError()
    except LoginError:
        with database() as db:
            db.execute('DELETE FROM connections WHERE owner=? AND state=?', (owner, state))
        raise


async def affiliations(owner, data):
    result = await provider_json(UNIAPP + '/api/v3/auth/openid/affiliations', owner,
        headers={'Authorization': 'Bearer ' + data['token'], 'Accept': 'application/json'})
    if not isinstance(result, list) or len(result) > 100:
        raise LoginError()
    choices = []
    for item in result:
        value = item.get('affiliation') if isinstance(item, dict) else None
        if not isinstance(value, str) or not value.strip() or len(value) > 512 or any(c in value for c in '\r\n'):
            raise LoginError()
        if value not in choices:
            choices.append(value)
    return choices


async def select_affiliation(owner, choice, expected_scope=None):
    current = record(owner)
    if not current or current[1]['phase'] != 'connected':
        raise LoginError()
    state, data = current
    if expected_scope is not None and not hmac.compare_digest(expected_scope, digest(state + ':' + data['subject'])):
        raise LoginError()
    if choice not in await affiliations(owner, data):
        raise LoginError()
    updated = {**data, 'affiliation': choice}
    with database() as db:
        if not db.execute('UPDATE connections SET data=? WHERE owner=? AND state=? AND data=? AND expires>?',
            (json.dumps(updated), owner, state, json.dumps(data), time.time())).rowcount:
            raise LoginError()
