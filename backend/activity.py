"""Private, bounded connection/account usage. Names never enter diagnostic events."""
from contextlib import contextmanager
import hashlib
import hmac
import os
import secrets
import re
import sqlite3
import time
import unicodedata

from backend.config import settings

RETENTION = 86400
MAX_ROWS = 100000
ACCOUNT_RETENTION = 30 * 86400
MAX_ACCOUNTS = 10000


@contextmanager
def database():
    directory = settings.observability_path
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / 'activity.sqlite3'
    db = sqlite3.connect(path, timeout=.2)
    try:
        db.execute('PRAGMA journal_mode=DELETE')
        db.execute('PRAGMA secure_delete=ON')
        size = db.execute('PRAGMA page_size').fetchone()[0]
        db.execute(f'PRAGMA max_page_count={32 * 1024 * 1024 // size}')
        db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS activity '
                   "(minute INTEGER NOT NULL, owner TEXT NOT NULL, seen REAL NOT NULL, "
                   "kind TEXT NOT NULL DEFAULT 'connection', PRIMARY KEY(minute,owner))")
        if 'kind' not in {row[1] for row in db.execute('PRAGMA table_info(activity)')}:
            try:
                db.execute("ALTER TABLE activity ADD COLUMN kind TEXT NOT NULL DEFAULT 'connection'")
            except sqlite3.OperationalError as exc:
                if 'duplicate column' not in str(exc).lower():
                    raise
        db.execute('CREATE INDEX IF NOT EXISTS activity_seen ON activity(seen)')
        db.execute('CREATE TABLE IF NOT EXISTS account_usage '
                   '(account TEXT PRIMARY KEY, name TEXT NOT NULL, search_name TEXT NOT NULL, seen REAL NOT NULL)')
        db.execute('CREATE INDEX IF NOT EXISTS account_usage_seen ON account_usage(seen)')
        db.execute("INSERT OR IGNORE INTO meta VALUES('secret',?)", (secrets.token_hex(32),))
        if os.name != 'nt':
            directory.chmod(0o700)
            path.chmod(0o600)
        with db:
            yield db
    finally:
        db.close()


def _prune(db, now):
    # Remove all samples collected by the retired persistent-browser feature.
    # Keep the column for backwards-compatible migration, not new tracking.
    db.execute("DELETE FROM activity WHERE kind != 'connection'")
    db.execute('DELETE FROM activity WHERE seen <= ?', (now - RETENTION,))
    db.execute('DELETE FROM account_usage WHERE seen <= ?', (now - ACCOUNT_RETENTION,))
    db.execute('DELETE FROM account_usage WHERE account IN '
               '(SELECT account FROM account_usage ORDER BY seen DESC LIMIT -1 OFFSET ?)', (MAX_ACCOUNTS,))
    excess = db.execute('SELECT count(*) FROM activity').fetchone()[0] - MAX_ROWS
    if excess > 0:
        db.execute('DELETE FROM activity WHERE rowid IN '
                   '(SELECT rowid FROM activity ORDER BY seen LIMIT ?)', (excess,))


def account_key(issuer, client, subject):
    """Derive a per-instance analytics key from a server-verified OIDC subject.

    Disabled dashboards collect no named account records. Failure must never
    break login. Neither the subject nor this key belongs in diagnostic events.
    """
    if len(settings.admin_api_key) < 43 or not isinstance(subject, str) or not subject:
        return None
    try:
        with database() as db:
            secret = db.execute("SELECT value FROM meta WHERE key='secret'").fetchone()[0]
        return hmac.new(bytes.fromhex(secret), ('account-v1\0' + issuer + '\0' + client + '\0' + subject).encode(), hashlib.sha256).hexdigest()
    except (OSError, sqlite3.Error, ValueError, UnicodeError):
        return None


def record(session_id, *, account=None, name=None):
    """Called only after tenant credential validation, on the dependency thread pool.

    Failure is deliberately isolated from the student action. No credential,
    path, IP, account name or owner digest enters ordinary diagnostic events.
    """
    try:
        now = time.time()
        with database() as db:
            secret = db.execute("SELECT value FROM meta WHERE key='secret'").fetchone()[0]
            owner = hmac.new(bytes.fromhex(secret), session_id.encode(), hashlib.sha256).hexdigest()
            db.execute('INSERT INTO activity(minute,owner,seen) VALUES(?,?,?) ON CONFLICT(minute,owner) '
                       'DO UPDATE SET seen=excluded.seen', (int(now // 60), owner, now))
            if len(settings.admin_api_key) >= 43 and isinstance(account, str) and re.fullmatch(r'[a-f0-9]{64}', account):
                display = ''.join(c for c in name if c.isprintable()).strip()[:300] if isinstance(name, str) else ''
                search = unicodedata.normalize('NFKC', display).casefold()
                db.execute('INSERT INTO account_usage VALUES(?,?,?,?) ON CONFLICT(account) DO UPDATE SET '
                           "name=CASE WHEN excluded.name!='' THEN excluded.name ELSE account_usage.name END, "
                           "search_name=CASE WHEN excluded.name!='' THEN excluded.search_name ELSE account_usage.search_name END, "
                           'seen=excluded.seen', (account, display, search, now))
            _prune(db, now)
    except (OSError, sqlite3.Error, ValueError):
        pass


def prune():
    with database() as db:
        _prune(db, time.time())


def summary():
    now = time.time()
    with database() as db:
        _prune(db, now)
        def series(kind, window, step):
            start = now - window
            values = dict(db.execute('SELECT min(?,CAST((seen-?)/? AS INTEGER)),count(DISTINCT owner) '
                                     'FROM activity WHERE seen > ? AND kind=? GROUP BY 1',
                                     (window // step - 1, start, step, start, kind)))
            return [{'start': start + index * step, 'end': start + (index + 1) * step,
                     'count': values.get(index, 0)} for index in range(window // step)]

        def counts(kind):
            totals = db.execute('SELECT count(DISTINCT owner) FROM activity WHERE kind=?', (kind,)).fetchone()[0]
            active = db.execute('SELECT count(DISTINCT owner) FROM activity WHERE kind=? AND seen > ?',
                                (kind, now - 300)).fetchone()[0]
            return {'active': active, 'last_24_hours': totals, 'as_of': now,
                    'recent': series(kind, 3600, 300), 'hourly': series(kind, 86400, 3600)}

        return counts('connection')


def account_summary():
    now = time.time()
    with database() as db:
        _prune(db, now)
        return {'active': db.execute('SELECT count(*) FROM account_usage WHERE seen>?', (now-300,)).fetchone()[0],
                'last_24_hours': db.execute('SELECT count(*) FROM account_usage WHERE seen>?', (now-86400,)).fetchone()[0],
                'retained': db.execute('SELECT count(*) FROM account_usage').fetchone()[0],
                'retention_days': ACCOUNT_RETENTION // 86400, 'as_of': now}


def account_page(query='', offset=0, limit=50):
    # Queries travel in POST bodies, never request URLs or ordinary diagnostics.
    needle = unicodedata.normalize('NFKC', query.strip()).casefold()
    pattern = '%' + needle.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    with database() as db:
        _prune(db, time.time())
        total = db.execute("SELECT count(*) FROM account_usage WHERE search_name LIKE ? ESCAPE '\\'", (pattern,)).fetchone()[0]
        rows = db.execute("SELECT account,name,seen FROM account_usage WHERE search_name LIKE ? ESCAPE '\\' "
                          'ORDER BY seen DESC,account LIMIT ? OFFSET ?', (pattern, limit, offset)).fetchall()
    return {'accounts': [{'id': key, 'name': name, 'last_seen': seen} for key,name,seen in rows],
            'total': total, 'offset': offset, 'limit': limit, 'retention_days': ACCOUNT_RETENTION // 86400}
