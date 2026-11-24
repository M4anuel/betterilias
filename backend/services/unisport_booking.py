"""Explicit native UniApp writes with durable, account/occurrence-owned receipts.

No provider POST is retried. A dispatched receipt survives crashes/timeouts;
rechecking it only reads complete private lists. Public caches never authorize
a mutation. Coordination requires the same local volume as UniSport login.
"""
import base64
from datetime import date, datetime, timezone
import json
import secrets
import time

from pydantic import SecretStr

from backend.coordination import SharedLock
from backend.outbound_budget import OutboundUnavailable
from backend.services import unisport_auth as auth
from backend.services import unisport_applications as private_lists
from backend.services.unisport_catalogue import plain_html, present_offer
from backend.services.unisport_client import UnisportAccount, UnisportClient, UnisportReadError

TTL = 600
MAX_FILE = 1_000_000
MAX_ANSWERS = 1_500_000
KINDS = {'textField', 'textArea', 'checkBox', 'radioType', 'dropDown', 'dateType', 'fileType'}


class BookingError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def clean(value, limit=4000):
    return plain_html(value[:limit]) if isinstance(value, str) and value.strip() else ''


def schema(rows):
    """Flatten bounded provider controls; keep explicit and choice dependencies."""
    result, ids = [], set()

    def visit(items, when=(), depth=0):
        if not isinstance(items, list) or depth > 8:
            raise BookingError('unsupported_form')
        for item in items:
            if not isinstance(item, dict) or len(result) >= 80:
                raise BookingError('unsupported_form')
            identifier, kind = item.get('id'), item.get('discriminant')
            if not isinstance(identifier, str) or not identifier or len(identifier) > 128 or identifier in ids or kind not in KINDS:
                raise BookingError('unsupported_form')
            ids.add(identifier)
            conditions = list(when)
            dependency = item.get('dependantComponentId')
            value = item.get('dependantComponentValue')
            if dependency:
                if not isinstance(dependency, str) or not isinstance(value, str):
                    raise BookingError('unsupported_form')
                conditions.append({'id': dependency, 'value': value})
            choices = item.get('choices') or []
            if not isinstance(choices, list) or len(choices) > 100:
                raise BookingError('unsupported_form')
            options = []
            for choice in choices:
                if not isinstance(choice, dict) or not isinstance(choice.get('id'), str) or not choice['id'] or len(choice['id']) > 128:
                    raise BookingError('unsupported_form')
                options.append({'id': choice['id'], 'title': clean(choice.get('title'))})
            if len({option['id'] for option in options}) != len(options):
                raise BookingError('unsupported_form')
            if kind in ('checkBox', 'radioType', 'dropDown') and not options:
                raise BookingError('unsupported_form')
            result.append(dict(id=identifier, kind=kind, title=clean(item.get('title')),
                required=item.get('required') == 1, choices=options, when=conditions))
            visit(item.get('additionalComponents') or [], conditions, depth + 1)
            for choice in choices:
                visit(choice.get('additionalComponents') or [],
                    [*conditions, {'id': identifier, 'value': choice['id']}], depth + 1)
    visit(rows)
    # Reject cycles/missing references instead of hiding an unknown required field.
    by_id = {field['id']: field for field in result}
    checked = set()
    def ancestors(identifier, seen):
        if identifier in seen or identifier not in by_id:
            raise BookingError('unsupported_form')
        if identifier in checked:
            return
        for condition in by_id[identifier]['when']:
            ancestors(condition['id'], {*seen, identifier})
        checked.add(identifier)
    for identifier in by_id:
        ancestors(identifier, set())
    return result


def validate_answers(fields, supplied):
    if not isinstance(supplied, dict) or set(supplied) - {field['id'] for field in fields}:
        raise BookingError('invalid_answers')
    if len(json.dumps(supplied)) > MAX_ANSWERS:
        raise BookingError('invalid_answers')
    active, by_id = {}, {field['id']: field for field in fields}
    def enabled(identifier):
        if identifier not in active:
            active[identifier] = all(enabled(rule['id']) and rule['value'] in supplied.get(rule['id'], [])
                for rule in by_id[identifier]['when'])
        return active[identifier]
    output = []
    for field in fields:
        values = supplied.get(field['id'], [])
        if not isinstance(values, list) or len(values) > 100 or any(not isinstance(v, str) for v in values):
            raise BookingError('invalid_answers')
        if not enabled(field['id']):
            continue  # Drafts of hidden controls are never submitted.
        if field['required'] and (not values or not any(v.strip() for v in values)):
            raise BookingError('invalid_answers')
        if field['kind'] in ('checkBox', 'radioType', 'dropDown'):
            if set(values) - {c['id'] for c in field['choices']} or len(set(values)) != len(values):
                raise BookingError('invalid_answers')
            if field['kind'] != 'checkBox' and len(values) > 1:
                raise BookingError('invalid_answers')
        elif len(values) > 1:
            raise BookingError('invalid_answers')
        elif values:
            if field['kind'] == 'fileType':
                try:
                    decoded = base64.b64decode(values[0], validate=True)
                    if not decoded or len(decoded) > MAX_FILE:
                        raise ValueError()
                except (ValueError, TypeError):
                    raise BookingError('invalid_answers') from None
            elif len(values[0]) > 8000:
                raise BookingError('invalid_answers')
            elif field['kind'] == 'dateType':
                try:
                    if date.fromisoformat(values[0]).isoformat() != values[0]:
                        raise ValueError()
                except ValueError:
                    raise BookingError('invalid_answers') from None
        if values:
            output.append({'id': field['id'], 'answers': values})
    return output


def tables(db):
    db.execute('CREATE TABLE IF NOT EXISTS sport_bookings (id TEXT PRIMARY KEY, owner TEXT, state TEXT, context TEXT, expires REAL, data TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS sport_booking_guards (context TEXT PRIMARY KEY, intent TEXT)')


def put(intent, owner, state, context, data):
    with auth.database() as db:
        tables(db)
        db.execute('INSERT OR REPLACE INTO sport_bookings VALUES (?, ?, ?, ?, ?, ?)',
            (intent, owner, state, context, data['expires_at'], json.dumps(data)))


def read(intent, owner, state):
    with auth.database() as db:
        tables(db)
        row = db.execute('SELECT owner, state, context, data FROM sport_bookings WHERE id=?', (intent,)).fetchone()
    if not row or row[0] != owner or row[1] != state:
        raise BookingError('intent_missing')
    return row[2], json.loads(row[3])


def context_key(account, offer_id, begin):
    return auth.digest(json.dumps([account.subject, account.affiliation, offer_id, timestamp(begin).isoformat()]))


def check_connection(owner, state, account):
    current = auth.record(owner)
    if not current or current[0] != state or current[1].get('subject') != account.subject or current[1].get('affiliation') != account.affiliation:
        raise BookingError('connection_changed')


def account_for(data):
    return UnisportAccount(data['subject'], SecretStr(data['token']), data['affiliation'])


def occurrence(raw):
    value = raw.get('offerNextDate')
    return value.get('begin') if isinstance(value, dict) else None


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise BookingError('offer_changed') from None


def membership(rows, offer_id, begin):
    matches = []
    for row in rows:
        if type(row.get('id')) is not int:
            raise UnisportReadError('incomplete_applications')
        if row['id'] != offer_id:
            continue
        start = row.get('begin') or occurrence(row)
        if not start:
            raise UnisportReadError('incomplete_applications')
        if timestamp(start) == timestamp(begin) and row.get('status') != 4:
            matches.append(row)
    return bool(matches)


async def fresh(client, offer_id, begin, locale):
    raw = await client.offer(offer_id, locale)
    if raw.get('id') != offer_id or timestamp(occurrence(raw)) != timestamp(begin):
        raise BookingError('offer_changed')
    rows = await client.applications(locale)
    return raw, membership(rows, offer_id, begin)


def eligible(raw, registered, kind):
    if raw.get('outage'):
        raise BookingError('booking_unavailable')
    if kind == 'cancel':
        if not registered or raw.get('status') != 8:
            raise BookingError('booking_unavailable')
    else:
        if registered or raw.get('status') != 1 or timestamp(occurrence(raw)) <= datetime.now(timezone.utc):
            raise BookingError('booking_unavailable')
        window = raw.get('registrationTimeSlot')
        if window is not None:
            if not isinstance(window, dict) or not (timestamp(window.get('begin')) <= datetime.now(timezone.utc) < timestamp(window.get('end'))):
                raise BookingError('booking_unavailable')


def view(intent, data):
    return {**data, 'intent': intent}


async def prepare(owner, state, data, offer_id, begin, kind, locale):
    account = account_for(data)
    async with UnisportClient(account) as client:
        raw, registered = await fresh(client, offer_id, begin, locale)
    check_connection(owner, state, account)
    if kind == 'auto':
        kind = 'cancel' if registered else 'apply'
    eligible(raw, registered, kind)
    context = context_key(account, offer_id, begin)
    async with SharedLock('unisport-booking:' + context).async_():
        check_connection(owner, state, account)
        with auth.database() as db:
            tables(db)
            # Keep unresolved future occurrences protected, but do not retain
            # abandoned preparations or past-occurrence receipts indefinitely.
            db.execute("DELETE FROM sport_booking_guards WHERE intent IN (SELECT id FROM sport_bookings "
                "WHERE julianday(json_extract(data,'$.begin')) < julianday('now','-7 days'))")
            db.execute('DELETE FROM sport_bookings WHERE expires < ? AND id NOT IN (SELECT intent FROM sport_booking_guards)', (time.time(),))
            previous = db.execute('SELECT b.id,b.owner,b.state,b.data FROM sport_booking_guards g JOIN sport_bookings b ON b.id=g.intent WHERE g.context=?', (context,)).fetchone()
        if previous:
            prior = json.loads(previous[3])
            # A lost response/connection can be resolved by positive fresh
            # account evidence. Never transfer an old account generation's form.
            if prior['phase'] in ('dispatched', 'uncertain') and verified(prior['kind'], raw, registered):
                prior['phase'] = 'confirmed'
                put(previous[0], previous[1], previous[2], context, prior)
            if prior['phase'] not in ('confirmed', 'rejected', 'expired') or prior['kind'] == kind and prior['phase'] == 'confirmed':
                if previous[1:3] == (owner, state):
                    return view(previous[0], prior)
                raise BookingError('booking_uncertain')
        intent = secrets.token_urlsafe(32)
        value = dict(phase='ready', kind=kind, offer=present_offer(raw, detail=True), begin=begin,
            locale=locale, expires_at=time.time() + TTL, fields=[], confirmation='', provider_status='')
        put(intent, owner, state, context, value)
    return view(intent, value)


def verified(kind, raw, present):
    return (present and raw.get('status') in (8, 9, 10)) if kind == 'apply' else (not present and raw.get('status') in (1, 2, 3, 4, 6, 7))


async def reconcile(client, value):
    # Neither absence nor HTTP 200 alone establishes a successful registration.
    try:
        rows = await client.applications(value['locale'])
        present = membership(rows, value['offer']['id'], value['begin'])
        raw = await client.offer(value['offer']['id'], value['locale'])
        same = timestamp(occurrence(raw)) == timestamp(value['begin'])
        if same:
            value['provider_status'] = clean(raw.get('registration'))
        if same and verified(value['kind'], raw, present):
            value['phase'] = 'confirmed'
    except (UnisportReadError, OutboundUnavailable, BookingError):
        pass


async def operate(owner, state, data, intent, step=None, supplied=None):
    context, value = read(intent, owner, state)
    account = account_for(data)
    if context != context_key(account, value['offer']['id'], value['begin']):
        raise BookingError('connection_changed')
    async with SharedLock('unisport-booking:' + context).async_():
        context, value = read(intent, owner, state)
        check_connection(owner, state, account)
        if time.time() > value['expires_at'] and value['phase'] in ('ready', 'form', 'confirmation'):
            value['phase'] = 'expired' if value['phase'] == 'ready' else 'unsupported'
        invalidate = value['phase'] in ('dispatched', 'uncertain')
        async with UnisportClient(account) as client:
            if value['phase'] in ('dispatched', 'uncertain'):
                value['phase'] = 'uncertain'
                await reconcile(client, value)
            elif step is not None and value['phase'] in ('ready', 'form', 'confirmation'):
                expected = {'ready': 'start', 'form': 'answers', 'confirmation': 'confirm'}[value['phase']]
                if step != expected:
                    return view(intent, value)
                if time.time() > value['expires_at']:
                    raise BookingError('intent_expired')
                answers = validate_answers(value['fields'], supplied or {}) if step == 'answers' else None
                try:
                    raw, registered = await fresh(client, value['offer']['id'], value['begin'], value['locale'])
                    if step != 'answers':
                        eligible(raw, registered, value['kind'])
                    elif raw.get('outage'):
                        # This once-only step completes the owned provider form;
                        # an application may already exist provisionally.
                        raise BookingError('booking_unavailable')
                    if step == 'start':
                        current_offer = present_offer(raw, detail=True)
                        if any(current_offer[key] != value['offer'][key] for key in ('title', 'infos', 'important', 'special')):
                            raise BookingError('offer_changed')
                except BookingError:
                    if value['phase'] == 'ready':
                        # No provider write happened: a new confirmation can
                        # safely fetch current conditions after a status check.
                        value['phase'] = 'expired'
                        put(intent, owner, state, context, value)
                    raise
                check_connection(owner, state, account)
                with auth.database() as db:
                    tables(db)
                    previous = db.execute('SELECT intent FROM sport_booking_guards WHERE context=?', (context,)).fetchone()
                    if previous and previous[0] != intent:
                        old = db.execute('SELECT data FROM sport_bookings WHERE id=?', (previous[0],)).fetchone()
                        old_value = json.loads(old[0]) if old else {}
                        if old_value.get('phase') not in ('confirmed', 'rejected', 'expired') or old_value.get('phase') == 'confirmed' and old_value.get('kind') == value['kind']:
                            raise BookingError('booking_uncertain')
                    db.execute('INSERT OR REPLACE INTO sport_booking_guards VALUES (?, ?)', (context, intent))
                operation = ('submitAdditionalInfos' if step == 'answers' else 'confirmCancellation' if step == 'confirm'
                    else 'apply' if value['kind'] == 'apply' else 'cancelApplication')
                identifier = value['offer']['id']
                # Durable dispatch BEFORE any possible provider write, including
                # budget wait, timeout, malformed responses and worker shutdown.
                value['phase'] = 'dispatched'
                invalidate = True
                for key in ('infos', 'important', 'special', 'outage'):
                    value['offer'].pop(key, None)
                put(intent, owner, state, context, value)
                try:
                    async with private_lists.mutation(account):
                        result = await client.mutate(operation, identifier, value['locale'], answers=answers,
                            before_dispatch=lambda: check_connection(owner, state, account))
                    if value['kind'] == 'cancel':
                        confirmation = clean(result.get('confirmationText'))
                        if step == 'start' and confirmation:
                            value.update(phase='confirmation', confirmation=confirmation)
                        elif not confirmation and isinstance(result.get('offer'), dict):
                            value['phase'] = 'uncertain'
                        else:
                            value['phase'] = 'uncertain'
                    elif step == 'start' and result.get('formComponents'):
                        value.update(phase='form', fields=schema(result['formComponents']))
                    else:
                        # The native repository parses the root registration
                        # result, even though its dynamic DTO also has `result`.
                        outcome = result if isinstance(result.get('status'), str) else result.get('result')
                        if isinstance(outcome, dict) and outcome.get('status') == 'success':
                            value['phase'] = 'uncertain'
                        elif isinstance(outcome, dict) and outcome.get('status') == 'failed':
                            value.update(phase='rejected', reason=clean(outcome.get('error')))
                        else:
                            value['phase'] = 'uncertain'
                except BookingError as error:
                    if error.code == 'connection_changed':
                        value['phase'] = 'uncertain'
                        put(intent, owner, state, context, value)
                        raise
                    value.update(phase='unsupported', reason='')
                except (UnisportReadError, OutboundUnavailable):
                    value['phase'] = 'uncertain'
                if value['phase'] == 'uncertain':
                    await reconcile(client, value)
            put(intent, owner, state, context, value)
        if invalidate:
            await private_lists.invalidate(account)
        check_connection(owner, state, account)
        return view(intent, value)
