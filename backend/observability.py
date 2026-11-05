"""Private, bounded diagnostics. No caller-provided text enters an event.

The queue is best effort, not a transaction log. Losing diagnostics must never
retry a native write. Only the writer thread touches the database on requests.
"""
import atexit
from contextlib import closing, contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import inspect
import json
import logging
import os
from pathlib import Path
import queue
import secrets
import sqlite3
import threading
import time

from backend.config import settings

EVENTS = {
    'request.completed': 'request', 'request.failed': 'request',
    'outbound.malformed_url': 'security', 'outbound.origin_not_allowed': 'security',
    'outbound.ambiguous_command': 'security', 'outbound.unsafe_command': 'security',
    'outbound.external_write': 'security', 'outbound.private_address': 'security',
    'outbound.unsupported_resource': 'compatibility', 'parser.failed': 'compatibility',
    'auth.rejected': 'security', 'input.invalid_identifier': 'security',
    'input.invalid': 'request', 'outbound.busy': 'operational',
    'outbound.throttled': 'operational', 'outbound.timeout': 'operational',
    'outbound.network_error': 'operational', 'coordination.busy': 'operational',
    'write.started': 'audit', 'write.finished': 'audit',
    'admin.read': 'audit', 'admin.rejected': 'security',
    'admin.login': 'audit', 'admin.logout': 'audit',
    'report.created': 'audit', 'report.deleted': 'audit', 'report.preference_changed': 'audit',
    'report.resolved': 'audit', 'report.reopened': 'audit',
    'report.unavailable': 'operational',
    'runtime.warning': 'operational', 'runtime.error': 'operational',
    'worker.started': 'operational', 'worker.stopped': 'operational',
}
OPERATIONS = frozenset('grade allocation feedback_upload feedback_delete feedback_import '
    'submission_upload submission_delete team_create team_add team_remove team_delete '
    'assignment_save assignment_delete assignment_order instruction_upload instruction_delete '
    'folder_create course_upload material_delete material_order membership '
    'calendar_create calendar_update calendar_duplicate calendar_delete calendar_color '
    'calendar_ignore calendar_import calendar_token_rotate calendar_token_revoke '
    'auth_sync auth_logout auth_claim auth_handoff'.split())
OUTCOMES = frozenset(('started', 'returned', 'partial', 'rejected', 'uncertain', 'failed'))
METHODS = frozenset(('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'))
COMPONENTS = frozenset(('auth', 'calendar', 'scraper', 'outbound', 'server', 'application'))
CATEGORIES = frozenset(EVENTS.values())
_console = logging.getLogger('betterilias.events')
_console.addHandler(logging.NullHandler())
_console.propagate = False
_console_failures = 0
_request = ContextVar('diagnostic_request', default=None)
_operation = ContextVar('diagnostic_operation', default=None)
_dispatch = ContextVar('diagnostic_dispatch', default=None)
_store = None
_store_lock = threading.Lock()


def _private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != 'nt':
        path.chmod(0o700)


class EventStore:
    def __init__(self, directory, *, retention_days=7, max_events=50000,
                 queue_size=2048, max_mb=32, cleanup_dumps=False):
        self.directory = Path(directory)
        self.path = self.directory / 'events.sqlite3'
        self.retention_seconds = retention_days * 86400
        self.max_events, self.max_mb = max_events, max_mb
        self.cleanup_dumps = cleanup_dumps
        self.worker = secrets.token_hex(8)
        self.pending = queue.Queue(maxsize=queue_size)
        self.dropped = self.storage_errors = 0
        self.last_write = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name='private-diagnostics', daemon=True)
        self._thread.start()

    def submit(self, event):
        if self._stop.is_set():
            self.dropped += 1
            return
        try:
            self.pending.put_nowait(event)
        except queue.Full:
            self.dropped += 1

    @contextmanager
    def _connect(self):
        _private_directory(self.directory)
        db = sqlite3.connect(self.path, timeout=.5)
        try:
            # Rollback journal is bounded by the database; no WAL sidecar.
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('PRAGMA secure_delete=ON')
            page_size = db.execute('PRAGMA page_size').fetchone()[0]
            db.execute(f'PRAGMA max_page_count={self.max_mb * 1024 * 1024 // page_size}')
            db.execute('CREATE TABLE IF NOT EXISTS events '
                       '(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, code TEXT NOT NULL, data TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS event_time ON events(ts)')
            db.commit()
            if os.name != 'nt':
                self.path.chmod(0o600)
            with db:
                yield db
        finally:
            db.close()

    def _prune(self, db):
        db.execute('DELETE FROM events WHERE ts < ?', (time.time() - self.retention_seconds,))
        db.execute('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id DESC LIMIT -1 OFFSET ?)',
                   (self.max_events,))
        page_size = db.execute('PRAGMA page_size').fetchone()[0]
        used = db.execute('PRAGMA page_count').fetchone()[0] - db.execute('PRAGMA freelist_count').fetchone()[0]
        if used * page_size > self.max_mb * 1024 * 1024 * .8:
            # Reuse pages before reaching SQLITE_FULL; the newest events remain
            # useful under sustained traffic instead of freezing a full store.
            count = db.execute('SELECT count(*) FROM events').fetchone()[0]
            db.execute('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id LIMIT ?)',
                       (max(100, count // 5),))

    def _run(self):
        # Prune even when no new requests arrive. Closed servers need the
        # documented scheduled purge; no in-process timer runs while stopped.
        maintained = 0
        while not self._stop.is_set() or not self.pending.empty():
            batch = []
            try:
                batch.append(self.pending.get(timeout=1))
                while len(batch) < 100:
                    try:
                        batch.append(self.pending.get_nowait())
                    except queue.Empty:
                        break
            except queue.Empty:
                pass
            if not batch and time.monotonic() - maintained < 30:
                continue
            try:
                with self._connect() as db:
                    self._prune(db)
                    for event in batch:
                        db.execute('INSERT INTO events(ts,code,data) VALUES(?,?,?)',
                                   (event['timestamp'], event['code'], json.dumps(event, separators=(',', ':'))))
                    self._prune(db)
                if time.monotonic() - maintained >= 30:
                    if self.cleanup_dumps:
                        from backend.scrapers.dumper import prune_failed_dumps
                        prune_failed_dumps()
                    maintained = time.monotonic()
                if batch:
                    self.last_write = time.time()
            except (OSError, sqlite3.Error):
                self.storage_errors += 1
                self.dropped += len(batch)
                # Never log the underlying exception (it may contain a path).
            finally:
                # Output on the writer thread, including when SQLite failed.
                # Request handlers never wait for a slow terminal/collector.
                for event in batch:
                    try:
                        _write_console(event)
                    finally:
                        self.pending.task_done()

    def flush(self):
        self.pending.join()

    def close(self):
        self._stop.set()
        self._thread.join(timeout=3)

    def read(self, *, before=None, limit=100, category=None, code=None):
        return read_events(self.path, retention_seconds=self.retention_seconds,
                           before=before, limit=limit, category=category, code=code)

    def summary(self):
        counts = []
        request_metrics = None
        if self.path.exists():
            with closing(sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro', uri=True, timeout=.5)) as db:
                counts = db.execute('SELECT code,count(*) FROM events WHERE ts >= ? GROUP BY code',
                                    (time.time() - self.retention_seconds,)).fetchall()
                request_metrics = db.execute("SELECT count(*),avg(json_extract(data,'$.duration_ms')),"
                    "max(json_extract(data,'$.duration_ms')),sum(json_extract(data,'$.status') >= 500) "
                    "FROM events WHERE ts >= ? AND code IN ('request.completed','request.failed')",
                    (time.time() - self.retention_seconds,)).fetchone()
        return {'worker': self.worker, 'queue_depth': self.pending.qsize(), 'dropped': self.dropped,
                'storage_errors': self.storage_errors, 'last_write': self.last_write,
                'console_errors': _console_failures,
                'writer_alive': self._thread.is_alive(), 'retention_seconds': self.retention_seconds,
                'retained_counts': dict(counts),
                'retained_request_metrics': dict(zip(('count', 'mean_ms', 'max_ms', 'server_errors'),
                                                     request_metrics or (0, None, None, 0)))}


def get_store():
    global _store
    with _store_lock:
        if _store is None:
            _store = EventStore(settings.observability_path,
                retention_days=settings.observability_retention_days,
                max_events=settings.observability_max_events,
                queue_size=settings.observability_queue_size, max_mb=settings.observability_max_mb,
                cleanup_dumps=True)
    return _store


def emit(code, *, status=None, duration_ms=None, method=None, operation=None, outcome=None, component=None):
    """Deliberately no **fields, message, URL, exception, actor or request body."""
    if code not in EVENTS:
        raise ValueError('Unknown diagnostic event code')
    event = {'schema': 1, 'timestamp': time.time(), 'code': code, 'category': EVENTS[code]}
    if _request.get():
        event['request_id'] = _request.get()
    if _operation.get():
        event['operation_id'] = _operation.get()
    if type(status) is int and 100 <= status <= 599:
        event['status'] = status
    if type(duration_ms) in (int, float) and 0 <= duration_ms <= 86400000:
        event['duration_ms'] = round(duration_ms, 1)
    if method in METHODS:
        event['method'] = method
    if operation in OPERATIONS:
        event['operation'] = operation
    if outcome in OUTCOMES:
        event['outcome'] = outcome
    if component in COMPONENTS:
        event['component'] = component
    event['level'] = _event_level(event)
    try:
        store = get_store()
        event['worker'] = store.worker
        store.submit(event)
    except (OSError, RuntimeError):
        # Telemetry must not turn a completed native mutation into an API error.
        pass


def mark_dispatch():
    # A mutable stack crosses child tasks used by feedback import; do not record
    # the request, URL or native credentials. Parent audits see nested dispatches.
    for state in _dispatch.get() or ():
        state['sent'] = True


def _returned_outcome(result):
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], int) and isinstance(result[1], list):
        return 'partial' if result[0] and result[1] else 'failed' if result[1] else 'returned'
    success = result.get('success') if isinstance(result, dict) else getattr(result, 'success', None)
    authenticated = result.get('authenticated') if isinstance(result, dict) else getattr(result, 'authenticated', None)
    if authenticated is False:
        return 'rejected'
    failed = result.get('failed_count', 0) if isinstance(result, dict) else getattr(result, 'failed_count', 0)
    if failed:
        return 'partial'
    if success is False or result is False:
        return 'failed'
    return 'returned'


def audit(operation):
    if operation not in OPERATIONS:
        raise ValueError('Unknown audit operation')
    def decorate(fn):
        def start():
            from backend.diagnostic_reports import operation_context
            operation_context(operation)
            state = {'sent': False}
            tokens = (_operation.set(secrets.token_hex(16)),
                      _dispatch.set((*(_dispatch.get() or ()), state)))
            emit('write.started', operation=operation, outcome='started')
            return state, tokens
        def finish(state, tokens, result=None, failed=False):
            try:
                outcome = ('uncertain' if state['sent'] else 'rejected') if failed else _returned_outcome(result)
                from backend.diagnostic_reports import operation_context
                operation_context(operation, outcome)
                emit('write.finished', operation=operation, outcome=outcome)
            finally:
                _dispatch.reset(tokens[1])
                _operation.reset(tokens[0])
        if inspect.iscoroutinefunction(fn):
            @wraps(fn)
            async def wrapped(*args, **kwargs):
                state, tokens = start()
                try:
                    result = await fn(*args, **kwargs)
                except BaseException:
                    finish(state, tokens, failed=True)
                    raise
                finish(state, tokens, result)
                return result
        else:
            @wraps(fn)
            def wrapped(*args, **kwargs):
                state, tokens = start()
                try:
                    result = fn(*args, **kwargs)
                except BaseException:
                    finish(state, tokens, failed=True)
                    raise
                finish(state, tokens, result)
                return result
        return wrapped
    return decorate


class DiagnosticMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        # Never trust an incoming correlation ID and never inspect query/header
        # values. No route path or IP is retained, even for 404/validation errors.
        request_id = secrets.token_hex(16)
        scope.setdefault('state', {})['diagnostic_request_id'] = request_id
        token = _request.set(request_id)
        started, status_code = time.monotonic(), 500
        async def wrapped_send(message):
            nonlocal status_code
            if message['type'] == 'http.response.start':
                status_code = message['status']
                message['headers'] = [(k, v) for k, v in message.get('headers', []) if k.lower() != b'x-request-id']
                message['headers'].append((b'x-request-id', request_id.encode()))
                if scope.get('path', '').startswith('/api/admin/'):
                    message['headers'] = [(k, v) for k, v in message['headers'] if k.lower() != b'cache-control']
                    message['headers'].append((b'cache-control', b'no-store'))
            await send(message)
        failed = False
        try:
            await self.app(scope, receive, wrapped_send)
        except BaseException:
            failed = True
            raise
        finally:
            emit('request.failed' if failed else 'request.completed', status=status_code,
                 duration_ms=(time.monotonic() - started) * 1000, method=scope['method'])
            _request.reset(token)


class PrivateHandler(logging.StreamHandler):
    def emit(self, record):
        if record.levelno >= logging.WARNING:
            name = record.name
            component = ('auth' if name.startswith('ilias.auth') else
                         'calendar' if name.startswith('ilias.calendar') else
                         'scraper' if name.startswith('ilias.scraper') else
                         'outbound' if name.startswith(('httpx', 'httpcore', 'ilias.outbound')) else
                         'server' if name.startswith('uvicorn') else 'application')
            emit("runtime.error" if record.levelno >= logging.ERROR else "runtime.warning",
                 component=component)


class PrivateFormatter(logging.Formatter):
    """Legacy messages/tracebacks may embed cookies, names and signed URLs."""
    def format(self, record):
        # Keep level and source class, never interpolate record.msg/args/exception.
        source = ('upstream' if record.name.startswith(('httpx', 'httpcore')) else
                  'server' if record.name.startswith('uvicorn') else 'application')
        return json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(),
                           'level': record.levelname, 'source': source,
                           'code': 'runtime.error' if record.levelno >= logging.ERROR else 'runtime.warning'
                                   if record.levelno >= logging.WARNING else 'runtime.info'})


def configure_logging():
    console_handler = ConsoleHandler()
    console_handler.setFormatter(logging.Formatter('%(message)s'))
    _console.handlers[:] = [console_handler]
    _console.setLevel(100 if settings.log_console_level == 'OFF' else settings.log_console_level)
    _console.propagate = False
    handler = PrivateHandler()
    handler.setLevel(logging.WARNING)
    handler.setFormatter(PrivateFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for name in ('uvicorn', 'uvicorn.error', 'uvicorn.access', 'httpx', 'httpcore'):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    # Replace raw access logging with DiagnosticMiddleware; INFO HTTPX messages
    # add no useful information once their credential-bearing URLs are removed.
    logging.getLogger('uvicorn.access').disabled = True
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)


def _event_level(event):
    if (event['code'] in ('runtime.error', 'request.failed') or event.get('status', 0) >= 500):
        return 'ERROR'
    if (event.get('category', EVENTS.get(event['code'])) in ('security', 'compatibility') or event['code'] == 'runtime.warning'
            or event.get('status', 0) >= 400
            or event.get('outcome') in ('partial', 'uncertain', 'failed', 'rejected')):
        return 'WARNING'
    return 'INFO'


def _write_console(event):
    global _console_failures
    try:
        _console.log(getattr(logging, event.get('level', _event_level(event))),
                     '%s', json.dumps(event, separators=(',', ':')))
    except (OSError, ValueError):
        # Logging must never stop the writer or dump a raw exception to stderr.
        _console_failures += 1


class ConsoleHandler(logging.StreamHandler):
    def handleError(self, record):
        # Broken pipes/collectors must not cause logging's fallback traceback.
        global _console_failures
        _console_failures += 1


def read_events(path, *, retention_seconds, before=None, limit=100, category=None, code=None):
    """Read-only local/admin inspection; never starts a writer or creates files."""
    if category is not None and category not in CATEGORIES:
        raise ValueError('Unknown diagnostic category')
    if code is not None and code not in EVENTS:
        raise ValueError('Unknown diagnostic event code')
    path = Path(path)
    if not path.exists():
        return []
    predicates = ['ts >= ?', 'id < ?']
    values = [time.time() - retention_seconds, before or 9223372036854775807]
    if code:
        predicates.append('code = ?')
        values.append(code)
    if category:
        codes = [name for name, group in EVENTS.items() if group == category]
        predicates.append('code IN (' + ','.join('?' for _ in codes) + ')')
        values.extend(codes)
    values.append(max(1, min(limit, 200)))
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=.5)) as db:
        rows = db.execute('SELECT id,data FROM events WHERE ' + ' AND '.join(predicates) +
                          ' ORDER BY id DESC LIMIT ?', values).fetchall()
    return [{'id': row[0], **json.loads(row[1])} for row in rows]


def shutdown():
    global _store
    with _store_lock:
        store, _store = _store, None
    if store is not None:
        store.close()


atexit.register(shutdown)
