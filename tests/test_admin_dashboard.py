"""Administrator capabilities never reuse student authentication."""
import sqlite3
import time

from fastapi.testclient import TestClient
import pytest

from backend import admin_sessions
from backend.config import settings
from backend.main import app
from backend.observability import EventStore

KEY = 'private-operator-key-' + 'x' * 43
HEADERS = {'X-Admin-Request': '1'}


@pytest.fixture
def admin(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'admin_api_key', KEY)
    monkeypatch.setattr(settings, 'app_env', 'production')
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    monkeypatch.setattr(settings, 'observability_dir', str(tmp_path / 'events'))
    store = EventStore(tmp_path / 'events')
    monkeypatch.setattr('backend.observability.get_store', lambda: store)
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)
    client = TestClient(app, base_url='https://operator.test')
    yield client, store
    store.flush()
    store.close()


def login(client):
    return client.post('/api/admin/session', json={'key': KEY}, headers=HEADERS)


def test_browser_signin_cookie_scope_and_log_privacy(admin):
    client, store = admin
    response = login(client)
    assert response.status_code == 200
    assert response.json()['authenticated']
    assert KEY not in response.text
    cookie = response.headers['set-cookie']
    assert all(value in cookie for value in ('HttpOnly', 'Secure', 'SameSite=strict', 'Path=/api/admin', 'Max-Age=1800'))
    assert response.headers['cache-control'] == 'no-store'
    assert client.get('/api/admin/session').json()['authenticated']
    assert client.get('/api/admin/events').status_code == 200
    assert client.get('/api/admin/summary').json()['event_catalogue']['admin.login'] == 'audit'
    assert client.get('/api/dashboard').status_code != 200
    assert not client.get('/api/auth/status').json()['authenticated']
    token = client.cookies.get(admin_sessions.COOKIE)
    store.flush()
    assert KEY not in str(store.read())
    assert token not in str(store.read())
    database = settings.coordination_path / 'admin-sessions.sqlite3'
    assert KEY.encode() not in database.read_bytes()
    assert token.encode() not in database.read_bytes()


def test_logout_revokes_cookie_even_if_replayed(admin):
    client, _ = admin
    login(client)
    token = client.cookies.get(admin_sessions.COOKIE)
    response = client.delete('/api/admin/session', headers=HEADERS)
    assert response.status_code == 200
    client.cookies.set(admin_sessions.COOKIE, token)
    assert client.get('/api/admin/events').status_code == 404
    assert not client.get('/api/admin/session').json()['authenticated']


def test_expiration_and_key_rotation_invalidate_browser_session(admin, monkeypatch):
    client, _ = admin
    login(client)
    monkeypatch.setattr(settings, 'admin_api_key', KEY + '-rotated')
    assert client.get('/api/admin/summary').status_code == 404
    monkeypatch.setattr(settings, 'admin_api_key', KEY)
    with admin_sessions.database() as db:
        db.execute('UPDATE sessions SET expires=?', (time.time() - 1,))
    assert not client.get('/api/admin/session').json()['authenticated']
    assert client.get('/api/admin/summary').status_code == 404


def test_cross_site_forms_and_student_credentials_cannot_authorize(admin):
    client, _ = admin
    assert client.post('/api/admin/session', json={'key': KEY}).status_code == 403
    assert client.post('/api/admin/session', data={'key': KEY}).status_code in (403, 422)
    assert client.get('/api/admin/events', headers={'X-Session-Id': KEY}).status_code == 404
    client.cookies.set('betterilias_session', KEY)
    assert client.get('/api/admin/events').status_code == 404
    login(client)
    assert client.delete('/api/admin/session').status_code == 403
    assert client.get('/api/admin/events').status_code == 200
    # Explicit rejected credentials cannot fall back to ambient admin cookies.
    assert client.get('/api/admin/events', headers={'X-Admin-Key': 'wrong'}).status_code == 404


def test_disabled_access_and_failed_login_counter_are_bounded(admin, monkeypatch):
    client, _ = admin
    for _ in range(12):
        response = client.post('/api/admin/session', json={'key': 'wrong'}, headers=HEADERS)
    assert response.status_code == 429
    assert response.headers['retry-after'] == '60'
    with admin_sessions.database() as db:
        assert db.execute('SELECT count(*) FROM failures').fetchone()[0] == 10
    # An attacker cannot lock out an administrator who knows the valid key.
    assert login(client).status_code == 200
    monkeypatch.setattr(settings, 'admin_api_key', '')
    assert login(client).status_code == 404
    assert client.get('/api/admin/session').status_code == 404
    assert client.get('/api/admin/events').status_code == 404


def test_validation_never_echoes_admin_secret(admin):
    client, _ = admin
    response = client.post('/api/admin/session', json={'key': KEY * 20}, headers=HEADERS)
    assert response.status_code == 422
    assert KEY not in response.text


def test_many_valid_logins_keep_session_storage_bounded(admin):
    client, _ = admin
    for _ in range(35):
        assert login(client).status_code == 200
    with admin_sessions.database() as db:
        assert db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 32


def test_database_failure_does_not_issue_cookie(admin, monkeypatch):
    client, _ = admin
    def fail():
        raise sqlite3.OperationalError(KEY)
    monkeypatch.setattr(admin_sessions, 'issue', fail)
    response = login(client)
    assert response.status_code == 503
    assert 'set-cookie' not in response.headers
    assert KEY not in response.text
