"""Fair, bounded HTTP admission across workers sharing one local VPS volume.

SQLite stores only queue tokens, identity digests and aggregate counters. Fixed
OS-locked slots remain occupied through response-body consumption. A worker
crash releases its slots without a lease timeout; expired waiters are discarded.
"""
import asyncio
from contextlib import contextmanager, suppress
from dataclasses import dataclass
import hashlib
import logging
import math
from pathlib import Path
import secrets
import sqlite3
import time
import weakref

from backend.config import settings
from backend.coordination import SharedLock

logger = logging.getLogger('ilias.outbound')

class OutboundUnavailable(Exception):
    def __init__(self, retry_after=1, *, write_uncertain=False):
        super().__init__('Outbound ILIAS traffic temporarily unavailable')
        self.retry_after = max(1, math.ceil(retry_after))
        self.write_uncertain = write_uncertain


@dataclass(frozen=True)
class BudgetPolicy:
    concurrency: int = 6
    per_session: int = 2
    rate: float = 5.0
    queue_limit: int = 512
    session_queue_limit: int = 32
    queue_timeout: float = 20.0

    def __post_init__(self):
        if (self.concurrency < 1 or self.per_session < 1 or self.rate <= 0
                or self.queue_limit < 1 or self.session_queue_limit < 1 or self.queue_timeout <= 0
                or not math.isfinite(self.rate) or not math.isfinite(self.queue_timeout)):
            raise ValueError('Outbound budget limits must be finite and positive')
        object.__setattr__(self, 'rate', float(self.rate))
        object.__setattr__(self, 'queue_timeout', float(self.queue_timeout))

    @classmethod
    def configured(cls):
        return cls(settings.outbound_max_concurrency,
                   settings.outbound_per_session_concurrency,
                   settings.outbound_requests_per_second,
                   settings.outbound_queue_limit,
                   settings.outbound_per_session_queue_limit,
                   settings.outbound_queue_timeout_seconds)


class Permit:
    def __init__(self, budget, token, lock):
        self.budget, self.token, self.lock = budget, token, lock

    async def close(self):
        if self.lock is not None:
            self.lock.close()
            self.lock = None
            # The OS lock is authoritative; stale rows are reclaimed by the
            # next admission even if SQLite is briefly busy during cleanup.
            with suppress(sqlite3.OperationalError):
                await asyncio.shield(asyncio.to_thread(self.budget._remove, self.token))


_dispatchers = weakref.WeakKeyDictionary()


class Dispatcher:
    """One DB poll per worker/event loop, independent of waiting user count."""
    def __init__(self, budget):
        self.budget, self.pending, self.task = budget, {}, None
        self.retry_after = 1

    def add(self, token, future):
        self.pending[token] = future
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run())

    async def run(self):
        try:
            while self.pending:
                operation = asyncio.create_task(asyncio.to_thread(self.budget._step, tuple(self.pending)))
                try:
                    result = await asyncio.shield(operation)
                except asyncio.CancelledError:
                    with suppress(Exception):
                        result = await operation
                        if isinstance(result, Permit):
                            await result.close()
                    raise
                except sqlite3.OperationalError:
                    await asyncio.sleep(.025)
                    continue
                if isinstance(result, Permit):
                    future = self.pending.pop(result.token, None)
                    if future is None or future.done():
                        await result.close()
                    else:
                        future.set_result(result)
                else:
                    delay, self.retry_after = result
                    await asyncio.sleep(delay)
        except Exception as exc:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(exc)
            self.pending.clear()
        finally:
            # Do not keep a finished Task (and its event loop) in the weak-loop
            # registry after the last waiter has received a permit.
            self.task = None


class OutboundBudget:
    def __init__(self, directory=None, policy=None):
        self.directory = Path(directory or settings.coordination_path)
        self.path = self.directory / 'outbound.sqlite3'
        self.policy = policy or BudgetPolicy.configured()

    @contextmanager
    def _database(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=.25)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=NORMAL')
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS outbound_state '
                       '(id INTEGER PRIMARY KEY, next_start REAL, cooldown REAL, grants INTEGER, '
                       'rejected INTEGER, wait_seconds REAL, throttles INTEGER, config TEXT)')
            config = repr(self.policy)
            db.execute('INSERT OR IGNORE INTO outbound_state VALUES (1,0,0,0,0,0,0,?)', (config,))
            if db.execute('SELECT config FROM outbound_state WHERE id=1').fetchone()[0] != config:
                # Different worker budgets would make the aggregate limit misleading.
                logger.error('Outbound budget settings differ from the shared database. '
                             'Stop all workers and follow docs/OUTBOUND_TRAFFIC.md before changing limits.')
                raise OutboundUnavailable()
            db.execute('CREATE TABLE IF NOT EXISTS outbound_queue '
                       '(seq INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, tenant TEXT, '
                       'created REAL, expires REAL)')
            db.execute('CREATE INDEX IF NOT EXISTS outbound_queue_tenant ON outbound_queue(tenant)')
            db.execute('CREATE TABLE IF NOT EXISTS outbound_slots '
                       '(slot INTEGER PRIMARY KEY, token TEXT, tenant TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS outbound_tenants '
                       '(tenant TEXT PRIMARY KEY, served INTEGER, seen REAL)')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _enqueue(self, token, tenant, deadline):
        now = time.time()
        with self._database() as db:
            db.execute('DELETE FROM outbound_queue WHERE expires <= ?', (now,))
            db.execute('DELETE FROM outbound_tenants WHERE seen < ? AND tenant NOT IN '
                       '(SELECT tenant FROM outbound_queue UNION SELECT tenant FROM outbound_slots)', (now - 3600,))
            count = db.execute('SELECT COUNT(*), COALESCE(SUM(tenant=?),0) FROM outbound_queue', (tenant,)).fetchone()
            if count[0] >= self.policy.queue_limit or count[1] >= self.policy.session_queue_limit:
                db.execute('UPDATE outbound_state SET rejected=rejected+1 WHERE id=1')
                return False
            db.execute('INSERT INTO outbound_queue(token,tenant,created,expires) VALUES (?,?,?,?)',
                       (token, tenant, now, deadline))
            db.execute('INSERT INTO outbound_tenants VALUES (?,0,?) ON CONFLICT(tenant) '
                       'DO UPDATE SET seen=excluded.seen', (tenant, now))
        return True

    def _remove(self, token):
        # A released OS slot can already have a new owner: delete by token only.
        with self._database() as db:
            db.execute('DELETE FROM outbound_queue WHERE token=?', (token,))
            db.execute('DELETE FROM outbound_slots WHERE token=?', (token,))

    def _step(self, tokens):
        available = None
        try:
            with self._database() as db:
                now = time.time()
                db.execute('DELETE FROM outbound_queue WHERE expires <= ?', (now,))
                next_start, cooldown, grants = db.execute(
                    'SELECT next_start,cooldown,grants FROM outbound_state WHERE id=1').fetchone()
                delay = max(next_start, cooldown) - now
                if delay > 0:
                    return min(.1, delay), max(1, cooldown - now)
                # Inspect locks, not elapsed leases. Downloads can last arbitrarily
                # long and a stalled event loop must not release an active slot.
                for slot in range(self.policy.concurrency):
                    lock = SharedLock(f'outbound:{self.path.resolve()}:{slot}', directory=self.directory)
                    if lock.acquire():
                        db.execute('DELETE FROM outbound_slots WHERE slot=?', (slot,))
                        if available is None:
                            available = (slot, lock)
                        else:
                            lock.close()
                    else:
                        lock.close()
                if available is None:
                    return .025, 1
                chosen = db.execute('''
                    SELECT q.token,q.tenant,q.created FROM outbound_queue q
                    JOIN outbound_tenants t ON t.tenant=q.tenant
                    WHERE (SELECT COUNT(*) FROM outbound_slots s WHERE s.tenant=q.tenant) < ?
                    ORDER BY t.served,q.seq LIMIT 1
                ''', (self.policy.per_session,)).fetchone()
                if chosen is None or chosen[0] not in tokens:
                    return .025, 1
                token = chosen[0]
                slot, lock = available
                db.execute('INSERT INTO outbound_slots VALUES (?,?,?)', (slot, token, chosen[1]))
                db.execute('DELETE FROM outbound_queue WHERE token=?', (token,))
                db.execute('UPDATE outbound_tenants SET served=?,seen=? WHERE tenant=?',
                           (grants + 1, now, chosen[1]))
                db.execute('UPDATE outbound_state SET next_start=?, grants=grants+1, '
                           'wait_seconds=wait_seconds+? WHERE id=1',
                           (now + 1 / self.policy.rate, max(0, now - chosen[2])))
            permit = Permit(self, token, lock)
            available = None
            return permit
        finally:
            if available is not None:
                available[1].close()

    async def acquire(self, identity):
        tenant = hashlib.sha256(identity.encode()).hexdigest()
        token = secrets.token_hex(16)
        deadline = time.time() + self.policy.queue_timeout
        permit = None
        future, dispatcher = None, None
        try:
            while True:
                task = asyncio.create_task(asyncio.to_thread(self._enqueue, token, tenant, deadline))
                try:
                    admitted = await asyncio.shield(task)
                    break
                except sqlite3.OperationalError:
                    if time.time() >= deadline:
                        raise OutboundUnavailable() from None
                    await asyncio.sleep(.025)
                except asyncio.CancelledError:
                    with suppress(Exception):
                        await task
                    raise
            if not admitted:
                raise OutboundUnavailable()
            loop = asyncio.get_running_loop()
            workers = _dispatchers.setdefault(loop, {})
            key = (str(self.path.resolve()), self.policy)
            dispatcher = workers.setdefault(key, Dispatcher(self))
            future = loop.create_future()
            dispatcher.add(token, future)
            try:
                permit = await asyncio.wait_for(future, max(0, deadline - time.time()))
                return permit
            except TimeoutError:
                raise OutboundUnavailable(dispatcher.retry_after) from None
        finally:
            if permit is None:
                if dispatcher is not None:
                    dispatcher.pending.pop(token, None)
                # Cancellation can race delivery: the dispatcher may already
                # have granted a slot even though this task never received it.
                if future is not None and future.done() and not future.cancelled():
                    with suppress(Exception):
                        delivered = future.result()
                        if isinstance(delivered, Permit):
                            await delivered.close()
                with suppress(sqlite3.Error):
                    await asyncio.shield(asyncio.to_thread(self._remove, token))

    async def cooldown(self, seconds):
        def update():
            with self._database() as db:
                db.execute('UPDATE outbound_state SET cooldown=MAX(cooldown,?), throttles=throttles+1 WHERE id=1',
                           (time.time() + seconds,))
        await asyncio.to_thread(update)

    def snapshot(self):
        """Local operator/load-test use only. No public endpoint or identities."""
        with self._database() as db:
            row = db.execute('SELECT grants,rejected,wait_seconds,throttles,cooldown FROM outbound_state WHERE id=1').fetchone()
            queued = db.execute('SELECT COUNT(*) FROM outbound_queue WHERE expires>?', (time.time(),)).fetchone()[0]
        return dict(zip(('requests', 'rejected', 'queue_wait_seconds', 'throttles', 'cooldown_until'), row), queued=queued)
