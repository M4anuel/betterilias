"""Shared-local-volume coordination for multiple backend workers on one VPS.

Mount the same data AND coordination volumes in every replica. OS locks survive
slow operations without lease expiry and are released on process crashes.
This deliberately does not claim to support NFS or multiple VPSs.
"""
import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
import tempfile
import time
from contextlib import contextmanager, asynccontextmanager
from contextvars import ContextVar
from functools import wraps
from threading import get_ident
from backend.config import settings

_held = ContextVar('coordination_locks', default={})


class CoordinationBusy(Exception):
    pass


def _owner():
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    return (get_ident(), id(task))


class SharedLock:
    def __init__(self, key, timeout=60):
        self.key = hashlib.sha256(str(key).encode()).hexdigest()
        self.timeout, self.file = timeout, None

    def acquire(self):
        if _held.get().get(self.key) == _owner():
            return True
        settings.coordination_path.mkdir(parents=True, exist_ok=True)
        if self.file is None:
            self.file = open(settings.coordination_path / (self.key + '.lock'), 'a+b')
            # Windows also denies reads of a byte locked by another handle.
            # Inspect file size without reading the locked region.
            if os.fstat(self.file.fileno()).st_size == 0:
                try:
                    self.file.write(b'0')
                    self.file.flush()
                except PermissionError:
                    return False
        try:
            if os.name == 'nt':
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError):
            return False
        return True

    @contextmanager
    def owned(self):
        token = _held.set({**_held.get(), self.key: _owner()})
        try:
            yield
        finally:
            _held.reset(token)

    def close(self):
        if self.file:
            self.file.close()
            self.file = None

    @contextmanager
    def sync(self):
        started = time.monotonic()
        try:
            while not self.acquire():
                # Never block the event loop that owns a competing async lock.
                try:
                    asyncio.get_running_loop()
                except RuntimeError:
                    pass
                else:
                    raise CoordinationBusy()
                if time.monotonic() - started >= self.timeout:
                    raise CoordinationBusy()
                time.sleep(.025)
            with self.owned():
                yield
        finally:
            self.close()

    @asynccontextmanager
    async def async_(self):
        started = time.monotonic()
        try:
            while not self.acquire():
                if time.monotonic() - started >= self.timeout:
                    raise CoordinationBusy()
                await asyncio.sleep(.025)
            with self.owned():
                yield
        finally:
            self.close()


def coordinated(key):
    """Lock a complete read/modify/write operation; nested calls are reentrant."""
    def decorate(fn):
        if asyncio.iscoroutinefunction(fn):
            @wraps(fn)
            async def wrapped(*args, **kwargs):
                async with SharedLock(key(*args, **kwargs)).async_():
                    return await fn(*args, **kwargs)
        else:
            @wraps(fn)
            def wrapped(*args, **kwargs):
                with SharedLock(key(*args, **kwargs)).sync():
                    return fn(*args, **kwargs)
        return wrapped
    return decorate


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _database():
    settings.coordination_path.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.coordination_path / 'handoffs.sqlite3', timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS handoffs (digest TEXT PRIMARY KEY, session_id TEXT, expires REAL)')
    return db


def issue_handoff(session_id, ttl=60):
    code = secrets.token_urlsafe(32)
    db = _database()
    try:
        with db:
            db.execute('DELETE FROM handoffs WHERE expires <= ?', (time.time(),))
            db.execute('INSERT INTO handoffs VALUES (?, ?, ?)',
                       (hashlib.sha256(code.encode()).hexdigest(), session_id, time.time() + ttl))
    finally:
        db.close()
    return code


def claim_handoff(code):
    db = _database()
    try:
        with db:
            db.execute('BEGIN IMMEDIATE')
            digest = hashlib.sha256(code.encode()).hexdigest()
            row = db.execute('SELECT session_id, expires FROM handoffs WHERE digest=?', (digest,)).fetchone()
            db.execute('DELETE FROM handoffs WHERE digest=?', (digest,))
        return row[0] if row and row[1] > time.time() else None
    finally:
        db.close()
