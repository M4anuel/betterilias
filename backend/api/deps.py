import re
from typing import Optional
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response
from backend.auth.session import SessionManager
from backend.services.ilias_client import IliasClient
from backend.i18n import t
from backend.config import settings
from backend.observability import emit


def browser_cookie(response: Response, session_id: str):
    response.headers['Cache-Control'] = 'no-store'
    response.set_cookie('betterilias_session', session_id, httponly=True,
                        secure=settings.app_env == 'production', samesite='strict', path='/api')


def valid_session_id(value):
    return isinstance(value, str) and value != 'default' and re.fullmatch(r'[a-zA-Z0-9_-]{1,256}', value)


def get_optional_session_manager(
    request: Request,
    x_session_id: Optional[str] = Header(None, alias='X-Session-Id'),
    betterilias_session: Optional[str] = Cookie(None),
) -> Optional[SessionManager]:
    auth = request.headers.get('Authorization', '')
    bearer = auth[7:] if auth.startswith('Bearer ') else None
    explicit = x_session_id or bearer
    sid = explicit or betterilias_session
    # Native GET resources use the cookie. Mutations require an explicit
    # credential, which cross-site forms cannot manufacture.
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and not explicit:
        return None
    if not valid_session_id(sid):
        return None
    manager = SessionManager(session_id=sid)
    return manager if manager.has_cookies() else None


def get_session_manager(response: Response, manager=Depends(get_optional_session_manager)) -> SessionManager:
    if manager is None:
        emit('auth.rejected', status=401)
        raise HTTPException(status_code=401, detail=t('auth.session_required'))
    # Bind native resource access on ordinary API responses too, so a preview
    # opened while the initial remote status check is pending already has a cookie.
    browser_cookie(response, manager.session_id)
    return manager


def get_ilias_client(request: Request, manager: SessionManager = Depends(get_session_manager)) -> IliasClient:
    # Native URLs are assembled by many existing service methods. Reject query
    # delimiters in public IDs before they can become a second native command.
    numeric = {'ref_id', 'course_id', 'exercise_id', 'ass_id', 'member_id',
               'delivered_id', 'session_ref_id', 'team_id', 'user_id'}
    for name, value in request.path_params.items():
        if name in numeric and not re.fullmatch(r'[0-9]+', str(value)):
            emit('input.invalid_identifier', status=400)
            raise HTTPException(400, detail=t('validation.invalid'))
    for name in ('ass_id', 'member_id', 'delivered_id'):
        values = request.query_params.getlist(name)
        if len(values) > 1 or any(not re.fullmatch(r'[0-9]+', value) for value in values):
            emit('input.invalid_identifier', status=400)
            raise HTTPException(400, detail=t('validation.invalid'))
    return IliasClient(manager=manager)
