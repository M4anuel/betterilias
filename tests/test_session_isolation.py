"""No live ILIAS traffic: exercise the real auth dependencies and shared store."""
import asyncio
import multiprocessing
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.auth.session import SessionManager
from backend.config import settings
from backend.coordination import SharedLock, claim_handoff, issue_handoff, CoordinationBusy
from backend.main import app
from backend.schemas import AuthStatus
from backend.services.ilias_client import IliasClient


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path / 'sessions'))
    monkeypatch.setattr(settings, 'session_cookie_file', str(tmp_path / 'legacy.json'))
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    for sid in ('alice', 'bob', None):
        SessionManager(sid).save_cookies({'PHPSESSID': sid or 'legacy'})
    return TestClient(app)


@pytest.mark.parametrize('credentials', [{}, {'params': {'session_id': 'alice'}},
    {'headers': {'X-Session-Id': 'unknown'}}, {'headers': {'X-Session-Id': 'default'}},
    {'headers': {'X-Session-Id': '../alice'}}, {'headers': {'X-Session-Id': 'ali.ce'}},
    {'headers': {'X-Session-Id': 'a' * 257}}])
def test_no_default_latest_query_or_sanitized_alias(isolated, credentials):
    assert isolated.get('/api/calendar', **credentials).status_code == 401
    assert isolated.get('/api/auth/status', **credentials).json()['authenticated'] is False


def test_cookie_native_get_and_explicit_header_precedence(isolated, monkeypatch):
    async def fake_status(self):
        return AuthStatus(authenticated=True, cookies_present=True, user_name=self.session_manager.session_id)
    monkeypatch.setattr(IliasClient, 'get_auth_status', fake_status)
    isolated.cookies.set('betterilias_session', 'alice')
    result = isolated.get('/api/auth/status', headers={'X-Session-Id': 'bob'})
    assert result.json()['user_name'] == 'bob'
    cookie = result.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'Secure' in cookie and 'SameSite=strict' in cookie
    assert isolated.post('/api/auth/logout').status_code == 401  # Cookie-only mutation / CSRF.
    assert isolated.get('/api/calendar', headers={'X-Session-Id': 'unknown'}).status_code == 401


def test_logout_only_revokes_its_own_tenant(isolated):
    assert isolated.post('/api/auth/logout', headers={'X-Session-Id': 'alice'}).status_code == 200
    assert not SessionManager('alice').has_cookies()
    assert SessionManager('bob').has_cookies()
    assert isolated.get('/api/calendar', headers={'X-Session-Id': 'alice'}).status_code == 401


@pytest.mark.parametrize('value', ['../bob/import', '..\\bob\\import', '/absolute', '', 'a' * 129])
def test_feedback_staging_cannot_escape_tenant(isolated, value):
    response = isolated.post('/api/exercises/42/assignments/55/feedback-import/commit',
        headers={'X-Session-Id': 'alice'}, json={'staged_import_id': value, 'snapshot_token': 'unused'})
    assert response.status_code == 422


def test_sync_verifies_before_replacing_and_does_not_copy_default(isolated, monkeypatch):
    verify = AsyncMock(return_value=(True, 'Alice'))
    monkeypatch.setattr(SessionManager, 'verify_session', verify)
    response = isolated.post('/api/auth/sync', json={'cookies': {'PHPSESSID': 'new'}, 'session_id': '../bob'})
    sid = response.json()['session_id']
    assert sid not in ('alice', 'bob', 'default', '../bob')
    assert SessionManager(sid).load_cookies()['PHPSESSID'] == 'new'
    assert SessionManager('bob').load_cookies()['PHPSESSID'] == 'bob'
    assert SessionManager().load_cookies()['PHPSESSID'] == 'legacy'
    verify.return_value = (False, 'expired')
    failed = isolated.post('/api/auth/sync', json={'cookies': {'PHPSESSID': 'bad'}, 'session_id': sid})
    assert failed.json()['authenticated'] is False
    assert SessionManager(sid).load_cookies()['PHPSESSID'] == 'new'


def test_sync_account_change_rotates_capability(isolated, monkeypatch):
    SessionManager('alice').save_metadata({'user_name': 'Alice'})
    monkeypatch.setattr(SessionManager, 'verify_session', AsyncMock(return_value=(True, 'Bob')))
    result = isolated.post('/api/auth/sync', json={'cookies': {'PHPSESSID': 'bob-new'}, 'session_id': 'alice'})
    assert result.json()['session_id'] != 'alice'
    assert SessionManager('alice').load_cookies()['PHPSESSID'] == 'alice'


def test_handoff_expiry_revocation_and_atomic_replay(isolated):
    assert claim_handoff(issue_handoff('alice', ttl=-1)) is None
    token = issue_handoff('alice')
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(claim_handoff, [token] * 8))
    assert results.count('alice') == 1
    assert results.count(None) == 7
    token = issue_handoff('alice')
    SessionManager('alice').clear_session()
    assert isolated.post('/api/auth/claim', json={'token': token}).status_code == 401


@pytest.mark.parametrize('environment', ['production', 'test'])
def test_maintenance_is_dev_only(isolated, monkeypatch, environment):
    monkeypatch.setattr(settings, 'app_env', environment)
    assert isolated.get('/api/system/logs', headers={'X-Session-Id': 'alice'}).status_code == 404
    assert isolated.get('/api/system/logs/example/raw').status_code == 404
    assert isolated.delete('/api/system/logs/example').status_code == 404
    monkeypatch.setattr(settings, 'app_env', 'development')
    monkeypatch.setattr('backend.api.routes.system.list_failed_dumps', lambda: [])
    assert isolated.get('/api/system/logs').status_code == 200


def _calendar_process(root, queue):
    """Independent spawned workers, each with its own imported app/service."""
    from pathlib import Path
    from backend.services.calendar_service import CalendarService
    from backend.schemas import CourseScheduleRuleInput
    settings.coordination_dir = str(Path(root) / 'coordination')
    service = CalendarService(Path(root) / 'calendar')
    rule = CourseScheduleRuleInput(course_ref_id='42', title='Lecture', semester='HS2026', weekdays=[0],
        start_time='10:00', end_time='11:00', start_date='2026-09-14', end_date='2026-09-21')
    for _ in range(3):
        service.create_rule('alice', rule)
    queue.put(True)


def test_calendar_updates_survive_separate_processes(tmp_path):
    ctx = multiprocessing.get_context('spawn')
    queue = ctx.Queue()
    workers = [ctx.Process(target=_calendar_process, args=(str(tmp_path), queue)) for _ in range(3)]
    for worker in workers:
        worker.start()
    try:
        for worker in workers:
            worker.join(30)
            assert worker.exitcode == 0
        from backend.services.calendar_service import CalendarService
        assert len(CalendarService(tmp_path / 'calendar')._load_tenant_state('alice')['rules']) == 9
    finally:
        for worker in workers:
            if worker.is_alive():
                worker.terminate()
                worker.join()
        queue.close()


@pytest.mark.asyncio
async def test_lock_contention_does_not_block_loop_or_survive_cancel(isolated):
    async with SharedLock('same').async_():
        async def contender():
            with pytest.raises(CoordinationBusy):
                with SharedLock('same').sync():
                    pass
        await asyncio.wait_for(asyncio.create_task(contender()), 1)
        async def waiting():
            async with SharedLock('same').async_():
                pass
        task = asyncio.create_task(waiting())
        await asyncio.sleep(.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    async with SharedLock('same').async_():
        pass
