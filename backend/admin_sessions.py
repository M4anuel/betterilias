"""Short-lived administrator capabilities, separate from all ILIAS sessions."""
from contextlib import contextmanager
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time

from backend.config import settings

COOKIE = 'betterilias_admin'
TTL = 1800


def enabled():
    return len(settings.admin_api_key) >= 43


@contextmanager
def database():
    directory = settings.coordination_path
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / 'admin-sessions.sqlite3'
    db = sqlite3.connect(path, timeout=2)
    try:
        if os.name != 'nt':
            path.chmod(0o600)
        db.execute('PRAGMA secure_delete=ON')
        db.execute('CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, expires REAL NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS failures (id INTEGER PRIMARY KEY, created REAL NOT NULL)')
        with db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
            db.execute('DELETE FROM failures WHERE created <= ?', (time.time() - 60,))
            yield db
    finally:
        db.close()


def digest(token):
    return hmac.new(settings.admin_api_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def issue():
    token = secrets.token_urlsafe(32)
    expires = time.time() + TTL
    with database() as db:
        db.execute('INSERT INTO sessions VALUES (?,?)', (digest(token), expires))
        # Bound storage even if a valid administrator repeatedly signs in.
        db.execute('DELETE FROM sessions WHERE digest IN '
                   '(SELECT digest FROM sessions ORDER BY expires DESC LIMIT -1 OFFSET 32)')
    return token, expires


def expires_at(token):
    if not enabled() or not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        return None
    with database() as db:
        row = db.execute('SELECT expires FROM sessions WHERE digest=?', (digest(token),)).fetchone()
    return row[0] if row else None


def revoke(token):
    if isinstance(token, str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        with database() as db:
            db.execute('DELETE FROM sessions WHERE digest=?', (digest(token),))


def record_failure():
    """No IP/user identifier; valid keys are never locked out by this counter."""
    with database() as db:
        count = db.execute('SELECT count(*) FROM failures').fetchone()[0]
        if count < 10:
            db.execute('INSERT INTO failures(created) VALUES (?)', (time.time(),))
    return count >= 10


def prune():
    if (settings.coordination_path / 'admin-sessions.sqlite3').exists():
        with database():
            pass
