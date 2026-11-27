"""Synthetic native UniApp writes only; never books/cancels a live offer."""
import asyncio
import base64
from copy import deepcopy
import json
import time

import httpx
from fastapi.testclient import TestClient
import pytest

from backend.config import settings
from backend.main import app
from backend.services import unisport_auth as auth, unisport_booking as booking
from backend.services.unisport_client import UnisportClient, UnisportReadError

BEGIN = '2031-12-01T18:00:00+01:00'
RAW = dict(id=42, title='Synthetic archery', offerNextDate={'begin': BEGIN, 'end': '2031-12-01T19:00:00+01:00'},
    status=1, registration='Open', registrationTimeSlot=None, generalInfos=[{'title': 'Costs', 'content': 'None'}])


def field(identifier='name', kind='textField', **values):
    return dict(id=identifier, title='Synthetic question', discriminant=kind, required=1, choices=[], additionalComponents=[], **values)


@pytest.fixture
def native(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    monkeypatch.setattr(settings, 'unisport_enabled', True)
    owner, state = auth.digest('x' * 43), 'synthetic-state'
    data = dict(phase='connected', subject='synthetic-subject', token='synthetic-token', affiliation='student')
    with auth.database() as db:
        db.execute('INSERT INTO connections VALUES (?, ?, ?, ?)', (owner, state, time.time() + 3600, json.dumps(data)))
    control = dict(raw=deepcopy(RAW), rows=[], calls=[], result=None, timeout=False, after=None, reads=0, fail_read=False)

    class Native:
        def __init__(self, account):
            assert account.subject == data['subject'] and account.affiliation == 'student'
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def offer(self, identifier, locale):
            control['reads'] += 1
            if control['fail_read']: raise UnisportReadError('upstream_unavailable')
            assert identifier == 42
            return deepcopy(control['raw'])
        async def applications(self, locale):
            if control['fail_read']: raise UnisportReadError('incomplete_applications')
            return deepcopy(control['rows'])
        async def mutate(self, operation, identifier, locale, *, answers=None, before_dispatch=None):
            if control.get('before_dispatch_hook'): control['before_dispatch_hook']()
            if before_dispatch: before_dispatch()
            control['calls'].append((operation, identifier, answers))
            # The receipt is already durable at the point of provider dispatch.
            with auth.database() as db:
                assert any(json.loads(row[0])['phase'] == 'dispatched' for row in db.execute('SELECT data FROM sport_bookings'))
            if control['after']: control['after']()
            if control['timeout']: raise UnisportReadError('upstream_unavailable')
            return deepcopy(control['result'])
    monkeypatch.setattr(booking, 'UnisportClient', Native)
    return owner, state, data, control


async def prepare(native, kind='apply'):
    owner, state, data, _ = native
    return await booking.prepare(owner, state, data, 42, BEGIN, kind, 'en')


async def submit(native, intent, step='start', answers=None):
    owner, state, data, _ = native
    return await booking.operate(owner, state, data, intent, step, answers)


def registered(control):
    control['rows'] = [dict(id=42, begin=BEGIN, status=8)]
    control['raw'].update(status=8, registration='Registered: waiting list')


def cancelled(control):
    control['rows'] = []
    control['raw'].update(status=1, registration='Open')


@pytest.mark.asyncio
async def test_apply_is_explicit_fresh_and_readback_verified(native):
    control = native[3]
    intent = await prepare(native)
    assert intent['phase'] == 'ready' and not control['calls']
    control.update(result={'status': 'success', 'code': 0}, after=lambda: registered(control))
    result = await submit(native, intent['intent'])
    assert result['phase'] == 'confirmed' and result['provider_status'] == 'Registered: waiting list'
    assert control['reads'] >= 3
    assert await submit(native, intent['intent']) == result
    assert len(control['calls']) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('changed_cost', [None, 'CHF 20'])
async def test_quick_registration_only_submits_verified_free_training(native, changed_cost):
    control = native[3]
    control['raw'].update(requiresConfirmation=False, datePhase={'phase': ['-', '2']})
    intent = await prepare(native)
    if changed_cost:
        control['raw']['generalInfos'][0]['content'] = changed_cost
    control.update(result={'status': 'success'}, after=lambda: registered(control))
    result = await submit(native, intent['intent'], 'quick')
    if changed_cost:
        assert result['phase'] == 'ready'
        assert result['offer']['infos'][0]['content'] == changed_cost
        assert control['calls'] == []
    else:
        assert result['phase'] == 'confirmed'
        assert await submit(native, intent['intent'], 'quick') == result
        assert control['calls'] == [('apply', 42, None)]


@pytest.mark.asyncio
async def test_native_dynamic_form_payload_and_double_start_do_not_resubmit(native):
    control = native[3]
    intent = await prepare(native)
    control['result'] = {'id': 9123, 'formComponents': [field()]}
    result = await submit(native, intent['intent'])
    assert result['phase'] == 'form' and 'provider_id' not in result
    assert (await submit(native, intent['intent']))['phase'] == 'form'
    assert len(control['calls']) == 1
    with pytest.raises(booking.BookingError, match='invalid_answers'):
        await submit(native, intent['intent'], 'answers', {})
    assert len(control['calls']) == 1
    control.update(result={'status': 'success', 'code': 0}, after=lambda: registered(control))
    result = await submit(native, intent['intent'], 'answers', {'name': ['Synthetic answer']})
    assert result['phase'] == 'confirmed'
    assert control['calls'][-1] == ('submitAdditionalInfos', 42, [{'id': 'name', 'answers': ['Synthetic answer']}])
    with auth.database() as db:
        assert all('Synthetic answer' not in row[0] for row in db.execute('SELECT data FROM sport_bookings'))


@pytest.mark.asyncio
async def test_cancellation_confirmation_is_separate_explicit_and_verified(native):
    control = native[3]; registered(control)
    intent = await prepare(native, 'cancel')
    control['result'] = {'confirmationText': '<p>A cancellation fee may apply.</p>', 'offer': control['raw']}
    result = await submit(native, intent['intent'])
    assert result['phase'] == 'confirmation' and result['confirmation'] == 'A cancellation fee may apply.'
    assert len(control['calls']) == 1
    await submit(native, intent['intent'])
    assert len(control['calls']) == 1
    control.update(result={'confirmationText': '', 'offer': RAW}, after=lambda: cancelled(control))
    assert (await submit(native, intent['intent'], 'confirm'))['phase'] == 'confirmed'
    assert [c[:2] for c in control['calls']] == [('cancelApplication', 42), ('confirmCancellation', 42)]


@pytest.mark.asyncio
async def test_timeout_rechecks_only_and_never_fabricates_success(native):
    control = native[3]; intent = await prepare(native)
    control['timeout'] = True
    assert (await submit(native, intent['intent']))['phase'] == 'uncertain'
    assert (await submit(native, intent['intent']))['phase'] == 'uncertain'
    registered(control)
    assert (await submit(native, intent['intent'], None))['phase'] == 'confirmed'
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_complete_list_failure_does_not_establish_absence(native):
    control = native[3]; registered(control); intent = await prepare(native, 'cancel')
    def fail(): control['fail_read'] = True
    control.update(timeout=True, after=fail)
    assert (await submit(native, intent['intent']))['phase'] == 'uncertain'
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_duplicate_intents_and_concurrent_workers_send_only_once(native):
    control = native[3]
    first, second = await prepare(native), await prepare(native)
    control['timeout'] = True
    results = await asyncio.gather(submit(native, first['intent']), submit(native, second['intent']), return_exceptions=True)
    assert sum(isinstance(result, booking.BookingError) for result in results) == 1
    assert len(control['calls']) == 1
    # Reloading a dispatched intent (including after a worker crash) is GET-only.
    assert (await booking.operate(*native[:3], first['intent']))['phase'] == 'uncertain'
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_receipts_are_owner_generation_and_affiliation_bound(native):
    owner, state, data, control = native; intent = await prepare(native)
    for other_owner, other_state in [('other', state), (owner, 'replacement')]:
        with pytest.raises(booking.BookingError, match='intent_missing'):
            await booking.operate(other_owner, other_state, data, intent['intent'], 'start')
    with pytest.raises(booking.BookingError, match='connection_changed'):
        await booking.operate(owner, state, {**data, 'affiliation': 'staff'}, intent['intent'], 'start')
    auth.disconnect(owner)
    with pytest.raises(booking.BookingError, match='connection_changed'):
        await submit(native, intent['intent'])
    assert not control['calls']


@pytest.mark.asyncio
@pytest.mark.parametrize('change,error', [('cost','offer_changed'), ('closed','booking_unavailable'), ('occurrence','offer_changed')])
async def test_occurrence_conditions_availability_and_expiry_are_rechecked(native, change, error):
    control = native[3]; intent = await prepare(native)
    if change == 'cost': control['raw']['generalInfos'][0]['content'] = 'CHF 50'
    elif change == 'closed': control['raw']['status'] = 2
    else: control['raw']['offerNextDate']['begin'] = '2031-12-08T18:00:00+01:00'
    with pytest.raises(booking.BookingError, match=error):
        await submit(native, intent['intent'])
    assert not control['calls']
    assert (await booking.operate(*native[:3], intent['intent']))['phase'] == 'expired'


@pytest.mark.asyncio
async def test_expired_ready_can_be_replaced_but_expired_provider_form_cannot_replay(native):
    owner, state, data, control = native
    intent = await prepare(native)
    context, stored = booking.read(intent['intent'], owner, state)
    stored['expires_at'] = time.time() - 1
    booking.put(intent['intent'], owner, state, context, stored)
    with auth.database() as db:
        db.execute('INSERT INTO sport_booking_guards VALUES (?, ?)', (context, intent['intent']))
    assert (await submit(native, intent['intent']))['phase'] == 'expired'
    assert not control['calls']
    next_intent = await prepare(native)
    assert next_intent['intent'] != intent['intent']
    control['result'] = {'formComponents': [field()]}
    assert (await submit(native, next_intent['intent']))['phase'] == 'form'
    context, stored = booking.read(next_intent['intent'], owner, state)
    stored['expires_at'] = time.time() - 1
    booking.put(next_intent['intent'], owner, state, context, stored)
    assert (await submit(native, next_intent['intent'], 'answers', {'name': ['Synthetic']}))['phase'] == 'unsupported'
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_connection_change_during_budget_wait_is_checked_before_write(native):
    owner, state, data, control = native
    intent = await prepare(native)
    control['before_dispatch_hook'] = lambda: auth.disconnect(owner)
    with pytest.raises(booking.BookingError, match='connection_changed'):
        await submit(native, intent['intent'])
    assert not control['calls']
    assert booking.read(intent['intent'], owner, state)[1]['phase'] == 'uncertain'


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [{'status': 'success', 'code': 0}, {'result': {'status': 'success'}}, {'code': 200}])
async def test_crash_receipt_readback_is_read_only_and_unknown_200_is_not_success(native, result):
    owner, state, data, control = native
    intent = await prepare(native)
    context, stored = booking.read(intent['intent'], owner, state)
    stored['phase'] = 'dispatched'
    booking.put(intent['intent'], owner, state, context, stored)
    assert (await submit(native, intent['intent']))['phase'] == 'uncertain'
    assert not control['calls']
    other = await prepare(native)
    control['result'] = result
    assert (await submit(native, other['intent']))['phase'] == 'uncertain'
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_unsupported_form_is_not_silently_submitted(native):
    control = native[3]; intent = await prepare(native)
    control['result'] = {'formComponents': [field(kind='unknown')]}
    assert (await submit(native, intent['intent']))['phase'] == 'unsupported'
    await submit(native, intent['intent'], 'answers', {'name': ['Do not send']})
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_confirmed_cancellation_then_registration_can_be_cancelled_again(native):
    control = native[3]; registered(control)
    for kind, after, result in [('cancel', cancelled, {'confirmationText': '', 'offer': RAW}),
            ('apply', registered, {'status': 'success'}), ('cancel', cancelled, {'confirmationText': '', 'offer': RAW})]:
        intent = await prepare(native, kind)
        control.update(result=result, after=lambda after=after: after(control))
        assert (await submit(native, intent['intent']))['phase'] == 'confirmed'
    assert len(control['calls']) == 3


@pytest.mark.asyncio
async def test_new_login_can_recognize_resolved_prior_write_without_transferring_its_form(native):
    owner, state, data, control = native
    intent = await prepare(native); control['timeout'] = True
    assert (await submit(native, intent['intent']))['phase'] == 'uncertain'
    registered(control)
    with auth.database() as db:
        db.execute('UPDATE connections SET state=? WHERE owner=?', ('replacement', owner))
    next_intent = await booking.prepare(owner, 'replacement', data, 42, BEGIN, 'cancel', 'en')
    assert next_intent['phase'] == 'ready' and next_intent['intent'] != intent['intent']
    assert len(control['calls']) == 1


@pytest.mark.asyncio
async def test_owned_pending_form_can_be_completed_without_starting_another_registration(native):
    control = native[3]; intent = await prepare(native)
    control.update(result={'formComponents': [field()]}, after=lambda: registered(control))
    assert (await submit(native, intent['intent']))['phase'] == 'form'
    assert (await booking.operate(*native[:3], intent['intent']))['phase'] == 'form'
    control['result'] = {'status': 'success'}
    assert (await submit(native, intent['intent'], 'answers', {'name': ['Synthetic']}))['phase'] == 'confirmed'
    assert [call[0] for call in control['calls']] == ['apply', 'submitAdditionalInfos']


@pytest.mark.asyncio
async def test_receipt_cleanup_retains_unresolved_future_guard(native):
    owner, state, data, control = native
    intent = await prepare(native)
    context, stored = booking.read(intent['intent'], owner, state)
    stored.update(phase='uncertain', expires_at=time.time()-1000)
    booking.put(intent['intent'], owner, state, context, stored)
    old = {**stored, 'begin': '2020-01-01T18:00:00+01:00'}
    booking.put('past', owner, state, 'past', old)
    with auth.database() as db:
        db.execute('INSERT INTO sport_booking_guards VALUES (?, ?)', (context, intent['intent']))
        db.execute('INSERT INTO sport_booking_guards VALUES (?, ?)', ('past', 'past'))
    assert (await prepare(native))['intent'] == intent['intent']
    with auth.database() as db:
        assert db.execute('SELECT id FROM sport_bookings WHERE id=?', ('past',)).fetchone() is None
        assert db.execute('SELECT intent FROM sport_booking_guards WHERE context=?', (context,)).fetchone()[0] == intent['intent']


@pytest.mark.asyncio
async def test_http_scope_is_mandatory_and_intents_never_use_ilias_auth(native):
    headers = {'X-Unisport-Session': 'x' * 43, 'Accept-Language': 'en'}
    with TestClient(app) as client:
        payload = dict(begin=BEGIN, kind='apply')
        assert client.post('/api/unisport/offers/42/booking', json=payload, headers=headers).status_code == 422
        headers['X-Unisport-Scope'] = auth.digest(native[1] + ':' + native[2]['subject'])
        headers['X-Unisport-Affiliation'] = 'student'
        result = client.post('/api/unisport/offers/42/booking', json=payload, headers=headers)
        assert result.status_code == 200 and result.headers['cache-control'] == 'no-store'
        intent = result.json()['intent']
        assert client.get('/api/unisport/bookings/' + intent, headers=headers).status_code == 200
        assert client.post('/api/unisport/bookings/' + intent, json={'step': 'start'}, headers={'X-Session-Id': 'ilias'}).status_code == 401
        wrong = client.get('/api/unisport/bookings/' + intent, headers={**headers, 'X-Unisport-Scope': 'a' * 64})
        assert wrong.status_code == 409 and wrong.headers['X-Unisport-Connection-Changed'] == '1'
        wrong_affiliation = client.post('/api/unisport/bookings/' + intent, json={'step': 'start'}, headers={**headers, 'X-Unisport-Affiliation': 'staff'})
        assert wrong_affiliation.status_code == 409 and wrong_affiliation.headers['X-Unisport-Connection-Changed'] == '1'
    assert not native[3]['calls']


def test_form_dependencies_choices_dates_files_and_unsupported_controls():
    rows = [field('choice', 'radioType')]
    rows[0]['choices'] = [{'id': 'yes', 'title': 'Yes', 'additionalComponents': [field('details')]}, {'id': 'no', 'title': 'No'}]
    fields = booking.schema(rows)
    assert booking.validate_answers(fields, {'choice': ['no'], 'details': ['Hidden draft']}) == [{'id': 'choice', 'answers': ['no']}]
    with pytest.raises(booking.BookingError, match='invalid_answers'):
        booking.validate_answers(fields, {'choice': ['yes']})
    for invalid in ({'choice': ['injected']}, {'extra': ['answer']}, {'choice': ['yes', 'no']}):
        with pytest.raises(booking.BookingError): booking.validate_answers(fields, invalid)
    for invalid in ([field(kind='unknown')], [field(), field()], [field(dependantComponentId='missing', dependantComponentValue='x')]):
        with pytest.raises(booking.BookingError, match='unsupported_form'): booking.schema(invalid)
    date_fields = booking.schema([field('date', 'dateType')])
    assert booking.validate_answers(date_fields, {'date': ['2031-12-01']})
    with pytest.raises(booking.BookingError): booking.validate_answers(date_fields, {'date': ['2031-02-30']})
    file_fields = booking.schema([field('document', 'fileType')])
    assert booking.validate_answers(file_fields, {'document': [base64.b64encode(b'synthetic').decode()]})
    with pytest.raises(booking.BookingError): booking.validate_answers(file_fields, {'document': ['not base64!']})


@pytest.mark.asyncio
async def test_native_mutation_transport_contract(account, budget):
    calls = []
    def handle(request):
        calls.append(request)
        assert request.method == 'POST' and request.headers['authorization'] == 'Bearer own-id-token'
        assert request.headers['x-unicampus-affiliation'] == 'own-affiliation'
        assert 'cookie' not in request.headers and 'x-session-id' not in request.headers
        return httpx.Response(200, json={'status': 'success'})
    async with UnisportClient(account, transport=httpx.MockTransport(handle), budget=budget) as client:
        for method in ('apply', 'cancelApplication', 'confirmCancellation'):
            await client.mutate(method, 42, 'en')
        await client.mutate('submitAdditionalInfos', 9123, 'en', answers=[{'id': 'name', 'answers': ['Synthetic']}])
    assert [request.url.path for request in calls] == ['/api/v3/sports/offers/' + method + '/42' for method in ('apply', 'cancelApplication', 'confirmCancellation')] + ['/api/v3/sports/offers/submitAdditionalInfos/9123']
    assert json.loads(calls[-1].content) == {'items': [{'id': 'name', 'answers': ['Synthetic']}]}


from tests.test_unisport_client import account, budget
