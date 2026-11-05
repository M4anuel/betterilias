"""Read-only foundation for an admin dashboard; disabled without a separate key."""
import secrets
import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from backend.config import settings
from backend.i18n import t
from backend.observability import emit, get_store
from backend.outbound_budget import OutboundBudget


def administrator(response: Response, x_admin_key: str = Header(default='')):
    response.headers['Cache-Control'] = 'no-store'
    configured = settings.admin_api_key
    if len(configured) < 43:
        raise HTTPException(404, detail=t('Not Found'))
    if not secrets.compare_digest(x_admin_key.encode(), configured.encode()):
        emit('admin.rejected', status=404)
        raise HTTPException(404, detail=t('Not Found'), headers={'Cache-Control': 'no-store'})
    emit('admin.read')


router = APIRouter(prefix='/admin', tags=['Private diagnostics'], dependencies=[Depends(administrator)])


@router.get('/events')
def events(before: int | None = Query(default=None, ge=1, le=9223372036854775807),
           limit: int = Query(default=100, ge=1, le=200)):
    try:
        rows = get_store().read(before=before, limit=limit)
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    return {'events': rows, 'next_before': rows[-1]['id'] if len(rows) == limit else None}


@router.get('/summary')
def summary():
    try:
        return {'diagnostics': get_store().summary(), 'outbound': OutboundBudget().snapshot()}
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
