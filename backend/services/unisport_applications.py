"""Short-lived private registration snapshots, never used to authorize writes."""
import asyncio
from contextlib import asynccontextmanager
import json
import time

from backend.coordination import SharedLock
from backend.services import unisport_auth as auth
from backend.services.unisport_client import UnisportReadError

TTL = 60


def account_key(account):
    return auth.digest(json.dumps([account.subject, account.affiliation]))


def tables(db):
    db.execute('CREATE TABLE IF NOT EXISTS unisport_applications_cache (key TEXT PRIMARY KEY, owner TEXT, account TEXT, fetched REAL, data TEXT)')


def drop(account=None, owner=None):
    with auth.database() as db:
        tables(db)
        if account is not None:
            db.execute('DELETE FROM unisport_applications_cache WHERE account=?', (account_key(account),))
        elif owner is not None:
            db.execute('DELETE FROM unisport_applications_cache WHERE owner=?', (owner,))


@asynccontextmanager
async def mutation(account):
    async with SharedLock('unisport-applications:' + account_key(account), timeout=50).async_():
        drop(account=account)
        try:
            yield
        finally:
            drop(account=account)


async def invalidate(account):
    async with SharedLock('unisport-applications:' + account_key(account), timeout=50).async_():
        drop(account=account)


async def snapshot(owner, state, account, locale, loader, validate, *, refresh=False):
    key = auth.digest(json.dumps([owner, state, account_key(account), locale]))
    requested = time.time()
    async with SharedLock('unisport-applications:' + account_key(account), timeout=50).async_():
        validate()
        with auth.database() as db:
            tables(db)
            db.execute('DELETE FROM unisport_applications_cache WHERE fetched < ?', (time.time() - TTL,))
            row = db.execute('SELECT fetched,data FROM unisport_applications_cache WHERE key=?', (key,)).fetchone()
        if row and (not refresh or row[0] >= requested):
            try:
                items = json.loads(row[1])
                if isinstance(items, list):
                    return {'items': items, 'fetched_at': row[0]}
            except ValueError:
                pass
        try:
            async with asyncio.timeout(45):
                items = await loader()
        except TimeoutError:
            raise UnisportReadError('upstream_unavailable') from None
        validate()
        fetched = time.time()
        with auth.database() as db:
            tables(db)
            db.execute('INSERT OR REPLACE INTO unisport_applications_cache VALUES (?, ?, ?, ?, ?)',
                (key, owner, account_key(account), fetched, json.dumps(items)))
            db.execute('DELETE FROM unisport_applications_cache WHERE key IN (SELECT key FROM unisport_applications_cache ORDER BY fetched DESC LIMIT -1 OFFSET 2000)')
        return {'items': items, 'fetched_at': fetched}
