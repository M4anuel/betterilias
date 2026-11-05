"""Explicit user consent, scoped to the validated current connection."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.api.deps import get_session_manager
from backend import diagnostic_reports as reports
from backend.auth.session import SessionManager
from backend.i18n import t
from backend.observability import emit

router = APIRouter(prefix='/diagnostics', tags=['Consented diagnostics'])


def storage(fn, *args):
    try:
        return fn(*args)
    except (OSError, sqlite3.Error):
        emit('report.unavailable', status=503)
        raise HTTPException(503, detail=t('reports.unavailable'), headers={'Cache-Control': 'no-store'}) from None


class Preference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['ask', 'always', 'never']


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    capture_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    decision: Literal['once', 'always', 'decline']


class ClientFailure(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: Literal['CLIENT_RENDER', 'CLIENT_CONNECTION']


@router.get('/preference')
def get_preference(response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    return {'mode': storage(reports.preference, manager.session_id), **reports.disclosure()}


@router.put('/preference')
def set_preference(payload: Preference, response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    if payload.mode == 'always' and not reports.disclosure()['available']:
        raise HTTPException(503, detail=t('reports.unavailable'))
    return {'mode': storage(reports.preference, manager.session_id, payload.mode)}


@router.post('/decision')
def decide(payload: Decision, response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    result = storage(reports.decide, manager.session_id, payload.capture_id, payload.decision)
    if result is None:
        raise HTTPException(410, detail=t('reports.expired'), headers={'Cache-Control': 'no-store'})
    return result


@router.post('/client-capture')
def client_capture(payload: ClientFailure, response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    return storage(reports.prepare, manager.session_id, payload.code)


@router.delete('/reports')
def delete_reports(response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    storage(reports.delete_owned, manager.session_id)
    return {'deleted': True}
