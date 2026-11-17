"""Tests for self-hosted distribution error reporting and upstream sharing."""
import json
from unittest.mock import AsyncMock, patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import diagnostic_reports as reports
from backend.api.deps import get_session_manager
from backend.api.routes import diagnostics, admin
from backend.auth.session import SessionManager
from backend.config import settings
from backend.diagnostic_metadata import APP_VERSION, release
from backend.main import app
from backend.observability import DiagnosticMiddleware, EventStore

ADMIN = 'administrator-private-key-' + 'x' * 43


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name, value in [
        ('sessions_dir', str(tmp_path / 'sessions')),
        ('logs_dir', str(tmp_path / 'logs')),
        ('coordination_dir', str(tmp_path / 'coordination')),
        ('diagnostic_reports_dir', str(tmp_path / 'reports')),
        ('app_env', 'test'),
        ('admin_api_key', ADMIN),
        ('log_console_level', 'OFF'),
        ('self_hosted', True),
        ('allow_upstream_error_sharing', True),
        ('upstream_report_url', 'https://betterilias.ch/api/diagnostics/upstream-report'),
    ]:
        monkeypatch.setattr(settings, name, value)
    store = EventStore(tmp_path / 'events')
    monkeypatch.setattr(settings, 'observability_dir', str(tmp_path / 'events'))
    monkeypatch.setattr('backend.observability.get_store', lambda: store)
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)

    SessionManager('tester').save_cookies({'PHPSESSID': 'test-cookie'})

    test = FastAPI(exception_handlers=app.exception_handlers)
    test.add_middleware(DiagnosticMiddleware)
    test.add_middleware(reports.ReportMiddleware)
    test.include_router(diagnostics.router, prefix='/api')
    test.include_router(admin.router, prefix='/api')

    client = TestClient(test, base_url='https://test.local')
    client.headers['X-Session-Id'] = 'tester'
    yield client, store


def test_disclosure_contains_self_hosted_and_version(site):
    client, _ = site
    res = client.get('/api/diagnostics/preference')
    assert res.status_code == 200
    data = res.json()
    assert data['self_hosted'] is True
    assert data['app_version'] == APP_VERSION
    assert 'build' in data
    assert data['can_share_upstream'] is True
    assert data['upstream_url'] == 'https://betterilias.ch/api/diagnostics/upstream-report'


def test_upstream_report_ingestion_and_tagging(site):
    client, _ = site

    # External self-hosted instance sends an error report to betterilias.ch
    upstream_payload = {
        'code': 'PARSING_FAILED',
        'status': 500,
        'app_version': '1.0.4',
        'build': 'backend-custom123',
        'distribution': 'self-hosted',
        'instance_origin': 'https://ilias.custom-uni.ch',
        'operation': 'catalog_fetch',
        'outcome': 'parse_failed',
        'parser': 'courses',
        'structure': {
            'outline': '<main class="ilTable">\n  <div class="row"></div>\n</main>',
            'nodes': 2,
            'limited': False,
        },
    }

    res = client.post('/api/diagnostics/upstream-report', json=upstream_payload)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data['received'] is True
    report_id = res_data['report_id']
    assert len(report_id) == 32

    # Admin checks reports segmented by distribution
    admin_headers = {'X-Admin-Key': ADMIN}

    # 1. Self-hosted partition contains the report with metadata
    res_self_hosted = client.get('/api/admin/reports?distribution=self-hosted', headers=admin_headers)
    assert res_self_hosted.status_code == 200
    self_hosted_data = res_self_hosted.json()
    assert len(self_hosted_data['reports']) == 1
    r = self_hosted_data['reports'][0]
    assert r['id'] == report_id
    assert r['distribution'] == 'self-hosted'
    assert r['app_version'] == '1.0.4'
    assert r['build'] == 'backend-custom123'
    assert r['source'] == 'https://ilias.custom-uni.ch'
    assert '1.0.4' in self_hosted_data['versions']

    # 2. Local partition does NOT contain the self-hosted report
    res_local = client.get('/api/admin/reports?distribution=local', headers=admin_headers)
    assert res_local.status_code == 200
    assert len(res_local.json()['reports']) == 0

    # 3. Filtering by specific version
    res_v104 = client.get('/api/admin/reports?app_version=1.0.4', headers=admin_headers)
    assert len(res_v104.json()['reports']) == 1

    res_v999 = client.get('/api/admin/reports?app_version=9.9.9', headers=admin_headers)
    assert len(res_v999.json()['reports']) == 0

    # 4. Detail endpoint returns all self-hosted metadata
    res_detail = client.get(f'/api/admin/reports/{report_id}', headers=admin_headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail['distribution'] == 'self-hosted'
    assert detail['app_version'] == '1.0.4'
    assert detail['build'] == 'backend-custom123'
    assert detail['payload']['structure']['nodes'] == 2


def test_upstream_report_validation(site):
    client, _ = site

    # Unknown code
    res = client.post(
        '/api/diagnostics/upstream-report',
        json={
            'code': 'INVALID_CODE_XYZ',
            'status': 500,
            'app_version': '1.0.0',
            'distribution': 'self-hosted',
        },
    )
    assert res.status_code == 422

    # Invalid distribution (must be 'self-hosted')
    res = client.post(
        '/api/diagnostics/upstream-report',
        json={
            'code': 'PARSING_FAILED',
            'status': 500,
            'app_version': '1.0.0',
            'distribution': 'invalid-dist',
        },
    )
    assert res.status_code == 422


def test_forward_report_upstream(site):
    client, _ = site

    # Create a local report via client capture and decision
    cap_res = client.post('/api/diagnostics/client-capture', json={'code': 'CLIENT_RENDER'})
    assert cap_res.status_code == 200
    capture_id = cap_res.json()['capture_id']

    # Mock httpx AsyncClient.post for forwarding
    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: {'received': True, 'report_id': 'upstream1234567890abcdef12345678'}

    with patch('httpx.AsyncClient.post', return_value=mock_response) as mock_post:
        # Decide with share_upstream=True
        dec_res = client.post(
            '/api/diagnostics/decision',
            json={'capture_id': capture_id, 'decision': 'once', 'share_upstream': True},
        )
        assert dec_res.status_code == 200
        data = dec_res.json()
        assert data['saved'] is True
        assert data['upstream_shared'] is True

        # Verify httpx was called with expected self-hosted distribution metadata
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        forwarded_json = kwargs['json']
        assert forwarded_json['code'] == 'CLIENT_RENDER'
        assert forwarded_json['distribution'] == 'self-hosted'
        assert forwarded_json['app_version'] == APP_VERSION
        assert 'build' in forwarded_json


def test_admin_forward_report_upstream(site):
    client, _ = site

    # Create local report
    cap_res = client.post('/api/diagnostics/client-capture', json={'code': 'CLIENT_RENDER'})
    capture_id = cap_res.json()['capture_id']
    dec_res = client.post('/api/diagnostics/decision', json={'capture_id': capture_id, 'decision': 'once'})
    report_id = dec_res.json()['report_id']

    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: {'received': True, 'report_id': 'upstream999'}

    with patch('httpx.AsyncClient.post', return_value=mock_response):
        admin_headers = {'X-Admin-Key': ADMIN, 'X-Admin-Request': '1'}
        res = client.post(f'/api/admin/reports/{report_id}/share-upstream', headers=admin_headers)
        assert res.status_code == 200
        assert res.json()['shared'] is True
