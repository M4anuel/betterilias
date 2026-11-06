import asyncio
from dataclasses import replace
from datetime import datetime, timezone
from email.utils import format_datetime
import gzip
import multiprocessing
import os
import sqlite3
import threading
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.outbound_budget import BudgetPolicy, OutboundBudget, OutboundUnavailable
from backend.outbound_http import BudgetTransport, retry_delay, safe_read


READ = settings.ilias_base_url + '/ilias.php?baseClass=ilRepositoryGUI&ref_id=42'


@pytest.fixture
def budget(tmp_path):
    return OutboundBudget(tmp_path, BudgetPolicy(concurrency=3, per_session=1, rate=1000,
                          queue_limit=200, session_queue_limit=100, queue_timeout=4))


def client(budget, handler, identity='alice', **kwargs):
    return httpx.AsyncClient(transport=BudgetTransport(identity, budget=budget,
                             inner=httpx.MockTransport(handler), **kwargs))


def test_retry_after_formats_and_invalid_values():
    assert 7 <= retry_delay('7') <= 7.25
    date = format_datetime(datetime.fromtimestamp(1010, timezone.utc), usegmt=True)
    assert 10 <= retry_delay(date, now=1000) <= 10.25
    for value in (None, '', '-5', 'nan', 'inf', 'invalid', '9' * 500):
        assert 4 <= retry_delay(value, attempt=2) <= 4.25
    assert 0 <= retry_delay(date, now=2000) <= .25


@pytest.mark.parametrize('method,url,headers', [
    ('POST', READ, {}), ('DELETE', READ, {}),
    ('GET', READ + '&cmd=delete', {}), ('GET', READ + '&cmd=logout', {}),
    ('GET', READ + '&cmd=downloadReturned', {}), ('GET', READ + '&new_type=fold', {}),
    ('GET', READ + '&cmd=members', {}), ('GET', READ + '&exc_mem_table_nav=name:asc:0', {}),
    ('GET', READ + '&CMD=saveStatusAll', {}), ('GET', READ + '&ref_id=43', {}),
    ('GET', 'https://other.example/ilias.php?baseClass=ilRepositoryGUI', {}),
    ('GET', READ, {'Range': 'bytes=0-10'}),
])
def test_stateful_or_unknown_requests_are_never_replayed(method, url, headers):
    assert not safe_read(httpx.Request(method, url, headers=headers))


@pytest.mark.asyncio
async def test_streams_hold_capacity_until_closed(budget):
    budget.policy = replace(budget.policy, concurrency=1)
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'one'
            yield b'two'
    async def respond(request):
        return httpx.Response(200, stream=Stream(), headers={'Content-Type': 'application/octet-stream'})
    async with client(budget, respond) as http:
        first = await http.send(http.build_request('GET', READ + '&cmd=sendfile'), stream=True)
        pending = asyncio.create_task(http.get(READ + '&cmd=sendfile'))
        await asyncio.sleep(.1)
        assert not pending.done()
        assert budget.snapshot()['requests'] == 1
        await first.aclose()
        assert (await pending).content == b'onetwo'
    assert budget.snapshot()['requests'] == 2


@pytest.mark.asyncio
async def test_fair_turns_and_per_session_capacity(budget):
    budget.policy = replace(budget.policy, concurrency=1)
    held = await budget.acquire('alice')
    order = []
    async def work(tenant):
        permit = await budget.acquire(tenant)
        order.append(tenant)
        await asyncio.sleep(.01)
        await permit.close()
    jobs = [asyncio.create_task(work('alice')) for _ in range(5)]
    await asyncio.sleep(.08)
    jobs.append(asyncio.create_task(work('bob')))
    await asyncio.sleep(.08)
    await held.close()
    await asyncio.gather(*jobs)
    assert order[0] == 'bob'
    assert order.count('alice') == 5
    assert budget.snapshot()['queued'] == 0


@pytest.mark.asyncio
async def test_per_session_cap_leaves_room_for_another_user(budget):
    held = await budget.acquire('alice')
    pending = asyncio.create_task(budget.acquire('alice'))
    await asyncio.sleep(.05)
    bob = await budget.acquire('bob')
    assert not pending.done()
    await bob.close()
    await held.close()
    await (await pending).close()


@pytest.mark.asyncio
async def test_queue_limits_and_cancel_cleanup(budget):
    budget.policy = replace(budget.policy, concurrency=1, session_queue_limit=1, queue_limit=2)
    held = await budget.acquire('alice')
    queued = asyncio.create_task(budget.acquire('alice'))
    await asyncio.sleep(.08)
    with pytest.raises(OutboundUnavailable):
        await budget.acquire('alice')
    other = asyncio.create_task(budget.acquire('bob'))
    await asyncio.sleep(.08)
    with pytest.raises(OutboundUnavailable):
        await budget.acquire('charlie')
    for task in (queued, other):
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    await held.close()
    assert budget.snapshot()['queued'] == 0
    assert budget.snapshot()['rejected'] == 2
    await (await budget.acquire('charlie')).close()


@pytest.mark.asyncio
async def test_global_spacing_and_cooldown_timeout(budget):
    budget.policy = replace(budget.policy, rate=20, queue_timeout=.2)
    times = []
    for tenant in ('alice', 'bob', 'charlie'):
        permit = await budget.acquire(tenant)
        times.append(time.monotonic())
        await permit.close()
    assert all(b - a >= .035 for a, b in zip(times, times[1:]))
    await budget.cooldown(2)
    with pytest.raises(OutboundUnavailable) as error:
        await budget.acquire('bob')
    assert error.value.retry_after >= 1
    assert budget.snapshot()['queued'] == 0


@pytest.mark.asyncio
async def test_identical_reads_coalesce_without_crossing_credentials(budget):
    calls = []
    body = gzip.compress(b'<html>private content</html>')
    async def respond(request):
        calls.append(request.headers.get('cookie'))
        await asyncio.sleep(.1)
        return httpx.Response(200, stream=httpx.ByteStream(body),
                              headers={'Content-Type': 'text/html', 'Content-Encoding': 'gzip',
                                       'Set-Cookie': 'rotated=1; Path=/'})
    async with client(budget, respond) as first, client(budget, respond) as second:
        responses = await asyncio.gather(*[http.get(READ, headers={'Cookie': 'PHPSESSID=alice'})
                                          for http in (first, second) for _ in range(4)])
        assert len(calls) == 1
        assert all(response.content == b'<html>private content</html>' for response in responses)
        assert first.cookies['rotated'] == second.cookies['rotated'] == '1'
        await asyncio.gather(first.get(READ, headers={'Cookie': 'PHPSESSID=new'}),
                             second.get(READ, headers={'Cookie': 'PHPSESSID=other'}))
        assert len(calls) == 3
        # Completed reads are not cached, even with unchanged credentials.
        await first.get(READ, headers={'Cookie': 'PHPSESSID=alice'})
        assert len(calls) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [{'Content-Type': 'application/octet-stream'},
                                    {'Content-Type': 'text/html', 'Content-Length': '100'}])
async def test_large_and_download_responses_are_not_shared(budget, headers):
    count = 0
    async def respond(request):
        nonlocal count
        count += 1
        await asyncio.sleep(.05)
        return httpx.Response(200, content=b'0123456789', headers=headers)
    async with client(budget, respond, max_bytes=5) as http:
        responses = await asyncio.gather(http.get(READ), http.get(READ))
    assert count == 2
    assert [response.content for response in responses] == [b'0123456789'] * 2


@pytest.mark.asyncio
async def test_unknown_length_overflow_preserves_complete_stream(budget):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(3):
                yield b'abcd'
    async def respond(request):
        return httpx.Response(200, stream=Stream(), headers={'Content-Type': 'text/html'})
    async with client(budget, respond, max_bytes=5) as http:
        assert (await http.get(READ)).content == b'abcd' * 3
    await (await budget.acquire('alice')).close()


@pytest.mark.asyncio
async def test_waiter_cancel_does_not_cancel_shared_read(budget):
    started, release = asyncio.Event(), asyncio.Event()
    async def respond(request):
        started.set()
        await release.wait()
        return httpx.Response(200, text='ok', headers={'Content-Type': 'text/html'})
    async with client(budget, respond) as http:
        leader = asyncio.create_task(http.get(READ))
        await started.wait()
        waiter = asyncio.create_task(http.get(READ))
        await asyncio.sleep(.02)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        release.set()
        assert (await leader).text == 'ok'


@pytest.mark.asyncio
async def test_cancelled_leader_releases_capacity_and_waiter_recovers(budget):
    started = asyncio.Event()
    calls = 0
    async def respond(request):
        nonlocal calls
        calls += 1
        started.set()
        if calls == 1:
            await asyncio.Event().wait()
        return httpx.Response(200, text='ok', headers={'Content-Type': 'text/html'})
    async with client(budget, respond) as http:
        leader = asyncio.create_task(http.get(READ))
        await started.wait()
        waiter = asyncio.create_task(http.get(READ))
        await asyncio.sleep(.02)
        leader.cancel()
        with pytest.raises(asyncio.CancelledError):
            await leader
        assert (await waiter).text == 'ok'
    assert calls == 2
    assert budget.snapshot()['queued'] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [429, 503])
async def test_safe_read_retries_with_shared_backoff(budget, status):
    calls = []
    async def respond(request):
        calls.append(time.monotonic())
        return httpx.Response(status if len(calls) == 1 else 200,
                              headers={'Retry-After': '0'}, text='ok')
    async with client(budget, respond) as http:
        assert (await http.get(READ)).status_code == 200
    assert len(calls) == 2
    assert calls[1] - calls[0] >= .05
    assert budget.snapshot()['throttles'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('method,suffix', [('POST', ''), ('GET', '&cmd=saveStatusAll'), ('GET', '&cmd=members')])
async def test_writes_and_unknown_gets_send_once(budget, method, suffix):
    calls = []
    async def respond(request):
        calls.append(request)
        return httpx.Response(429, headers={'Retry-After': '0'})
    async with client(budget, respond) as http:
        with pytest.raises(OutboundUnavailable) as error:
            await http.request(method, READ + suffix)
    assert len(calls) == 1
    assert error.value.write_uncertain


@pytest.mark.asyncio
async def test_forbidden_and_network_errors_do_not_trigger_retry(budget):
    calls = 0
    async def forbidden(request):
        nonlocal calls
        calls += 1
        return httpx.Response(403)
    async with client(budget, forbidden) as http:
        assert (await http.get(READ)).status_code == 403
    async def failed(request):
        nonlocal calls
        calls += 1
        raise httpx.ReadError('lost connection')
    async with client(budget, failed) as http:
        with pytest.raises(httpx.ReadError):
            await http.get(READ)
    assert calls == 2
    await (await budget.acquire('alice')).close()


@pytest.mark.asyncio
async def test_concurrent_rate_limited_read_has_one_retry_sequence(budget):
    calls = 0
    async def respond(request):
        nonlocal calls
        calls += 1
        await asyncio.sleep(.02)
        return httpx.Response(429, headers={'Retry-After': '0'})
    async with client(budget, respond, retries=1) as http:
        results = await asyncio.gather(*(http.get(READ) for _ in range(10)), return_exceptions=True)
    assert all(isinstance(result, OutboundUnavailable) for result in results)
    assert calls == 2


@pytest.mark.asyncio
async def test_cancel_during_threaded_slot_grant_cannot_leak_slot(budget, monkeypatch):
    budget.policy = replace(budget.policy, concurrency=1)
    granted, finish = threading.Event(), threading.Event()
    original = budget._step
    def slow(tokens):
        result = original(tokens)
        if hasattr(result, 'lock'):
            granted.set()
            finish.wait(timeout=5)
        return result
    monkeypatch.setattr(budget, '_step', slow)
    pending = asyncio.create_task(budget.acquire('alice'))
    assert await asyncio.to_thread(granted.wait, 3)
    pending.cancel()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    monkeypatch.setattr(budget, '_step', original)
    await (await budget.acquire('bob')).close()
    assert budget.snapshot()['queued'] == 0


@pytest.mark.asyncio
async def test_shared_state_has_only_digests_and_mismatched_workers_fail_closed(budget):
    secret = 'PHPSESSID=private-native-credential'
    await (await budget.acquire(secret)).close()
    with sqlite3.connect(budget.path) as db:
        dump = '\n'.join(db.iterdump())
    assert secret not in dump and 'private-native-credential' not in dump
    other = OutboundBudget(budget.directory, replace(budget.policy, concurrency=1))
    with pytest.raises(OutboundUnavailable):
        await other.acquire('bob')


@pytest.mark.asyncio
async def test_actual_session_clients_use_budget_for_redirect_hops(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path))
    monkeypatch.setattr(settings, 'outbound_requests_per_second', 1000)
    calls = []
    def respond(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(302, headers={'Location': READ})
        return httpx.Response(200, text='ok', headers={'Content-Type': 'text/html'})
    from backend.outbound_network import EgressTransport
    monkeypatch.setattr('backend.outbound_http.EgressTransport', lambda: EgressTransport(inner=httpx.MockTransport(respond)))
    manager = SessionManager('alice')
    monkeypatch.setattr(manager, 'load_cookies', lambda: {'PHPSESSID': 'private-session'})
    monkeypatch.setattr(manager, 'load_metadata', lambda: {})
    async with manager.get_http_client() as http:
        assert (await http.get(READ)).text == 'ok'
    assert len(calls) == 2
    assert all(request.headers['cookie'] == 'PHPSESSID=private-session' for request in calls)
    assert OutboundBudget(tmp_path).snapshot()['requests'] == 2


@pytest.mark.asyncio
async def test_download_burst_saturates_but_never_exceeds_limits(budget):
    active, peak, tenants, tenant_peak = 0, 0, {}, 0
    class Body(httpx.AsyncByteStream):
        def __init__(self, tenant):
            self.tenant, self.closed = tenant, False
        async def __aiter__(self):
            await asyncio.sleep(.12)
            yield b'file'
        async def aclose(self):
            nonlocal active
            if not self.closed:
                self.closed = True
                active -= 1
                tenants[self.tenant] -= 1
    async def respond(request):
        nonlocal active, peak, tenant_peak
        tenant = request.headers['cookie']
        active += 1
        tenants[tenant] = tenants.get(tenant, 0) + 1
        peak = max(peak, active)
        tenant_peak = max(tenant_peak, tenants[tenant])
        return httpx.Response(200, stream=Body(tenant))
    async def download_user(index):
        async with client(budget, respond, identity=str(index)) as http:
            await asyncio.gather(*(http.get(READ + '&cmd=sendfile', headers={'Cookie': str(index)}) for _ in range(3)))
    await asyncio.gather(*(download_user(index) for index in range(8)))
    assert peak == budget.policy.concurrency
    assert tenant_peak == budget.policy.per_session
    assert active == 0


@pytest.mark.asyncio
async def test_rate_limit_does_not_validate_incoming_auth_cookies(budget, monkeypatch, tmp_path):
    manager = SessionManager('alice', cookie_file=tmp_path / 'cookies.json')
    monkeypatch.setattr(manager, 'load_cookies', lambda: {'PHPSESSID': 'alice', '_shibsession_test': 'present'})
    monkeypatch.setattr(manager, 'get_http_client', lambda: client(budget,
        lambda request: httpx.Response(429, headers={'Retry-After': '100'}), retries=0))
    with pytest.raises(OutboundUnavailable):
        await manager.verify_session()


@pytest.mark.parametrize('language', ['de', 'en'])
def test_api_busy_is_localized_and_not_a_session_expiry(monkeypatch, language):
    from backend.api.deps import get_ilias_client
    from backend.i18n import translate
    from backend.services.ilias_client import IliasClient
    fake = IliasClient()
    fake.get_my_courses = AsyncMock(side_effect=OutboundUnavailable(12))
    app.dependency_overrides[get_ilias_client] = lambda: fake
    try:
        response = TestClient(app).get('/api/dashboard/memberships', headers={'Accept-Language': language})
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
    assert response.status_code == 503
    assert response.headers['retry-after'] == '12'
    assert response.json()['detail'] == translate('outbound.busy', language)
    assert response.json()['code'] == 'ILIAS_BUSY'


def _process_request(directory, events, start, crash=False):
    async def run():
        budget = OutboundBudget(directory, BudgetPolicy(concurrency=1, per_session=1, rate=1000, queue_timeout=8))
        await asyncio.to_thread(start.wait)
        permit = await budget.acquire(str(os.getpid()))
        events.put(('start', time.time()))
        if crash:
            # Flush the multiprocessing queue before abrupt process termination.
            events.close()
            events.join_thread()
            os._exit(0)
        await asyncio.sleep(.1)
        events.put(('end', time.time()))
        await permit.close()
    asyncio.run(run())


def test_workers_share_slots_and_crash_releases_capacity(tmp_path):
    context = multiprocessing.get_context('spawn')
    events, start = context.Queue(), context.Event()
    processes = [context.Process(target=_process_request, args=(str(tmp_path), events, start)) for _ in range(3)]
    for process in processes:
        process.start()
    start.set()
    try:
        records = [events.get(timeout=20) for _ in range(6)]
        assert [event for event, _ in sorted(records, key=lambda row: row[1])] == ['start', 'end'] * 3
    finally:
        for process in processes:
            process.join(timeout=15)
            if process.is_alive():
                process.terminate()
        assert all(process.exitcode == 0 for process in processes)
    crash = context.Process(target=_process_request, args=(str(tmp_path), events, start, True))
    crash.start()
    assert events.get(timeout=20)[0] == 'start'
    crash.join(timeout=15)
    assert crash.exitcode == 0
    # The crashed worker's DB row is stale; its OS lock is already released.
    asyncio.run(_recover_after_crash(tmp_path))


async def _recover_after_crash(directory):
    budget = OutboundBudget(directory, BudgetPolicy(concurrency=1, per_session=1, rate=1000, queue_timeout=8))
    permit = await budget.acquire('survivor')
    await permit.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('language', ['de', 'en'])
async def test_background_calendar_busy_keeps_events_and_localizes_progress(tmp_path, monkeypatch, language):
    from backend.i18n import current_language, translate
    from backend.schemas import CourseItem
    from backend.services.calendar_service import CalendarService
    from backend.services.ilias_client import IliasClient
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    service = CalendarService(tmp_path / 'calendar')
    previous = {'42': [{'id': 'previous-event', 'title': 'Lecturer content'}]}
    state = service._load_tenant_state('alice')
    state['imported_events'] = previous
    service._save_tenant_state('alice', state)
    token = current_language.set(language)
    try:
        monkeypatch.setattr(service, '_import_single_course', AsyncMock(side_effect=OutboundUnavailable()))
        with pytest.raises(OutboundUnavailable):
            await service.sync_semester_calendar('alice', IliasClient(), courses=[
                CourseItem(ref_id='42', title='Course', url='', item_type='crs')], force_refresh=True)
    finally:
        current_language.reset(token)
    saved = service._load_tenant_state('alice')
    assert saved['imported_events'] == previous
    assert saved['sync_progress']['is_syncing'] is False
    assert saved['sync_progress']['last_error'] == translate('outbound.busy', language)
