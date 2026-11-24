"""Independent capability-authenticated UniSport prototype endpoints."""
import re
import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, Path
from pydantic import BaseModel, Field, SecretStr

from backend.config import settings
from backend.i18n import t, current_language
from backend.services import unisport_auth as auth
from backend.services import unisport_catalogue as public
from backend.services import unisport_booking as booking
from backend.services import unisport_applications as private_lists
from backend.coordination import CoordinationBusy
from backend.outbound_budget import OutboundUnavailable
from backend.services.unisport_client import UnisportAccount, UnisportClient, UnisportReadError

router = APIRouter(prefix='/unisport', tags=['unisport'])


def owner(response: Response, x_unisport_session: Annotated[str | None, Header()] = None):
    response.headers['Cache-Control'] = 'no-store'
    if not settings.unisport_enabled:
        raise HTTPException(404, t('unisport.disabled'))
    if not x_unisport_session or not re.fullmatch(r'[A-Za-z0-9_-]{43}', x_unisport_session):
        raise HTTPException(401, t('unisport.connection_required'))
    return auth.digest(x_unisport_session)


Owner = Annotated[str, Depends(owner)]


class Callback(BaseModel):
    callback: str = Field(max_length=10000)


class Affiliation(BaseModel):
    affiliation: str = Field(min_length=1, max_length=512)


class BookingPreparation(BaseModel):
    begin: str = Field(min_length=1, max_length=80)
    kind: str = Field(pattern=r'^(auto|apply|cancel)$')


class BookingSubmission(BaseModel):
    step: str = Field(pattern=r'^(start|answers|confirm)$')
    answers: dict[str, list[str]] = Field(default_factory=dict, max_length=80)


Scope = Annotated[str, Header(min_length=64, max_length=64, pattern=r'^[a-f0-9]{64}$')]
AffiliationHeader = Annotated[str, Header(min_length=1, max_length=512)]
Intent = Annotated[str, Path(pattern=r'^[A-Za-z0-9_-]{43}$')]


def booking_failed(error):
    if isinstance(error, booking.BookingError):
        if error.code == 'connection_changed':
            return connection_changed()
        messages = {
            'intent_missing': t('unisport.intent_missing'), 'intent_expired': t('unisport.intent_expired'),
            'invalid_answers': t('unisport.invalid_answers'), 'offer_changed': t('unisport.offer_changed'),
            'booking_unavailable': t('unisport.booking_unavailable'), 'booking_uncertain': t('unisport.booking_uncertain'),
            'unsupported_form': t('unisport.unsupported_form'),
        }
        return HTTPException(409, messages.get(error.code, t('unisport.read_failed')), headers={'Cache-Control': 'no-store'})
    return HTTPException(502, t('unisport.read_failed'), headers={'Cache-Control': 'no-store'})


@router.post('/offers/{offer_id}/booking')
async def prepare_booking(owner: Owner, offer_id: Annotated[int, Path(gt=0)], payload: BookingPreparation, x_unisport_scope: Scope, x_unisport_affiliation: AffiliationHeader):
    state, data = private_account(owner, x_unisport_scope, x_unisport_affiliation)
    try:
        return await booking.prepare(owner, state, data, offer_id, payload.begin, payload.kind, locale())
    except (booking.BookingError, UnisportReadError, OutboundUnavailable, CoordinationBusy) as error:
        raise booking_failed(error) from None


@router.get('/bookings/{intent}')
async def booking_status(owner: Owner, intent: Intent, x_unisport_scope: Scope, x_unisport_affiliation: AffiliationHeader):
    state, data = private_account(owner, x_unisport_scope, x_unisport_affiliation)
    try:
        return await booking.operate(owner, state, data, intent)
    except (booking.BookingError, UnisportReadError, OutboundUnavailable, CoordinationBusy) as error:
        raise booking_failed(error) from None


@router.post('/bookings/{intent}')
async def submit_booking(owner: Owner, intent: Intent, payload: BookingSubmission, x_unisport_scope: Scope, x_unisport_affiliation: AffiliationHeader):
    state, data = private_account(owner, x_unisport_scope, x_unisport_affiliation)
    try:
        return await booking.operate(owner, state, data, intent, payload.step, payload.answers)
    except (booking.BookingError, UnisportReadError, OutboundUnavailable, CoordinationBusy) as error:
        raise booking_failed(error) from None


def failed():
    return HTTPException(400, t('unisport.login_failed'), headers={'Cache-Control': 'no-store'})


@router.post('/auth/start')
def start(request: Request, owner: Owner):
    try:
        return auth.start(owner, request.client.host if request.client else 'unknown')
    except auth.LoginError:
        raise failed() from None


@router.post('/auth/complete')
async def complete(payload: Callback, owner: Owner):
    try:
        await auth.complete(owner, payload.callback)
        return {'connected': True}
    except auth.LoginError:
        raise failed() from None


@router.get('/connection')
def connection(owner: Owner):
    current = auth.record(owner)
    if not current:
        return {'phase': 'disconnected', 'affiliation': None}
    data = current[1]
    return {'phase': data['phase'], 'affiliation': data.get('affiliation'),
        'scope': auth.digest(current[0] + ':' + data['subject']) if data['phase'] == 'connected' else None}


@router.delete('/connection')
def disconnect(owner: Owner):
    auth.disconnect(owner)
    private_lists.drop(owner=owner)
    return {'disconnected': True}


def connected(owner):
    current = auth.record(owner)
    if not current or current[1]['phase'] != 'connected':
        raise HTTPException(401, t('unisport.connection_required'))
    return current[1]


def locale():
    return 'de' if current_language.get() == 'de' else 'en'


def private_account(owner, expected_scope=None, expected_affiliation=None):
    data = connected(owner)
    current = auth.record(owner)
    if not current or current[1] != data:
        raise connection_changed()
    scope = auth.digest(current[0] + ':' + data['subject'])
    if expected_scope and not hmac.compare_digest(expected_scope, scope):
        raise connection_changed()
    if not data['affiliation']:
        raise HTTPException(409, t('unisport.choose_affiliation'))
    if expected_affiliation is not None and expected_affiliation != data['affiliation']:
        raise connection_changed()
    return current[0], data


def connection_changed():
    return HTTPException(409, t('unisport.connection_changed'), headers={'X-Unisport-Connection-Changed': '1'})


def unchanged(owner, state, data):
    current = auth.record(owner)
    if not current or current[0] != state or current[1].get('affiliation') != data['affiliation']:
        raise connection_changed()


@router.get('/catalogue')
async def catalogue(owner: Owner, refresh: bool = False):
    try:
        return await public.catalogue(locale(), refresh=refresh)
    except UnisportReadError:
        raise HTTPException(502, t('unisport.read_failed')) from None


@router.get('/offers/{offer_id}')
async def offer(owner: Owner, offer_id: Annotated[int, Path(gt=0)], refresh: bool = False):
    try:
        return await public.offer(offer_id, locale(), refresh=refresh)
    except UnisportReadError:
        raise HTTPException(502, t('unisport.read_failed')) from None


@router.get('/bookmarks')
async def bookmarks(owner: Owner, x_unisport_scope: Annotated[str | None, Header(max_length=64, pattern=r'^[a-f0-9]{64}$')] = None):
    state, data = private_account(owner, x_unisport_scope)
    try:
        async with UnisportClient(UnisportAccount(data['subject'], SecretStr(data['token']), data['affiliation'])) as client:
            rows = await client.bookmarks(locale())
        unchanged(owner, state, data)
        items = {}
        for row in rows:
            if type(row.get('id')) is not int or row['id'] <= 0:
                raise UnisportReadError('invalid_response')
            # Membership is personal; occurrence and availability come from the
            # separately cached public catalogue/detail, never this stale DTO.
            items.setdefault(row['id'], {'id': row['id'], 'title': public.text(row.get('title'))})
        return {'items': list(items.values())}
    except UnisportReadError:
        raise HTTPException(502, t('unisport.read_failed')) from None


@router.get('/affiliations')
async def affiliations(owner: Owner):
    try:
        return {'affiliations': await auth.affiliations(owner, connected(owner))}
    except auth.LoginError:
        raise failed() from None


@router.put('/affiliation')
async def select_affiliation(payload: Affiliation, owner: Owner):
    try:
        await auth.select_affiliation(owner, payload.affiliation)
        return {'affiliation': payload.affiliation}
    except auth.LoginError:
        raise failed() from None


@router.get('/applications')
async def applications(owner: Owner, x_unisport_scope: Annotated[str | None, Header(max_length=64, pattern=r'^[a-f0-9]{64}$')] = None,
        x_unisport_affiliation: Annotated[str | None, Header(max_length=512)] = None, metadata: bool = False, refresh: bool = False):
    state, data = private_account(owner, x_unisport_scope, x_unisport_affiliation)
    account = UnisportAccount(data['subject'], SecretStr(data['token']), data['affiliation'])
    try:
        async with UnisportClient(account) as client:
            result = await private_lists.snapshot(owner, state, account, locale(), lambda: client.applications(locale()),
                lambda: unchanged(owner, state, data), refresh=refresh)
        unchanged(owner, state, data)
        return result if metadata else result['items']
    except (UnisportReadError, OutboundUnavailable, CoordinationBusy):
        raise HTTPException(502, t('unisport.read_failed')) from None
