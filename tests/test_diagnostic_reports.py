"""Consent, minimisation, tenancy, bounded storage and maintainer workflow."""
import json
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

from backend import diagnostic_reports as reports
from backend.api.deps import get_session_manager
from backend.api.routes import diagnostics, admin
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.observability import DiagnosticMiddleware, EventStore, audit
from backend.scrapers.dumper import safe_parser

SECRET = 'Alice-Student-email-cookie-token-grade-6.0'
ADMIN = 'administrator-private-key-' + 'x' * 43
HTML = f'''<html><body><script>{SECRET}</script><style>{SECRET}</style><template>{SECRET}</template>
<table id="{SECRET}" class="ilTable {SECRET}"><tr data-name="{SECRET}"><td>{SECRET}</td>
<td><a href="https://private.invalid/?token={SECRET}">{SECRET}</a>
<input name="rtoken" value="{SECRET}" type="hidden"><input name="{SECRET}" value="{SECRET}" type="text">
<textarea>{SECRET}</textarea></td></tr></table></body></html>'''


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name, value in [('sessions_dir', str(tmp_path / 'sessions')), ('logs_dir', str(tmp_path / 'logs')),
                        ('coordination_dir', str(tmp_path / 'coordination')), ('diagnostic_reports_dir', str(tmp_path / 'reports')),
                        ('app_env', 'test'), ('admin_api_key', ADMIN), ('log_console_level', 'OFF')]:
        monkeypatch.setattr(settings, name, value)
    store = EventStore(tmp_path / 'events')
    monkeypatch.setattr('backend.observability.get_store', lambda: store)
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)
    for owner in ('alpha', 'beta'):
        SessionManager(owner).save_cookies({'PHPSESSID': SECRET})
    test = FastAPI(exception_handlers=app.exception_handlers)
    test.add_middleware(DiagnosticMiddleware)
    test.add_middleware(reports.ReportMiddleware)
    test.include_router(diagnostics.router, prefix='/api')
    test.include_router(admin.router, prefix='/api')

    @safe_parser('diagnostic_fixture')
    def broken(html):
        raise ValueError(SECRET)

    @test.get('/api/test/parse')
    def parse(manager=Depends(get_session_manager)):
        return broken(HTML)

    @test.get('/api/test/timeout')
    def timeout(manager=Depends(get_session_manager)):
        raise httpx.ReadTimeout(SECRET)

    @test.get('/api/test/crash')
    def crash(manager=Depends(get_session_manager)):
        raise RuntimeError(SECRET)

    @test.post('/api/test/partial')
    @audit('allocation')
    async def partial(manager=Depends(get_session_manager)):
        return {'success': False, 'failed_count': 2}

    client = TestClient(test, base_url='https://test.local')
    client.headers['X-Session-Id'] = 'alpha'
    yield client, store
    store.flush(); store.close()


def stage(client, name='parse'):
    response = client.get('/api/test/' + name)
    assert response.status_code >= 500
    return response, response.headers['x-diagnostic-capture']


def decide(client, capture, decision='once'):
    return client.post('/api/diagnostics/decision', json={'capture_id': capture, 'decision': decision})


def test_pending_evidence_is_text_free_and_declining_keeps_no_report(site):
    client, store = site
    response, capture = stage(client)
    assert response.headers['cache-control'] == 'no-store'
    assert reports.list_reports()['reports'] == []
    with reports.database() as db:
        row = db.execute('SELECT payload,owner,digest FROM captures').fetchone()
        assert SECRET not in row['payload']
        assert 'alpha' != row['owner']
        assert capture != row['digest']
        payload = json.loads(row['payload'])
    assert payload['parser'] == 'diagnostic_fixture'
    assert '<table class=ilTable>' in payload['structure']['outline']
    assert 'name=rtoken' in payload['structure']['outline']
    assert 'https:' not in payload['structure']['outline']
    assert 'value=' not in payload['structure']['outline']
    assert payload['request_id'] == response.headers['x-request-id']
    assert decide(client, capture, 'decline').json() == {'saved': False}
    assert reports.list_reports()['reports'] == []
    with reports.database() as db:
        assert db.execute('SELECT count(*) FROM captures').fetchone()[0] == 0
    store.flush()
    assert SECRET not in str(store.read())
    assert SECRET.encode() not in (settings.diagnostic_reports_path / 'reports.sqlite3').read_bytes()


def test_once_is_idempotent_and_cannot_be_claimed_by_another_tenant(site):
    client, _ = site
    _, capture = stage(client)
    client.headers['X-Session-Id'] = 'beta'
    assert decide(client, capture).status_code == 410
    client.headers['X-Session-Id'] = 'alpha'
    first = decide(client, capture).json()
    assert first['saved']
    assert decide(client, capture).json() == first
    assert len(reports.list_reports()['reports']) == 1
    assert reports.get_report(first['report_id'])['consent'] == 'once'
    assert reports.preference('alpha') == 'ask'
    assert reports.preference('beta') == 'ask'


def test_always_and_never_are_connection_scoped_and_can_be_withdrawn(site):
    client, _ = site
    _, capture = stage(client, 'timeout')
    assert decide(client, capture, 'always').status_code == 200
    response = client.get('/api/test/timeout')
    assert 'x-diagnostic-report' in response.headers
    assert reports.get_report(response.headers['x-diagnostic-report'])['consent'] == 'automatic'
    assert 'x-diagnostic-capture' not in response.headers
    assert reports.preference('beta') == 'ask'
    assert client.put('/api/diagnostics/preference', json={'mode': 'never'}).status_code == 200
    assert 'x-diagnostic-capture' not in client.get('/api/test/parse').headers
    assert client.delete('/api/diagnostics/reports').status_code == 200
    assert not reports.list_reports()['reports']
    # A fresh tenant defaults to asking, regardless of another tenant's refusal.
    client.headers['X-Session-Id'] = 'beta'
    assert 'x-diagnostic-capture' in client.get('/api/test/timeout').headers


def test_cookie_only_mutations_and_arbitrary_payloads_are_rejected(site):
    client, _ = site
    client.headers.pop('X-Session-Id')
    client.cookies.set('betterilias_session', 'alpha')
    assert client.put('/api/diagnostics/preference', json={'mode': 'always'}).status_code == 401
    assert client.post('/api/diagnostics/client-capture', json={'code': 'CLIENT_RENDER'}).status_code == 401
    client.headers['X-Session-Id'] = 'alpha'
    assert client.post('/api/diagnostics/client-capture', json={'code': 'CLIENT_RENDER', 'html': SECRET}).status_code == 422
    assert client.post('/api/diagnostics/client-capture', json={'code': SECRET}).status_code == 422


def test_decline_after_lost_always_acknowledgement_reverts_only_its_own_grant(site):
    client, _ = site
    _, capture = stage(client)
    assert decide(client, capture, 'always').status_code == 200
    assert reports.preference('alpha') == 'always'
    with reports.database() as db:
        db.execute('UPDATE captures SET expires=?', (time.time() - 1,))
    assert decide(client, capture, 'decline').status_code == 200
    assert reports.preference('alpha') == 'ask'
    assert reports.list_reports()['reports'] == []
    _, capture = stage(client)
    decide(client, capture, 'always')
    reports.preference('alpha', 'always')
    decide(client, capture, 'decline')
    assert reports.preference('alpha') == 'always'


def test_admin_grouping_archive_reopen_and_concurrency(site):
    client, store = site
    _, capture = stage(client)
    report_id = decide(client, capture).json()['report_id']
    assert client.get('/api/admin/reports').status_code == 404
    headers = {'X-Admin-Key': ADMIN}
    listing = client.get('/api/admin/reports?kind=parsing', headers=headers).json()
    assert listing['counts'] == [{'kind': 'parsing', 'state': 'open', 'count': 1}]
    detail = client.get('/api/admin/reports/' + report_id, headers=headers).json()
    assert 'owner' not in detail
    assert SECRET not in json.dumps(detail)
    assert detail['payload']['structure']['outline']
    path = '/api/admin/reports/' + report_id
    change = {'state': 'resolved', 'revision': 1}
    assert client.patch(path, headers=headers, json=change).status_code == 403
    headers['X-Admin-Request'] = '1'
    assert client.patch(path, headers=headers, json=change).status_code == 200
    assert client.patch(path, headers=headers, json=change).status_code == 409
    assert client.get('/api/admin/reports', headers=headers).json()['reports'] == []
    archive = client.get('/api/admin/reports?state=resolved', headers=headers).json()['reports']
    assert archive[0]['id'] == report_id
    assert archive[0]['resolved_at']
    assert client.patch(path, headers=headers, json={'state': 'open', 'revision': 2}).status_code == 200
    store.flush()
    assert SECRET not in str(store.read())


def test_production_requires_operator_disclosure(site, monkeypatch):
    client, _ = site
    monkeypatch.setattr(settings, 'app_env', 'production')
    assert 'x-diagnostic-capture' not in client.get('/api/test/parse').headers
    assert not client.get('/api/diagnostics/preference').json()['available']
    monkeypatch.setattr(settings, 'diagnostic_report_operator_name', 'Test controller')
    monkeypatch.setattr(settings, 'diagnostic_report_privacy_url', 'https://operator.test/privacy')
    assert client.get('/api/diagnostics/preference').json()['available']
    assert 'x-diagnostic-capture' in client.get('/api/test/parse').headers
    monkeypatch.setattr(settings, 'diagnostic_report_privacy_url', 'javascript:alert(1)')
    assert not reports.disclosure()['available']


def test_expired_pending_reports_and_preferences_are_pruned(site):
    client, _ = site
    _, capture = stage(client)
    with reports.database() as db:
        db.execute('UPDATE captures SET expires=?', (time.time() - 1,))
    assert decide(client, capture).status_code == 410
    reports.preference('alpha', 'always')
    with reports.database() as db:
        db.execute('UPDATE preferences SET expires=?', (time.time() - 1,))
    assert reports.preference('alpha') == 'ask'
    _, capture = stage(client, 'timeout')
    report_id = decide(client, capture).json()['report_id']
    with reports.database() as db:
        db.execute('UPDATE reports SET created=?', (time.time() - 31 * 86400,))
    assert reports.get_report(report_id) is None


def test_a_new_policy_requires_fresh_consent(site, monkeypatch):
    client, _ = site
    _, earlier = stage(client)
    reports.preference('alpha', 'always')
    reports.preference('beta', 'never')
    monkeypatch.setattr(reports, 'POLICY', reports.POLICY + 1)
    assert decide(client, earlier).status_code == 410
    assert reports.preference('alpha') == 'ask'
    assert reports.preference('beta') == 'never'
    assert 'x-diagnostic-capture' in client.get('/api/test/timeout').headers


def test_unhandled_errors_remain_generic_and_offer_owned_metadata_report(site):
    client, _ = site
    response, capture = stage(client, 'crash')
    assert response.status_code == 500
    assert SECRET not in response.text
    report_id = decide(client, capture).json()['report_id']
    assert reports.get_report(report_id)['code'] == 'INTERNAL_ERROR'


def test_reported_partial_write_result_is_reportable_even_with_http_200(site):
    client, _ = site
    response = client.post('/api/test/partial')
    assert response.status_code == 200
    report_id = decide(client, response.headers['x-diagnostic-capture']).json()['report_id']
    payload = reports.get_report(report_id)['payload']
    assert payload['code'] == 'WRITE_INCOMPLETE'
    assert payload['operation'] == 'allocation'
    assert payload['outcome'] == 'partial'


def test_storage_failure_never_replaces_the_original_error(site, monkeypatch):
    client, _ = site
    def fail(*args, **kwargs):
        raise RuntimeError(SECRET)
    monkeypatch.setattr(reports, 'prepare', fail)
    response = client.get('/api/test/timeout')
    assert response.status_code == 504
    assert 'x-diagnostic-capture' not in response.headers
    assert SECRET not in response.text


def test_structural_capture_bounds_and_secret_elimination():
    outline = reports.structural_outline(HTML * 1000)
    assert len(outline['outline']) <= 20000
    assert outline['nodes'] <= 1000
    assert outline['limited']
    assert SECRET not in json.dumps(outline)


def test_parallel_consent_is_single_use_and_retention_is_bounded(site, monkeypatch):
    client, _ = site
    _, capture = stage(client)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: reports.decide('alpha', capture, 'once'), range(4)))
    assert len({result['report_id'] for result in results}) == 1
    monkeypatch.setattr(settings, 'diagnostic_reports_max_count', 2)
    for owner in ('one', 'two', 'three'):
        prepared = reports.prepare(owner, 'CLIENT_RENDER')
        reports.decide(owner, prepared['capture_id'], 'once')
    assert len(reports.list_reports()['reports']) == 2
