"""Read-only foundation for an admin dashboard; disabled without a separate key."""
import secrets
import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, SecretStr

from backend.config import settings
from backend.i18n import t
from backend.observability import CATEGORIES, EVENTS, emit, get_store
from backend.outbound_budget import OutboundBudget
from backend import admin_sessions


def administrator(request: Request, response: Response, x_admin_key: str | None = Header(default=None)):
    response.headers['Cache-Control'] = 'no-store'
    configured = settings.admin_api_key
    if len(configured) < 43:
        raise HTTPException(404, detail=t('Not Found'))
    try:
        accepted = (secrets.compare_digest(x_admin_key.encode(), configured.encode()) if x_admin_key is not None
                    else bool(admin_sessions.expires_at(request.cookies.get(admin_sessions.COOKIE))))
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    if not accepted:
        emit('admin.rejected', status=404)
        raise HTTPException(404, detail=t('Not Found'), headers={'Cache-Control': 'no-store'})
    emit('admin.read')


router = APIRouter(prefix='/admin', tags=['Private diagnostics'])


def browser_mutation(x_admin_request: str = Header(default='')):
    # Cross-site forms cannot manufacture this header. Combined with Strict
    # SameSite cookies, this prevents ambient-cookie login/logout CSRF.
    if x_admin_request != '1':
        raise HTTPException(403, detail=t('validation.invalid'))


class AdminLogin(BaseModel):
    key: SecretStr = Field(min_length=1, max_length=256)


@router.post('/session', dependencies=[Depends(browser_mutation)])
def login(payload: AdminLogin, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    if not admin_sessions.enabled():
        raise HTTPException(404, detail=t('Not Found'))
    try:
        if not secrets.compare_digest(payload.key.get_secret_value().encode(), settings.admin_api_key.encode()):
            throttled = admin_sessions.record_failure()
            emit('admin.rejected', status=429 if throttled else 401)
            raise HTTPException(429 if throttled else 401, detail=t('admin.login_failed'),
                                headers={'Retry-After': '60'} if throttled else None)
        token, expires = admin_sessions.issue()
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    response.set_cookie(admin_sessions.COOKIE, token, max_age=admin_sessions.TTL,
                        secure=settings.app_env == 'production', httponly=True,
                        samesite='strict', path='/api/admin')
    emit('admin.login')
    return {'authenticated': True, 'expires_at': expires}


@router.get('/session')
def session(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    if not admin_sessions.enabled():
        raise HTTPException(404, detail=t('Not Found'))
    try:
        expires = admin_sessions.expires_at(request.cookies.get(admin_sessions.COOKIE))
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    return {'authenticated': bool(expires), 'expires_at': expires}


@router.delete('/session', dependencies=[Depends(browser_mutation)])
def logout(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    try:
        admin_sessions.revoke(request.cookies.get(admin_sessions.COOKIE))
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    response.delete_cookie(admin_sessions.COOKIE, path='/api/admin',
                           secure=settings.app_env == 'production', httponly=True, samesite='strict')
    emit('admin.logout')
    return {'authenticated': False}


@router.get('/events', dependencies=[Depends(administrator)])
def events(before: int | None = Query(default=None, ge=1, le=9223372036854775807),
           limit: int = Query(default=100, ge=1, le=200),
           category: str | None = Query(default=None), code: str | None = Query(default=None)):
    if (category is not None and category not in CATEGORIES) or (code is not None and code not in EVENTS):
        raise HTTPException(422, detail=t('validation.invalid'))
    try:
        rows = get_store().read(before=before, limit=limit, category=category, code=code)
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
    return {'events': rows, 'next_before': rows[-1]['id'] if len(rows) == limit else None}


@router.get('/summary', dependencies=[Depends(administrator)])
def summary():
    try:
        return {'diagnostics': get_store().summary(), 'outbound': OutboundBudget().snapshot(),
                'event_catalogue': EVENTS}
    except (OSError, sqlite3.Error):
        raise HTTPException(503, detail=t('diagnostics.unavailable')) from None
