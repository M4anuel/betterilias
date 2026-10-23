from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client, get_session_manager
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.schemas import AuthStatus


def test_mobile_session_reuses_current_tenant_key(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path))
    manager = SessionManager(session_id='desktop-test-key')
    manager.save_cookies({'PHPSESSID': 'dummy-cookie'})
    before = manager.cookie_file.read_bytes()
    service = AsyncMock()
    service.get_auth_status.return_value = AuthStatus(authenticated=True, cookies_present=True)
    app.dependency_overrides[get_session_manager] = lambda: manager
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        response = TestClient(app).post('/api/auth/mobile-session')
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        assert response.json() == {'session_id': 'desktop-test-key'}
        assert manager.cookie_file.read_bytes() == before
        assert len(list(tmp_path.glob('*.json'))) == 1
    finally:
        app.dependency_overrides.pop(get_session_manager, None)
        app.dependency_overrides.pop(get_ilias_client, None)


def test_legacy_desktop_session_gets_a_shareable_key(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path / 'tenants'))
    manager = SessionManager(cookie_file=tmp_path / 'legacy.json')
    manager.save_cookies({'PHPSESSID': 'dummy-cookie', 'ilClientId': 'ilias3_unibe'}, metadata={'user_name': 'Test user'})
    service = AsyncMock()
    service.get_auth_status.return_value = AuthStatus(authenticated=True, cookies_present=True)
    app.dependency_overrides[get_session_manager] = lambda: manager
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        response = TestClient(app).post('/api/auth/mobile-session')
        assert response.status_code == 200
        session_id = response.json()['session_id']
        assert session_id != 'default' and len(session_id) >= 32
        transferred = SessionManager(session_id=session_id)
        assert transferred.load_cookies() == manager.load_cookies()
        assert transferred.load_metadata()['user_name'] == 'Test user'
        assert set(response.json()) == {'session_id'}
    finally:
        app.dependency_overrides.pop(get_session_manager, None)
        app.dependency_overrides.pop(get_ilias_client, None)


def test_expired_session_cannot_be_shared(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path))
    manager = SessionManager(session_id='expired-test-key')
    service = AsyncMock()
    service.get_auth_status.return_value = AuthStatus(authenticated=False, cookies_present=False)
    app.dependency_overrides[get_session_manager] = lambda: manager
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        response = TestClient(app).post('/api/auth/mobile-session')
        assert response.status_code == 401
        assert 'session_id' not in response.json()
        assert list(tmp_path.glob('*.json')) == []
    finally:
        app.dependency_overrides.pop(get_session_manager, None)
        app.dependency_overrides.pop(get_ilias_client, None)
