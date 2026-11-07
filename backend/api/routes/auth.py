from backend.observability import audit
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from backend.i18n import t
from backend.config import settings
from backend.api.deps import get_ilias_client, get_session_manager, get_optional_session_manager, valid_session_id, browser_cookie
from backend.auth.session import SessionManager
from backend.schemas import AuthStatus, ExtensionSyncInput, ExtensionSyncResponse, MobileSessionResponse
from backend.services.ilias_client import IliasClient
from backend.coordination import issue_handoff, claim_handoff

router = APIRouter(prefix='/auth', tags=['Authentication'])


@router.post('/mobile-session', response_model=MobileSessionResponse)
@audit('auth_handoff')
async def prepare_mobile_session(response: Response,
    client: IliasClient = Depends(get_ilias_client),
    manager: SessionManager = Depends(get_session_manager)):
    if manager.session_id == 'default' or not (await client.get_auth_status()).authenticated:
        raise HTTPException(401, detail=t('auth.session_required'))
    response.headers['Cache-Control'] = 'no-store'
    return {'handoff_token': issue_handoff(manager.session_id), 'expires_in': 60}


class HandoffClaim(BaseModel):
    token: str = Field(min_length=32, max_length=256)


@router.post('/claim')
@audit('auth_claim')
def claim_connection(payload: HandoffClaim, response: Response):
    sid = claim_handoff(payload.token)
    if not sid or not SessionManager(sid).has_cookies():
        raise HTTPException(401, detail=t('auth.handoff_expired'))
    browser_cookie(response, sid)
    return {'session_id': sid}


@router.get('/status', response_model=AuthStatus)
async def check_status(response: Response, manager=Depends(get_optional_session_manager)):
    response.headers['Cache-Control'] = 'no-store'
    if manager is None:
        return AuthStatus(authenticated=False, cookies_present=False)
    result = await IliasClient(manager=manager).get_auth_status()
    if result.authenticated:
        result.session_id = manager.session_id
        browser_cookie(response, manager.session_id)
    return result


@router.post('/sync', response_model=ExtensionSyncResponse)
@audit('auth_sync')
async def sync_extension_cookies(payload: ExtensionSyncInput, response: Response):
    # Extension-only login: never inherit an ambient browser/default session.
    response.headers['Cache-Control'] = 'no-store'
    raw_cookies = payload.cookies
    if not raw_cookies or not isinstance(raw_cookies, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t('PHPSESSID cookie is missing from the submitted payload.')
        )

    # Sanitize cookies: retain only legitimate ILIAS auth/session cookies
    # and filter out invalid/corrupt keys containing RFC 6265 separators (e.g. preferences|{})
    cookies: Dict[str, str] = {}
    for k, v in raw_cookies.items():
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        if any(c in k for c in ('{', '}', '|', '[', ']', '(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '?', '=')):
            continue
        if k in ("PHPSESSID", "ilClientId") or k.startswith("_shibsession_") or k.startswith("il_"):
            cookies[k] = v

    if not cookies.get("PHPSESSID"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t('PHPSESSID cookie is missing from the submitted payload.')
        )

    # Ensure ilClientId is set (Uni Bern requires ilias3_unibe client identifier)
    from backend.config import settings
    if "ilClientId" not in cookies:
        cookies["ilClientId"] = settings.ilias_client_id

    # Only an existing, exactly matching capability can be refreshed. Unknown
    # client-provided identifiers never select a filename or establish a session.
    sid = payload.session_id
    if not valid_session_id(sid) or not SessionManager(sid).has_cookies():
        sid = SessionManager.generate_session_id()
    metadata: Dict[str, Any] = {'source': payload.source or 'extension'}
    if payload.user_agent:
        metadata['user_agent'] = payload.user_agent
    # Invalid incoming cookies must not replace a working user's credentials.
    class IncomingSession(SessionManager):
        def load_cookies(self):
            return cookies

        def load_metadata(self):
            return metadata

    is_valid, user_or_msg = await IncomingSession(sid).verify_session()
    if is_valid:
        previous_user = SessionManager(sid).load_metadata().get('user_name')
        if previous_user and previous_user != user_or_msg:
            sid = SessionManager.generate_session_id()
        metadata['user_name'] = user_or_msg
        SessionManager(sid).save_cookies(cookies, metadata=metadata)
        if payload.session_id and valid_session_id(payload.session_id) and payload.session_id != sid:
            from backend.services.calendar_service import calendar_service
            calendar_service.migrate_tenant_state(payload.session_id, sid)
    return ExtensionSyncResponse(success=True, authenticated=is_valid,
        session_id=sid, user_name=user_or_msg if is_valid else None,
        message=t('Erfolgreich mit ILIAS synchronisiert') if is_valid else t('auth.session_required'))


@router.post('/logout')
@audit('auth_logout')
def logout(response: Response, manager: SessionManager = Depends(get_session_manager)):
    cleared = manager.clear_session()
    response.delete_cookie('betterilias_session', path='/api')
    response.headers['Cache-Control'] = 'no-store'
    return {'success': True, 'message': t('Session cleared.') if cleared else t('No active session was found.')}
