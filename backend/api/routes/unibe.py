"""Shared UniBE login, independently of whether UniSport navigation is enabled."""
import json
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
import httpx

from backend.api.routes import unisport
from backend.config import settings
from backend import activity
from backend.i18n import t
from backend.services import unisport_auth as auth, unisport_ilias

router = APIRouter(prefix='/auth/unibe', tags=['Authentication'])


def supported():
    return str(httpx.URL(settings.ilias_base_url)).rstrip('/') == unisport_ilias.ORIGIN


def owner(response: Response, x_unisport_session: Annotated[str | None, Header()] = None):
    response.headers['Cache-Control'] = 'no-store'
    if not supported():
        raise HTTPException(404, t('unisport.disabled'))
    if not x_unisport_session or not re.fullmatch(r'[A-Za-z0-9_-]{43}', x_unisport_session):
        raise HTTPException(401, t('unisport.connection_required'))
    return auth.digest(x_unisport_session)


Owner = Annotated[str, Depends(owner)]


@router.get('/availability')
def availability(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return {'enabled': supported(), 'usage_retention_days': activity.ACCOUNT_RETENTION // 86400
        if supported() and len(settings.admin_api_key) >= 43 else None}


@router.post('/start')
def start(request: Request, owner: Owner):
    return unisport.start(request, owner)


@router.post('/complete')
async def complete(payload: unisport.Callback, owner: Owner):
    return await unisport.complete(payload, owner)


@router.get('/connection')
async def connection(owner: Owner):
    current = auth.record(owner)
    if not current:
        return {'phase': 'disconnected', 'affiliation': None}
    state, data = current
    if data['phase'] != 'connected':
        return {'phase': data['phase'], 'affiliation': None}
    try:
        choices = await auth.affiliations(owner, data)
    except auth.CredentialRejected:
        # Never let a delayed rejection delete a newer login generation.
        with auth.database() as db:
            removed = db.execute('DELETE FROM connections WHERE owner=? AND state=? AND data=?',
                (owner, state, json.dumps(data))).rowcount
            if not removed and db.execute('SELECT 1 FROM connections WHERE owner=?', (owner,)).fetchone():
                raise unisport.connection_changed()
        return {'phase': 'disconnected', 'affiliation': None}
    except auth.LoginError:
        raise HTTPException(502, t('unisport.read_failed')) from None
    if auth.record(owner) != current:
        raise unisport.connection_changed()
    return {'phase': 'connected', 'affiliation': data.get('affiliation'), 'affiliations': choices,
        'user_name': data.get('name'), 'expires_at': data.get('expires_at'),
        'scope': auth.digest(state + ':' + data['subject'])}


@router.delete('/connection')
def disconnect(owner: Owner):
    return unisport.disconnect(owner)


@router.put('/affiliation')
async def affiliation(payload: unisport.Affiliation, owner: Owner, x_unisport_scope: unisport.Scope):
    try:
        await auth.select_affiliation(owner, payload.affiliation, x_unisport_scope)
    except auth.LoginError:
        raise unisport.failed() from None
    return {'affiliation': payload.affiliation}


@router.post('/ilias-connection')
async def connect_ilias(owner: Owner, x_unisport_scope: unisport.Scope,
        x_unisport_affiliation: unisport.AffiliationHeader, response: Response,
        x_session_id: Annotated[str | None, Header()] = None):
    return await unisport.connect_ilias(owner, x_unisport_scope, x_unisport_affiliation, response, x_session_id)
