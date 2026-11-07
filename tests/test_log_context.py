"""Actionable code context without runtime values, secrets or arbitrary paths."""
import json
import logging
import re
import errno
import sqlite3
import httpx

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import observability as obs
from backend.diagnostic_metadata import APP_VERSION, ROOT, error_details, register_routes, source_manifest
from backend.main import app as main_app
from backend.scrapers.dumper import ScrapingParsingError, dump_failed_html
from backend.scrapers.forms import extract_grading_form
from tests.test_observability import SECRET, store, console


def test_parser_failure_has_registered_route_parser_reason_and_code_frames(store, console):
    app = FastAPI(exception_handlers=main_app.exception_handlers)
    app.add_middleware(obs.DiagnosticMiddleware)

    @app.get('/api/example/{student}')
    def endpoint(student: str):
        return extract_grading_form('<div>' + SECRET + '</div>', member_id=student)

    register_routes(app)
    response = TestClient(app).get('/api/example/' + SECRET + '?rtoken=' + SECRET,
        headers={'X-Request-Id': SECRET, 'X-BetterIlias-Browser-Id': SECRET})
    assert response.status_code == 502
    store.flush()
    rows = store.read()
    parser = next(row for row in rows if row['code'] == 'parser.failed')
    assert parser['route'] == '/api/example/{student}'
    assert parser['parser'] == 'grading_form'
    assert parser['reason'] == 'dom_extraction' and parser['error_kind'] == 'invalid_value'
    assert any(frame['file'] == 'backend/scrapers/forms.py' and frame['function'] == 'extract_grading_form'
               and frame['line'] > 0 for frame in parser['stack'])
    assert {row['request_id'] for row in rows} == {response.headers['x-request-id']}
    assert all(row['app_version'] == APP_VERSION and re.fullmatch(r'backend-[a-f0-9]{16}', row['build']) for row in rows)
    assert all(row['schema'] == 2 for row in rows)
    content = json.dumps(rows) + console.getvalue()
    assert SECRET not in content and str(ROOT) not in content
    assert SECRET.encode() not in store.path.read_bytes()
    assert 'Could not find any' not in content  # no exception text or source lines


def test_unmatched_and_forged_routes_cannot_log_arbitrary_paths(store):
    app = FastAPI()
    app.add_middleware(obs.DiagnosticMiddleware)
    register_routes(app)
    response = TestClient(app).get('/unknown/' + SECRET)
    assert response.status_code == 404
    token = obs._scope.set({'route': type('ForgedRoute', (), {'path_format': '/' + SECRET})()})
    try:
        obs.emit('runtime.warning')
    finally:
        obs._scope.reset(token)
    store.flush()
    assert all(row['route'] == 'unmatched' for row in store.read())
    assert SECRET not in json.dumps(store.read())
    assert obs._scope.get() is None and obs._request.get() is None


def test_lazy_included_routers_and_aliases_use_frozen_prefixed_templates(store):
    router = APIRouter(prefix='/courses')
    @router.get('/{course_id}')
    def endpoint(course_id: str):
        obs.emit('runtime.warning')
        return {'ok': True}
    app = FastAPI()
    app.add_middleware(obs.DiagnosticMiddleware)
    app.include_router(router, prefix='/api')
    app.include_router(router, prefix='/alternate')
    register_routes(app)
    client = TestClient(app)
    assert client.get('/api/courses/' + SECRET).status_code == 200
    assert client.get('/alternate/courses/' + SECRET).status_code == 200
    store.flush()
    rows = store.read()
    assert {row['route'] for row in rows} == {'/api/courses/{course_id}', '/alternate/courses/{course_id}'}
    assert SECRET not in json.dumps(rows)


def test_unknown_parser_exception_names_and_dynamic_filenames_are_discarded(store, console):
    class NoString(Exception):
        def __str__(self):
            pytest.fail('Diagnostic code formatted an exception')
    try:
        exec(compile('raise error', SECRET, 'exec'), {'error': NoString(SECRET)})
    except NoString as exc:
        record = logging.LogRecord('ilias.' + SECRET, logging.ERROR, SECRET, 1, SECRET, (),
                                   (type(exc), exc, exc.__traceback__))
        record.funcName = SECRET
        obs.PrivateHandler().emit(record)
    dump_failed_html(SECRET, SECRET, extra_info={'cookie': SECRET})
    obs.emit('runtime.error', reason=SECRET, source=(SECRET, SECRET, 1))
    store.flush()
    rows = store.read()
    assert next(row for row in rows if row['code'] == 'parser.failed')['parser'] == 'unspecified'
    runtime = next(row for row in rows if row.get('error_kind'))
    assert runtime['error_kind'] == 'unknown_exception' and runtime['stack'] == []
    assert 'source' not in runtime
    assert SECRET not in json.dumps(rows) + console.getvalue()


def test_empty_page_and_result_reasons_are_distinct(store):
    from backend.scrapers.dumper import safe_parser
    with pytest.raises(ScrapingParsingError):
        extract_grading_form('')
    @safe_parser('grading_form', check_empty=True)
    def empty(html):
        return []
    with pytest.raises(ScrapingParsingError):
        empty('<html></html>')
    store.flush()
    assert {row['reason'] for row in store.read() if row['code'] == 'parser.failed'} == {'empty_html', 'empty_result'}


def test_code_only_causes_exception_groups_and_cycles_are_bounded(store):
    try:
        extract_grading_form('<div>' + SECRET + '</div>')
    except ScrapingParsingError as exc:
        saved = exc
    group = ExceptionGroup(SECRET, [saved] * 20)
    details = error_details(group)
    assert details['error_kind'] == 'invalid_value'
    assert details['stack_truncated']
    assert 0 < len(details['stack']) <= 12
    assert all(set(frame) == {'file', 'function', 'line'} for frame in details['stack'])
    saved.__cause__ = saved
    assert len(error_details(saved)['stack']) <= 12
    assert SECRET not in json.dumps(details)


def test_context_failure_is_best_effort_and_old_schema_filters_still_work(store, monkeypatch):
    def unavailable():
        raise OSError(SECRET)
    monkeypatch.setattr(obs, 'release', unavailable)
    obs.emit('runtime.error')
    store.submit({'schema': 1, 'timestamp': __import__('time').time(), 'code': 'request.completed',
                  'request_id': 'a' * 32, 'status': 200})
    store.flush()
    assert store.read(request_id='a' * 32)[0]['schema'] == 1
    assert len(store.read()) == 2
    assert SECRET not in json.dumps(store.read())
    with pytest.raises(ValueError):
        store.read(request_id=SECRET)


def test_admin_and_cli_can_find_all_events_for_a_request(store, monkeypatch, capsys):
    from backend.config import settings
    from backend.diagnostics import main
    monkeypatch.setattr(settings, 'admin_api_key', 'k' * 43)
    monkeypatch.setattr(settings, 'observability_dir', str(store.directory))
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)
    token = obs._request.set('b' * 32)
    try:
        obs.emit('parser.failed', parser='grading_form')
        obs.emit('request.completed', status=502)
    finally:
        obs._request.reset(token)
    obs.emit('worker.started')
    store.flush()
    response = TestClient(main_app).get('/api/admin/events?request_id=' + 'b' * 32,
                                       headers={'X-Admin-Key': 'k' * 43})
    assert len(response.json()['events']) == 2
    assert response.headers['cache-control'] == 'no-store'
    assert TestClient(main_app).get('/api/admin/events?request_id=' + SECRET,
                                  headers={'X-Admin-Key': 'k' * 43}).status_code == 422
    assert main(['events', '--request-id', 'b' * 32]) == 0
    assert len(json.loads(capsys.readouterr().out)['events']) == 2


def test_handled_admin_storage_failure_keeps_actionable_context(store, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, 'admin_api_key', 'k' * 43)
    monkeypatch.setattr('backend.api.routes.admin.get_store', lambda: store)
    def unavailable():
        error = sqlite3.OperationalError(SECRET)
        error.sqlite_errorcode = sqlite3.SQLITE_BUSY
        raise error
    monkeypatch.setattr(store, 'summary', unavailable)
    response = TestClient(main_app).get('/api/admin/summary', headers={'X-Admin-Key': 'k' * 43})
    assert response.status_code == 503 and SECRET not in response.text
    store.flush()
    event = next(row for row in store.read() if row['code'] == 'runtime.error')
    assert event['error_kind'] == 'storage_busy'
    assert event['route'] == '/api/admin/summary'
    assert any(frame['file'] == 'backend/api/routes/admin.py' and frame['function'] == 'summary' for frame in event['stack'])
    assert SECRET not in json.dumps(store.read())


def test_build_and_parser_catalogue_use_only_deployed_source():
    frames, parsers, build = source_manifest()
    assert 'grading_form' in parsers
    assert any(info[0] == 'backend/services/ilias_client.py' for info in frames.values())
    assert re.fullmatch('backend-[a-f0-9]{16}', build)


@pytest.mark.parametrize('error,category', [(httpx.ConnectTimeout(SECRET), 'connect_timeout'),
    (httpx.ReadTimeout(SECRET), 'read_timeout'), (httpx.WriteTimeout(SECRET), 'write_timeout'),
    (httpx.PoolTimeout(SECRET), 'pool_timeout'), (OSError(errno.ENOSPC, SECRET), 'storage_full'),
    (FileNotFoundError(SECRET), 'file_missing'), (PermissionError(SECRET), 'permission_denied'),
    (ConnectionResetError(SECRET), 'network_error')])
def test_fixed_failure_categories_never_copy_exception_values(error, category):
    details = error_details(error)
    assert details['error_kind'] == category
    assert SECRET not in json.dumps(details)


def test_sqlite_categories_and_transport_causes_remain_specific():
    for code, category in ((sqlite3.SQLITE_FULL, 'storage_full'), (sqlite3.SQLITE_BUSY, 'storage_busy')):
        error = sqlite3.OperationalError(SECRET)
        error.sqlite_errorcode = code
        assert error_details(error)['error_kind'] == category
    error = httpx.ConnectTimeout(SECRET)
    error.__cause__ = TimeoutError(SECRET)
    assert error_details(error)['error_kind'] == 'connect_timeout'


def test_legacy_error_inside_except_keeps_safe_context_without_exc_info(store):
    try:
        extract_grading_form('<div>' + SECRET + '</div>')
    except ScrapingParsingError:
        record = logging.LogRecord('ilias.application', logging.ERROR, SECRET, 1, SECRET, (), None)
        obs.PrivateHandler().emit(record)
    store.flush()
    event = next(row for row in store.read() if row['code'] == 'runtime.error')
    assert event['error_kind'] == 'invalid_value'
    assert event['stack']
    assert SECRET not in json.dumps(store.read())
