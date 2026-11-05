"""Privacy, failure semantics and resource bounds for private diagnostics."""
import asyncio
from contextlib import contextmanager
import json
import logging
import multiprocessing
import os
import sqlite3
import threading
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

from backend import observability as obs
from backend.config import settings
from backend.outbound_targets import OutboundTargetRejected, TargetPolicy
from backend.scrapers.dumper import dump_failed_html, prune_failed_dumps

SECRET = 'Student-Secret-cookie-signed-url-grade-6.0'


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'logs_dir', str(tmp_path / 'dumps'))
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    instance = obs.EventStore(tmp_path / 'diagnostics')
    monkeypatch.setattr(obs, 'get_store', lambda: instance)
    yield instance
    instance.flush()
    instance.close()


def test_requests_never_persist_input_and_generate_own_ids(store):
    app = FastAPI()
    app.add_middleware(obs.DiagnosticMiddleware)

    @app.post('/write/{student}')
    async def write(student: str):
        return {'success': True}

    with TestClient(app) as client:
        first = client.post('/write/' + SECRET + '?token=' + SECRET,
            headers={'X-Request-Id': SECRET, 'Cookie': 'betterilias_session=' + SECRET,
                     'Authorization': 'Bearer ' + SECRET}, json={'grade': SECRET})
        second = client.get('/unknown/' + SECRET)
    store.flush()
    rows = store.read()
    assert first.headers['x-request-id'] != SECRET
    assert len(first.headers['x-request-id']) == 32
    assert first.headers['x-request-id'] != second.headers['x-request-id']
    assert {r['status'] for r in rows} == {200, 404}
    assert SECRET not in json.dumps(rows)
    assert SECRET.encode() not in store.path.read_bytes()


def test_security_and_unsupported_formats_are_distinct_without_urls(store):
    policy = TargetPolicy('https://ilias.unibe.ch', [])
    for url in ('https://unknown.invalid/' + SECRET,
                'https://ilias.unibe.ch/unknown-script.php?token=' + SECRET):
        with pytest.raises(OutboundTargetRejected):
            policy.resource_url(url)
    store.flush()
    rows = store.read()
    assert {(r['code'], r['category']) for r in rows} == {
        ('outbound.origin_not_allowed', 'security'),
        ('outbound.unsupported_resource', 'compatibility')}
    assert SECRET not in json.dumps(rows)


@pytest.mark.asyncio
async def test_native_dispatch_failure_is_uncertain_and_nested_audits_correlate(store):
    from backend.outbound_http import BudgetTransport

    class Permit:
        async def close(self):
            pass

    class Budget:
        async def acquire(self, identity):
            return Permit()

    async def failing_transport(request):
        raise httpx.ReadTimeout(SECRET)

    @obs.audit('feedback_upload')
    async def upload():
        transport = BudgetTransport('not-retained', inner=httpx.MockTransport(failing_transport), budget=Budget())
        async with httpx.AsyncClient(transport=transport) as client:
            await client.post('https://ilias.unibe.ch/ilias.php?rtoken=' + SECRET, content=SECRET)

    @obs.audit('feedback_import')
    async def publish():
        await asyncio.gather(upload())

    token = obs._request.set('a' * 32)
    try:
        with pytest.raises(httpx.ReadTimeout):
            await publish()
    finally:
        obs._request.reset(token)
    store.flush()
    rows = store.read()
    finished = [r for r in rows if r['code'] == 'write.finished']
    assert len(finished) == 2
    assert all(r['outcome'] == 'uncertain' for r in finished)
    assert len({r['operation_id'] for r in finished}) == 2
    assert all(r['request_id'] == 'a' * 32 for r in rows)
    assert SECRET not in json.dumps(rows)
    assert obs._operation.get() is None


@pytest.mark.asyncio
async def test_audit_partial_rejection_and_returned_have_different_meanings(store):
    @obs.audit('allocation')
    async def partial():
        return 2, [SECRET]

    @obs.audit('grade')
    async def rejected():
        raise ValueError(SECRET)

    @obs.audit('grade')
    async def returned():
        return {'success': True, 'student': SECRET}

    await partial()
    with pytest.raises(ValueError):
        await rejected()
    await returned()
    store.flush()
    rows = store.read()
    assert {r['outcome'] for r in rows if r['code'] == 'write.finished'} == {'partial', 'rejected', 'returned'}
    assert SECRET not in json.dumps(rows)


def test_admin_requires_independent_key_and_never_exposes_raw_pages(store, monkeypatch):
    from backend.main import app
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)
    monkeypatch.setattr(settings, 'admin_api_key', '')
    client = TestClient(app)
    assert client.get('/api/admin/events', headers={'X-Admin-Key': 'k' * 43}).status_code == 404
    monkeypatch.setattr(settings, 'admin_api_key', 'k' * 43)
    assert client.get('/api/admin/events', headers={'X-Session-Id': 'k' * 43}).status_code == 404
    assert client.get('/api/admin/events', headers={'Authorization': 'Bearer ' + 'k' * 43}).status_code == 404
    assert client.get('/api/admin/events?x_admin_key=' + 'k' * 43).status_code == 404
    obs.emit('outbound.busy', status=503)
    store.flush()
    response = client.get('/api/admin/events?limit=1', headers={'X-Admin-Key': 'k' * 43})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert len(response.json()['events']) == 1
    assert response.json()['next_before']
    assert client.get('/api/admin/summary', headers={'X-Admin-Key': 'k' * 43}).status_code == 200
    monkeypatch.setattr(settings, 'app_env', 'production')
    assert client.get('/api/system/logs', headers={'X-Admin-Key': 'k' * 43}).status_code == 404


def test_legacy_log_formatter_does_not_interpolate_or_emit_exception_data():
    record = logging.LogRecord('httpx', logging.ERROR, SECRET, 1, 'url=%s', (SECRET,), None)
    record.exc_info = (ValueError, ValueError(SECRET), None)
    formatted = obs.PrivateFormatter().format(record)
    assert SECRET not in formatted
    assert json.loads(formatted)['source'] == 'upstream'


def test_dump_privacy_opt_in_and_retention(store, monkeypatch):
    monkeypatch.setattr(settings, 'app_env', 'production')
    monkeypatch.setattr(settings, 'capture_failed_html', True)
    path = dump_failed_html(SECRET, SECRET, ValueError(SECRET), {'student': SECRET})
    assert SECRET not in path.read_text()
    assert SECRET not in path.name
    legacy = settings.log_path / 'failed_html_dump_old_20200101_000000.html'
    legacy.write_text(SECRET)
    prune_failed_dumps()
    assert not legacy.exists()
    monkeypatch.setattr(settings, 'app_env', 'development')
    monkeypatch.setattr(settings, 'failed_html_max_files', 2)
    monkeypatch.setattr(settings, 'failed_html_max_bytes', 1024)
    raw = dump_failed_html(SECRET * 1000, 'parser')
    assert raw.stat().st_size == 1024
    assert SECRET in raw.read_text()
    dump_failed_html('second', 'parser')
    assert len(list(settings.log_path.glob('failed_html_dump_*.html'))) == 2
    old = time.time() - 25 * 3600
    os.utime(raw, (old, old))
    prune_failed_dumps()
    assert not raw.exists()


def _process_writer(directory):
    instance = obs.EventStore(directory, max_events=100)
    for _ in range(30):
        instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
    instance.flush()
    assert instance.storage_errors == 0
    instance.close()


def test_shared_writers_retention_and_cursor_monotonicity(tmp_path):
    directory = tmp_path / 'shared'
    processes = [multiprocessing.get_context('spawn').Process(target=_process_writer, args=(directory,)) for _ in range(2)]
    for process in processes:
        process.start()
    for process in processes:
        process.join(20)
        assert process.exitcode == 0
    instance = obs.EventStore(directory, max_events=3)
    try:
        for _ in range(10):
            instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
        instance.flush()
        assert len(instance.read()) == 3
        previous = instance.read()[0]['id']
        # Deletion clears content and new IDs cannot reuse old cursors.
        with sqlite3.connect(instance.path) as db:
            db.execute('DELETE FROM events')
        instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
        instance.flush()
        assert instance.read()[0]['id'] > previous
        instance.submit({'timestamp': time.time() - 8 * 86400, 'code': 'worker.started'})
        instance.flush()
        assert len(instance.read()) == 1
        assert instance.path.stat().st_size <= 32 * 1024 * 1024
    finally:
        instance.close()


def test_queue_overload_is_bounded_and_reports_loss(tmp_path):
    gate, entered = threading.Event(), threading.Event()

    class PausedStore(obs.EventStore):
        @contextmanager
        def _connect(self):
            entered.set()
            gate.wait(5)
            with super()._connect() as db:
                yield db

    instance = PausedStore(tmp_path, queue_size=1)
    try:
        instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
        assert entered.wait(3)
        for _ in range(10):
            instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
        assert instance.pending.qsize() == 1
        assert instance.dropped == 9
        gate.set()
        instance.flush()
        assert len(instance.read()) == 2
    finally:
        gate.set()
        instance.close()


def test_storage_failure_does_not_fail_the_call_and_is_visible(tmp_path):
    path = tmp_path / 'not-a-directory'
    path.write_text('blocked')
    instance = obs.EventStore(path)
    try:
        instance.submit({'timestamp': time.time(), 'code': 'worker.started'})
        instance.flush()
        assert instance.storage_errors >= 1
        assert instance.dropped == 1
    finally:
        instance.close()


def test_size_pressure_keeps_new_events_and_reuses_bounded_pages(tmp_path):
    instance = obs.EventStore(tmp_path, max_events=10000, max_mb=1)
    try:
        for batch in range(60):
            for index in range(100):
                instance.submit({'timestamp': time.time(), 'code': 'request.completed',
                    'category': 'request', 'worker': 'a' * 16,
                    'request_id': f'{batch * 100 + index:032x}', 'duration_ms': 123.4,
                    'status': 200, 'method': 'POST', 'schema': 1})
            instance.flush()
        assert instance.path.stat().st_size <= 1024 * 1024
        assert instance.read()[0]['request_id'] == f'{5999:032x}'
        assert instance.storage_errors == 0
    finally:
        instance.close()
