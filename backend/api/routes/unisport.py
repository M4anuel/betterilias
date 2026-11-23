"""Independent capability-authenticated UniSport prototype endpoints."""
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, SecretStr

from backend.config import settings
from backend.i18n import t, current_language
from backend.services import unisport_auth as auth
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
    return {'phase': data['phase'], 'affiliation': data.get('affiliation')}


@router.delete('/connection')
def disconnect(owner: Owner):
    auth.disconnect(owner)
    return {'disconnected': True}


def connected(owner):
    current = auth.record(owner)
    if not current or current[1]['phase'] != 'connected':
        raise HTTPException(401, t('unisport.connection_required'))
    return current[1]


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
async def applications(owner: Owner):
    data = connected(owner)
    if not data['affiliation']:
        raise HTTPException(409, t('unisport.choose_affiliation'))
    account = UnisportAccount(data['subject'], SecretStr(data['token']), data['affiliation'])
    try:
        async with UnisportClient(account) as client:
            return await client.applications('de' if current_language.get() == 'de' else 'en')
    except UnisportReadError:
        raise HTTPException(502, t('unisport.read_failed')) from None
