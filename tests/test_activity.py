"""Connection counts, retention, secret exclusion and authentication boundaries."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import activity
from backend.api.deps import get_optional_session_manager
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app


@pytest.fixture
def clock(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'observability_dir', str(tmp_path / 'metrics'))
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path / 'sessions'))
    now = [2000000000.0]
    monkeypatch.setattr(activity.time, 'time', lambda: now[0])
    return now


def test_distinct_connections_rolling_windows_and_secret_exclusion(clock):
    secret = 'private-session-credential-do-not-store'
    activity.record(secret)
    clock[0] += 60
    activity.record(secret)
    activity.record('other-connection')
    result = activity.summary()
    assert result['active'] == result['last_24_hours'] == 2
    assert len(result['recent']) == 12 and len(result['hourly']) == 24
    assert result['recent'][-1]['count'] == 2
    clock[0] += 301
    activity.record(secret)
    result = activity.summary()
    assert result['active'] == 1 and result['last_24_hours'] == 2
    assert sum(bucket['count'] for bucket in result['recent']) > result['last_24_hours']
    path = settings.observability_path / 'activity.sqlite3'
    assert secret.encode() not in path.read_bytes()
    with activity.database() as db:
        assert len(db.execute('SELECT DISTINCT owner FROM activity').fetchone()[0]) == 64
    clock[0] += 86400
    assert activity.summary()['last_24_hours'] == 0
    with activity.database() as db:
        assert db.execute('SELECT count(*) FROM activity').fetchone()[0] == 0


def test_shared_store_concurrency_and_row_bound(clock, monkeypatch):
    monkeypatch.setattr(activity, 'MAX_ROWS', 10)
    # Initialise once, then simulate independent worker connections.
    activity.summary()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(activity.record, ['same-connection'] * 12))
    assert activity.summary()['last_24_hours'] == 1
    for index in range(20):
        activity.record(f'connection-{index}')
    assert activity.summary()['last_24_hours'] == 10


def test_only_valid_authenticated_app_requests_count(clock):
    test = FastAPI()

    def endpoint(manager=Depends(get_optional_session_manager)):
        return {'authenticated': manager is not None}

    for path in ('/api/content', '/api/auth/status', '/api/diagnostics/preference', '/api/admin/example'):
        test.add_api_route(path, endpoint, methods=['GET', 'POST'])
    client = TestClient(test)
    SessionManager('valid-connection').save_cookies({'PHPSESSID': 'not-a-live-cookie'})
    for path in ('/api/auth/status', '/api/diagnostics/preference', '/api/admin/example'):
        assert client.get(path, headers={'X-Session-Id': 'valid-connection'}).json()['authenticated']
    assert not client.get('/api/content').json()['authenticated']
    assert not client.get('/api/content', headers={'X-Session-Id': 'unknown'}).json()['authenticated']
    client.cookies.set('betterilias_session', 'valid-connection')
    assert not client.post('/api/content').json()['authenticated']
    assert activity.summary()['last_24_hours'] == 0
    assert client.get('/api/content').json()['authenticated']
    assert activity.summary()['active'] == 1


def test_activity_failure_does_not_fail_student_requests(clock, monkeypatch):
    def unavailable():
        raise sqlite3.OperationalError('unavailable')
    monkeypatch.setattr(activity, 'database', unavailable)
    activity.record('private-credential')


def test_browser_counts_survive_reconnection_and_separate_browser_profiles(clock):
    browser = '12345678-1234-4234-8234-123456789abc'
    other = '12345678-1234-4234-8234-123456789abd'
    activity.record('first-connection', browser)
    activity.record('reconnected', browser)
    result = activity.summary()
    assert result['last_24_hours'] == 2
    assert result['browsers']['last_24_hours'] == 1
    activity.record('reconnected', other)
    activity.record('reconnected', 'not-a-browser-uuid')
    assert activity.summary()['browsers']['active'] == 2
    assert browser.encode() not in (settings.observability_path / 'activity.sqlite3').read_bytes()
    assert browser not in str(activity.summary())
    clock[0] += 86400
    assert activity.summary()['browsers']['last_24_hours'] == 0


def test_existing_activity_database_is_migrated_without_losing_counts(clock):
    path = settings.observability_path / 'activity.sqlite3'
    path.parent.mkdir(parents=True)
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE activity (minute INTEGER, owner TEXT, seen REAL, PRIMARY KEY(minute,owner))')
        db.execute('INSERT INTO activity VALUES(?,?,?)', (int(clock[0] // 60), 'legacy-hash', clock[0]))
    assert activity.summary()['active'] == 1
    assert activity.summary()['browsers']['active'] == 0


def test_admin_without_trailing_slash_redirects():
    response = TestClient(app).get('/admin', follow_redirects=False)
    assert response.status_code == 308 and response.headers['location'] == '/admin/'
