"""Explicit user consent, scoped to the validated current connection."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.api.deps import get_session_manager
from backend.config import settings
from backend import diagnostic_reports as reports
from backend.auth.session import SessionManager
from backend.i18n import t
from backend.observability import emit

router = APIRouter(prefix='/diagnostics', tags=['Consented diagnostics'])


def storage(fn, *args):
    try:
        return fn(*args)
    except (OSError, sqlite3.Error) as exc:
        emit('report.unavailable', status=503, error=exc)
        raise HTTPException(503, detail=t('reports.unavailable'), headers={'Cache-Control': 'no-store'}) from None


class Preference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['ask', 'always', 'never']


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    capture_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    decision: Literal['once', 'always', 'decline']
    share_upstream: bool = False


class ShareUpstreamRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    report_id: str = Field(pattern=r'^[a-f0-9]{32}$')


class UpstreamReportPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(max_length=64)
    status: int = Field(default=0, ge=0, le=599)
    app_version: str = Field(default='unknown', max_length=32)
    build: str = Field(default='', max_length=64)
    distribution: Literal['self-hosted'] = 'self-hosted'
    instance_origin: str = Field(default='', max_length=256)
    operation: str | None = Field(default=None, max_length=64)
    outcome: str | None = Field(default=None, max_length=64)
    parser: str | None = Field(default=None, max_length=80)
    structure: dict | None = None
    occurred_at: float | None = None


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
async def decide(payload: Decision, request: Request, response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    result = storage(reports.decide, manager.session_id, payload.capture_id, payload.decision)
    if result is None:
        raise HTTPException(410, detail=t('reports.expired'), headers={'Cache-Control': 'no-store'})
    if payload.share_upstream and result.get('report_id') and settings.is_self_hosted and settings.allow_upstream_error_sharing:
        try:
            origin = request.url.hostname or ''
            upstream_res = await reports.forward_report_upstream(result['report_id'], instance_origin=origin)
            result['upstream_shared'] = True
            result['upstream_report_id'] = upstream_res.get('report_id')
        except Exception:
            result['upstream_shared'] = False
            result['upstream_error'] = 'failed'
    return result


@router.post('/upstream-report')
def receive_upstream_report(payload: UpstreamReportPayload, request: Request, response: Response):
    """Receive an error report shared from a self-hosted BetterIlias distribution."""
    response.headers['Cache-Control'] = 'no-store'
    if payload.code not in reports.CODES:
        raise HTTPException(422, detail=t('reports.invalid_code'))
    data = payload.model_dump()
    if not data.get('instance_origin') and request.client:
        data['instance_origin'] = request.client.host
    try:
        report_id = reports.ingest_upstream_report(data)
        return {'received': True, 'report_id': report_id}
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))


@router.post('/share-upstream')
async def share_upstream(payload: ShareUpstreamRequest, request: Request, response: Response, manager: SessionManager = Depends(get_session_manager)):
    """Share an existing local error report with the central betterilias.ch instance."""
    response.headers['Cache-Control'] = 'no-store'
    if not settings.is_self_hosted or not settings.allow_upstream_error_sharing:
        raise HTTPException(403, detail=t('reports.sharing_disabled'))
    try:
        origin = request.url.hostname or ''
        result = await reports.forward_report_upstream(payload.report_id, instance_origin=origin)
        if not result:
            raise HTTPException(404, detail=t('reports.not_found'))
        return {'shared': True, 'upstream_result': result}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, detail=t('reports.upstream_failed')) from exc


@router.post('/client-capture')
def client_capture(payload: ClientFailure, response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    return storage(reports.prepare, manager.session_id, payload.code)


@router.delete('/reports')
def delete_reports(response: Response, manager: SessionManager = Depends(get_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    storage(reports.delete_owned, manager.session_id)
    return {'deleted': True}
