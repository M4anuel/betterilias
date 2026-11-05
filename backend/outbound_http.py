"""HTTPX transport admission, bounded safe-read retries and in-flight sharing.

ILIAS mutates state through some GET commands. Only explicitly known read-only
navigation is eligible for retries/coalescing. No response cache is retained.
"""
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import math
import random
from urllib.parse import parse_qsl, urlsplit
import weakref

import httpx

from backend.config import settings
from backend.outbound_budget import OutboundBudget, OutboundUnavailable
from backend.outbound_network import EgressTransport
from backend.observability import emit, mark_dispatch


def safe_read(request):
    if (request.method != 'GET' or request.headers.get('range') or request.headers.get('transfer-encoding')
            or request.headers.get('content-length', '0') != '0'):
        return False
    parts = urlsplit(str(request.url))
    base = urlsplit(settings.ilias_base_url)
    if (parts.scheme, parts.netloc) != (base.scheme, base.netloc):
        return False
    query = parse_qsl(parts.query, keep_blank_values=True)
    values = {key.lower(): value.lower() for key, value in query}
    # Reject duplicate keys and every unknown/state-setting parameter. In
    # particular: table sorting/filtering, downloads, logout and editor actions.
    if len(values) != len(query) or set(values) - {'baseclass', 'cmdclass', 'cmd', 'cmdnode', 'ref_id', 'ass_id', 'client_id'}:
        return False
    if parts.path != base.path.rstrip('/') + '/ilias.php':
        return False
    controller = values.get('cmdclass') or values.get('baseclass')
    command = values.get('cmd', '')
    return (controller, command) in {
        ('ilpersonaldesktopgui', ''), ('ilpersonaldesktopgui', 'jumptoselecteditems'),
        ('ilmembershipoverviewgui', ''),
        ('ilrepositorygui', ''), ('ilrepositorygui', 'view'),
        ('ilobjcoursegui', 'view'), ('ilobjfoldergui', 'view'),
        ('ilobjexercisegui', 'showoverview'), ('ilinfoscreengui', 'showsummary'),
    }


def retry_delay(header, attempt=0, *, now=None):
    """Honor delta-seconds and HTTP dates; invalid values use bounded backoff."""
    delay = None
    if header:
        try:
            if header.strip().isdigit():
                delay = float(header.strip())
            else:
                date = parsedate_to_datetime(header)
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                delay = max(0, date.timestamp() - (now if now is not None else datetime.now(timezone.utc).timestamp()))
        except (ValueError, TypeError, OverflowError):
            pass
    if delay is None or not math.isfinite(delay):
        delay = min(30, 2 ** attempt)
    # Jitter is additive: never retry before the server's advertised minimum.
    return delay + random.uniform(.05, .25)


class BudgetStream(httpx.AsyncByteStream):
    def __init__(self, stream, permit):
        self.stream, self.permit = stream, permit

    async def __aiter__(self):
        try:
            async for chunk in self.stream:
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self):
        if self.permit is not None:
            permit, self.permit = self.permit, None
            try:
                await self.stream.aclose()
            finally:
                await permit.close()


class PrefixStream(httpx.AsyncByteStream):
    def __init__(self, chunks, iterator, stream):
        self.chunks, self.iterator, self.stream = chunks, iterator, stream

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk
        async for chunk in self.iterator:
            yield chunk

    async def aclose(self):
        await self.stream.aclose()


@dataclass(frozen=True)
class ReadSnapshot:
    status: int
    headers: tuple
    body: bytes
    extensions: dict

    def response(self):
        # Transport bytes are raw (possibly compressed), so each HTTPX consumer
        # gets a fresh decoder/stream and its own cookie extraction.
        return httpx.Response(self.status, headers=self.headers,
                              stream=httpx.ByteStream(self.body), extensions=dict(self.extensions))


_flights = weakref.WeakKeyDictionary()


class BudgetTransport(httpx.AsyncBaseTransport):
    def __init__(self, identity, *, inner=None, budget=None, retries=None, max_bytes=None):
        self.identity = identity
        self.inner = inner or EgressTransport()
        self.budget = budget or OutboundBudget()
        self.retries = settings.outbound_read_retries if retries is None else retries
        self.max_bytes = settings.outbound_coalesce_max_bytes if max_bytes is None else max_bytes

    async def _send(self, request, readonly):
        for attempt in range(self.retries + 1):
            permit = await self.budget.acquire(self.identity)
            try:
                # Conservative: unknown native GET commands can mutate too.
                if not readonly:
                    mark_dispatch()
                response = await self.inner.handle_async_request(request)
            except BaseException:
                await permit.close()
                raise
            if response.is_closed:
                # Mock/custom transports may supply an already buffered body.
                await permit.close()
            else:
                response.stream = BudgetStream(response.stream, permit)
            if response.status_code not in (429, 503):
                return response
            emit('outbound.throttled', status=response.status_code)
            delay = retry_delay(response.headers.get('retry-after'), attempt)
            try:
                await self.budget.cooldown(delay)
            finally:
                await response.aclose()
            if not readonly or attempt == self.retries:
                raise OutboundUnavailable(delay, write_uncertain=not readonly)
            # Admission of the next attempt respects the shared cooldown. It
            # releases capacity while waiting and cannot bypass other tenants.
        raise AssertionError('unreachable')

    async def _snapshot(self, response):
        kind = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
        length = response.headers.get('content-length')
        if (response.status_code != 200 or kind not in ('text/html', 'application/xhtml+xml', 'application/json')
                or (length and (not length.isdigit() or int(length) > self.max_bytes))):
            return None
        chunks, size = [], 0
        iterator = response.stream.__aiter__()
        try:
            async for chunk in iterator:
                chunks.append(chunk)
                size += len(chunk)
                if size > self.max_bytes:
                    response.stream = PrefixStream(chunks, iterator, response.stream)
                    return None
            await response.aclose()
        except BaseException:
            await response.aclose()
            raise
        return ReadSnapshot(response.status_code, tuple(response.headers.raw), b''.join(chunks),
                            {key: value for key, value in response.extensions.items()
                             if key in ('http_version', 'reason_phrase')})

    async def handle_async_request(self, request):
        if hasattr(self.inner, 'prepare_request'):
            self.inner.prepare_request(request)
        readonly = safe_read(request)
        if not readonly or not self.max_bytes:
            return await self._send(request, readonly)
        loop = asyncio.get_running_loop()
        flights = _flights.setdefault(loop, {})
        # Exact headers include cookies, authentication, language and validators.
        # Only digests are retained; sharing never crosses credential generations.
        key = hashlib.sha256(repr((str(self.budget.path.resolve()), self.identity,
                                  str(request.url), tuple(request.headers.raw))).encode()).digest()
        existing = flights.get(key)
        if existing is not None:
            snapshot = await asyncio.shield(existing)
            if isinstance(snapshot, OutboundUnavailable):
                raise OutboundUnavailable(snapshot.retry_after, write_uncertain=snapshot.write_uncertain)
            if snapshot is not None:
                return snapshot.response()
            return await self._send(request, readonly)
        future = loop.create_future()
        flights[key] = future
        try:
            response = await self._send(request, readonly)
            snapshot = await self._snapshot(response)
            future.set_result(snapshot)
            return snapshot.response() if snapshot is not None else response
        except OutboundUnavailable as exc:
            # Share a rate-limit failure too: identical waiters must not each
            # start another retry sequence after the leader exhausts its budget.
            future.set_result(exc)
            raise
        finally:
            if not future.done():
                # A cancelled/failed leader must not cancel unrelated waiters;
                # they can perform their own budgeted safe read.
                future.set_result(None)
            flights.pop(key, None)

    async def aclose(self):
        await self.inner.aclose()
