"""Consented, text-free diagnostic evidence. Never stores raw HTML or exceptions."""
import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Tag

from backend.config import settings
from backend.observability import emit, OPERATIONS, OUTCOMES

KINDS = ('parsing', 'upstream', 'security', 'concurrency', 'application', 'client')
CODES = {
    'PARSING_FAILED': 'parsing', 'SUBMISSIONS_INCOMPLETE': 'parsing',
    'ILIAS_TIMEOUT': 'upstream', 'ILIAS_NETWORK_ERROR': 'upstream', 'ILIAS_BUSY': 'upstream',
    'OUTBOUND_TARGET_BLOCKED': 'security', 'COORDINATION_BUSY': 'concurrency',
    'HTTP_ERROR': 'application', 'INTERNAL_ERROR': 'application',
    'WRITE_INCOMPLETE': 'application',
    'CLIENT_RENDER': 'client', 'CLIENT_CONNECTION': 'client',
}
PENDING_TTL = 600
PREFERENCE_TTL = 90 * 86400
POLICY = 1
_context = ContextVar('report_evidence', default=None)
_parsers = set()
TAGS = frozenset('html head body main header footer nav section article aside div span h1 h2 h3 h4 p a table thead tbody tfoot tr th td form input select option optgroup textarea button label fieldset legend ul ol li dialog details summary img video source br hr'.split())
TYPES = frozenset('text password hidden checkbox radio submit button file number date datetime-local email search url tel reset'.split())
ROLES = frozenset('main navigation banner contentinfo alert status dialog tab tablist tabpanel button table row cell columnheader form list listitem'.split())
CLASSES = frozenset('ilTable ilTable2 table ilForm form-horizontal form-control ilTabs ilMainHeader il-maincontrols alert alert-danger alert-warning il-avatar il-standard-item modal modal-dialog modal-body modal-content ilTableNav ilTableHeaderTitle row'.split())
NAMES = frozenset('mark status notice csrf_token rtoken cmd ref_id ass_id'.split())


def disclosure():
    url = settings.diagnostic_report_privacy_url
    try:
        parsed = urlsplit(url)
        valid = parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        valid = False
    return {'available': settings.app_env != 'production' or bool(settings.diagnostic_report_operator_name.strip() and valid),
            'operator_name': settings.diagnostic_report_operator_name, 'privacy_url': url if valid else '',
            'retention_days': settings.diagnostic_reports_retention_days, 'policy': POLICY, 'preference_days': 90}


def register_parser(name):
    if isinstance(name, str) and re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]{0,79}', name):
        _parsers.add(name)


def structural_outline(html):
    """No text, arbitrary attributes, values, URLs, IDs or script contents."""
    soup = BeautifulSoup((html or '')[:262144], 'lxml')
    for tag in soup.find_all(['script', 'style', 'template', 'noscript', 'svg', 'math']):
        tag.decompose()
    lines, size = [], 0
    for node in soup.find_all(True, limit=1001):
        if len(lines) == 1000:
            break
        tag = node.name if node.name in TAGS else 'element'
        attrs = []
        if node.get('type') in TYPES:
            attrs.append('type=' + node['type'])
        if node.get('role') in ROLES:
            attrs.append('role=' + node['role'])
        if node.get('name') in NAMES:
            attrs.append('name=' + node['name'])
        classes = sorted(set(node.get('class', [])) & CLASSES)
        if classes:
            attrs.append('class=' + ','.join(classes))
        depth = min(12, sum(isinstance(parent, Tag) for parent in node.parents))
        line = '  ' * depth + '<' + tag + (' ' + ' '.join(attrs) if attrs else '') + '>'
        if size + len(line) > 20000:
            break
        lines.append(line)
        size += len(line) + 1
    return {'outline': '\n'.join(lines), 'nodes': len(lines),
            'limited': len(html or '') > 262144 or len(lines) == 1000 or size > 19500}


def capture_structure(html, context):
    state = _context.get()
    if state is not None and 'structure' not in state:
        state['parser'] = context if context in _parsers else 'unspecified'
        try:
            state['structure'] = structural_outline(html)
        except Exception:
            state['structure'] = {'outline': '', 'nodes': 0, 'limited': True}


def problem(code):
    state = _context.get()
    if state is not None and code in CODES:
        state['code'] = code


def operation_context(operation, outcome=None):
    state = _context.get()
    if state is not None and operation in OPERATIONS:
        state['operation'] = operation
        if outcome in OUTCOMES:
            state['outcome'] = outcome


@contextmanager
def database():
    directory = settings.diagnostic_reports_path
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != 'nt':
        directory.chmod(0o700)
    path = directory / 'reports.sqlite3'
    db = sqlite3.connect(path, timeout=2)
    db.row_factory = sqlite3.Row
    try:
        if os.name != 'nt':
            path.chmod(0o600)
        db.execute('PRAGMA secure_delete=ON')
        page = db.execute('PRAGMA page_size').fetchone()[0]
        db.execute(f'PRAGMA max_page_count={settings.diagnostic_reports_max_mb * 1024 * 1024 // page}')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY, secret BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences (owner TEXT PRIMARY KEY, mode TEXT NOT NULL, expires REAL NOT NULL, policy INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS captures (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, created REAL NOT NULL,
                expires REAL NOT NULL, payload TEXT NOT NULL, report_id TEXT);
            CREATE TABLE IF NOT EXISTS reports (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                owner TEXT NOT NULL, created REAL NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL,
                fingerprint TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
                resolved_at REAL, payload TEXT NOT NULL, policy INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS report_owner ON reports(owner,created);
            CREATE INDEX IF NOT EXISTS capture_owner ON captures(owner,created);
        ''')
        for table, column, definition in (('reports', 'consent', "TEXT NOT NULL DEFAULT 'legacy'"),
                                          ('reports', 'source', "TEXT NOT NULL DEFAULT ''"),
                                          ('preferences', 'source', "TEXT NOT NULL DEFAULT ''")):
            if column not in {row[1] for row in db.execute(f'PRAGMA table_info({table})')}:
                try:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
                except sqlite3.OperationalError:
                    # Another worker may have completed this additive migration.
                    if column not in {row[1] for row in db.execute(f'PRAGMA table_info({table})')}:
                        raise
        db.commit()
        with db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO meta VALUES (1,?)', (secrets.token_bytes(32),))
            _prune(db)
            yield db
    finally:
        db.close()


def _prune(db):
    now = time.time()
    db.execute('DELETE FROM captures WHERE expires <= ?', (now,))
    db.execute('DELETE FROM preferences WHERE expires <= ?', (now,))
    db.execute('DELETE FROM reports WHERE created < ?', (now - settings.diagnostic_reports_retention_days * 86400,))
    db.execute('DELETE FROM reports WHERE seq IN (SELECT seq FROM reports ORDER BY seq DESC LIMIT -1 OFFSET ?)',
               (settings.diagnostic_reports_max_count,))
    db.execute('DELETE FROM preferences WHERE owner IN '
               '(SELECT owner FROM preferences ORDER BY expires DESC LIMIT -1 OFFSET 10000)')
    page_size = db.execute('PRAGMA page_size').fetchone()[0]
    used = db.execute('PRAGMA page_count').fetchone()[0] - db.execute('PRAGMA freelist_count').fetchone()[0]
    if used * page_size > settings.diagnostic_reports_max_mb * 1024 * 1024 * .8:
        count = db.execute('SELECT count(*) FROM reports').fetchone()[0]
        db.execute("DELETE FROM reports WHERE seq IN (SELECT seq FROM reports "
                   "ORDER BY CASE state WHEN 'resolved' THEN 0 ELSE 1 END,seq LIMIT ?)", (max(20, count // 5),))


def prune():
    if (settings.diagnostic_reports_path / 'reports.sqlite3').exists():
        with database():
            pass


def _owner(db, session_id):
    key = db.execute('SELECT secret FROM meta WHERE id=1').fetchone()[0]
    return hmac.new(key, session_id.encode(), hashlib.sha256).hexdigest()


def _mode(db, owner):
    row = db.execute('SELECT mode,policy FROM preferences WHERE owner=?', (owner,)).fetchone()
    return row['mode'] if row and (row['policy'] == POLICY or row['mode'] == 'never') else 'ask'


def preference(session_id, mode=None):
    with database() as db:
        owner = _owner(db, session_id)
        if mode is not None:
            if mode not in ('ask', 'always', 'never'):
                raise ValueError('Invalid preference')
            db.execute('INSERT OR REPLACE INTO preferences VALUES (?,?,?,?,?)', (owner, mode, time.time() + PREFERENCE_TTL, POLICY, ''))
            if mode == 'never':
                db.execute('DELETE FROM captures WHERE owner=?', (owner,))
        result = _mode(db, owner)
    if mode is not None:
        emit('report.preference_changed')
    return result


def _save(db, owner, payload, consent='once', source=''):
    report_id = secrets.token_hex(16)
    fingerprint = hashlib.sha256(json.dumps([payload['code'], payload['status'], payload.get('operation'),
        payload.get('parser'), payload.get('structure')], sort_keys=True).encode()).hexdigest()
    db.execute('INSERT INTO reports(id,owner,created,kind,code,fingerprint,state,payload,policy,consent,source) VALUES(?,?,?,?,?,?,\'open\',?,?,?,?)',
        (report_id, owner, time.time(), CODES[payload['code']], payload['code'], fingerprint,
         json.dumps(payload, separators=(',', ':')), POLICY, consent, source))
    _prune(db)
    return report_id


def prepare(session_id, code, status=0, request_id=None, parser=None, structure=None, operation=None, outcome=None):
    if code not in CODES or not disclosure()['available']:
        return {}
    payload = {'schema': 1, 'code': code, 'status': status, 'policy': POLICY, 'occurred_at': time.time()}
    if operation in OPERATIONS:
        payload['operation'] = operation
    if outcome in OUTCOMES:
        payload['outcome'] = outcome
    if request_id and re.fullmatch(r'[a-f0-9]{32}', request_id):
        payload['request_id'] = request_id
    if parser in _parsers or parser == 'unspecified':
        payload['parser'] = parser
    if structure is not None:
        payload['structure'] = structure
    saved = False
    with database() as db:
        owner = _owner(db, session_id)
        mode = _mode(db, owner)
        if mode == 'never':
            return {}
        recent = db.execute('SELECT count(*) FROM captures WHERE owner=? AND created>?', (owner, time.time() - 60)).fetchone()[0]
        recent += db.execute('SELECT count(*) FROM reports WHERE owner=? AND created>?', (owner, time.time() - 60)).fetchone()[0]
        if recent >= 5:
            return {}
        if mode == 'always':
            result = {'report_id': _save(db, owner, payload, 'automatic')}
            saved = True
        else:
            if db.execute('SELECT count(*) FROM captures').fetchone()[0] >= 256:
                return {}
            token = secrets.token_hex(16)
            db.execute('INSERT INTO captures VALUES(?,?,?,?,?,NULL)',
                (hashlib.sha256(token.encode()).hexdigest(), owner, time.time(), time.time() + PENDING_TTL,
                 json.dumps(payload, separators=(',', ':'))))
            result = {'capture_id': token, 'code': code}
    if saved:
        emit('report.created')
    return result


def decide(session_id, capture_id, decision):
    if decision not in ('once', 'always', 'decline'):
        raise ValueError('Invalid decision')
    if decision != 'decline' and not disclosure()['available']:
        return None
    created = False
    with database() as db:
        owner = _owner(db, session_id)
        digest = hashlib.sha256(capture_id.encode()).hexdigest()
        if decision == 'decline':
            # Withdrawal still works after the temporary candidate has expired.
            db.execute('DELETE FROM reports WHERE owner=? AND source=?', (owner, digest))
            db.execute('DELETE FROM captures WHERE digest=? AND owner=?', (digest, owner))
            db.execute("UPDATE preferences SET mode='ask',source='' WHERE owner=? AND source=?", (owner, digest))
            return {'saved': False}
        row = db.execute('SELECT * FROM captures WHERE digest=? AND owner=?',
                         (digest, owner)).fetchone()
        if row is None:
            return None
        payload = json.loads(row['payload'])
        if decision != 'decline' and payload.get('policy') != POLICY:
            return None
        if decision == 'always':
            db.execute('INSERT OR REPLACE INTO preferences VALUES (?,?,?,?,?)',
                       (owner, 'always', time.time() + PREFERENCE_TTL, POLICY, row['digest']))
        report_id = row['report_id']
        if report_id is None:
            report_id = _save(db, owner, payload, decision, row['digest'])
            created = True
            # Keep only the idempotency receipt, not a duplicate evidence copy.
            db.execute('UPDATE captures SET report_id=?,payload=? WHERE digest=?',
                       (report_id, json.dumps({'policy': POLICY}), row['digest']))
    if created:
        emit('report.created')
    if decision == 'always':
        emit('report.preference_changed')
    return {'saved': True, 'report_id': report_id}


def delete_owned(session_id):
    with database() as db:
        owner = _owner(db, session_id)
        db.execute('DELETE FROM reports WHERE owner=?', (owner,))
        db.execute('DELETE FROM captures WHERE owner=?', (owner,))
    emit('report.deleted')


def list_reports(state='open', kind=None, before=None, limit=50):
    predicates, args = [], []
    if state != 'all':
        predicates.append('state=?'); args.append(state)
    if kind:
        predicates.append('kind=?'); args.append(kind)
    if before:
        predicates.append('seq<?'); args.append(before)
    where = ' WHERE ' + ' AND '.join(predicates) if predicates else ''
    with database() as db:
        rows = db.execute('SELECT seq,id,created,kind,code,fingerprint,state,revision,resolved_at FROM reports' + where +
            ' ORDER BY seq DESC LIMIT ?', [*args, min(100, limit)]).fetchall()
        counts = db.execute('SELECT kind,state,count(*) AS count FROM reports GROUP BY kind,state').fetchall()
    return {'reports': [dict(row) for row in rows], 'counts': [dict(row) for row in counts],
            'next_before': rows[-1]['seq'] if len(rows) == limit else None}


def get_report(report_id):
    with database() as db:
        row = db.execute('SELECT id,created,kind,code,fingerprint,state,revision,resolved_at,payload,policy,consent FROM reports WHERE id=?', (report_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    result['payload'] = json.loads(result['payload'])
    return result


def set_state(report_id, state, revision):
    with database() as db:
        changed = db.execute('UPDATE reports SET state=?,revision=revision+1,resolved_at=? WHERE id=? AND revision=?',
            (state, time.time() if state == 'resolved' else None, report_id, revision)).rowcount
    if changed:
        emit('report.resolved' if state == 'resolved' else 'report.reopened')
    return bool(changed)


class ReportMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith('/api/') or scope['path'].startswith(('/api/admin', '/api/diagnostics')):
            return await self.app(scope, receive, send)
        state = {}
        token = _context.set(state)
        started = False
        async def wrapped(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                status = message['status']
                owner = scope.get('state', {}).get('diagnostic_session_id')
                incomplete = state.get('outcome') in ('failed', 'partial', 'uncertain')
                if owner and (status >= 500 or status in (400, 408, 409) or incomplete):
                    headers = list(message.get('headers', []))
                    request_id = scope.get('state', {}).get('diagnostic_request_id')
                    try:
                        prepared = await asyncio.to_thread(prepare, owner, state.get('code', 'WRITE_INCOMPLETE' if incomplete else 'HTTP_ERROR'), status,
                                                          request_id, state.get('parser'), state.get('structure'),
                                                          state.get('operation'), state.get('outcome'))
                        if prepared.get('capture_id'):
                            headers.extend([(b'x-diagnostic-capture', prepared['capture_id'].encode()),
                                            (b'x-diagnostic-code', prepared['code'].encode())])
                        if prepared.get('report_id'):
                            headers.append((b'x-diagnostic-report', prepared['report_id'].encode()))
                        headers = [(k, v) for k, v in headers if k.lower() != b'cache-control']
                        headers.append((b'cache-control', b'no-store'))
                        message['headers'] = headers
                    except Exception:
                        # Even a reporting implementation failure must not
                        # replace or replay the original response.
                        emit('report.unavailable', status=503)
            await send(message)
        try:
            await self.app(scope, receive, wrapped)
        except Exception:
            if started:
                raise
            from backend.i18n import translate, negotiate_language
            state['code'] = 'INTERNAL_ERROR'
            language = negotiate_language(dict(scope.get('headers', [])).get(b'accept-language', b'').decode('latin1'))
            body = json.dumps({'detail': translate('reports.unexpected_error', language), 'code': 'INTERNAL_ERROR'}).encode()
            headers = [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]
            request_id = scope.get('state', {}).get('diagnostic_request_id')
            if request_id:
                headers.append((b'x-request-id', request_id.encode()))
            await wrapped({'type': 'http.response.start', 'status': 500, 'headers': headers})
            await wrapped({'type': 'http.response.body', 'body': body})
        finally:
            _context.reset(token)
