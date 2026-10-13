from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from typing import Dict, Any

from backend.api.deps import get_ilias_client, get_session_manager
from backend.auth.playwright_login import run_browser_login
from backend.auth.session import SessionManager
from backend.schemas import (
    AuthStatus,
    ManualCookiesInput,
    ExtensionSyncInput,
    ExtensionSyncResponse,
)
from backend.services.ilias_client import IliasClient

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/status", response_model=AuthStatus)
async def check_status(
    client: IliasClient = Depends(get_ilias_client),
    manager: SessionManager = Depends(get_session_manager)
):
    """Check whether the current ILIAS session is valid."""
    status_data = await client.get_auth_status()
    if manager.session_id and manager.session_id != "default":
        status_data.session_id = manager.session_id
    return status_data


@router.post("/sync", response_model=ExtensionSyncResponse)
async def sync_extension_cookies(
    payload: ExtensionSyncInput,
    manager: SessionManager = Depends(get_session_manager),
):
    """
    Synchronize ILIAS session cookies from the Chrome Extension.
    Creates or updates an isolated tenant session and verifies it with ILIAS.
    """
    cookies = payload.cookies
    if not cookies or not cookies.get("PHPSESSID"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PHPSESSID cookie is missing from the submitted payload."
        )

    # Ensure ilClientId is set (Uni Bern requires ilias3_unibe client identifier)
    from backend.config import settings
    if "ilClientId" not in cookies:
        cookies["ilClientId"] = settings.ilias_client_id

    # Determine or generate session_id
    session_id = payload.session_id or (manager.session_id if manager.session_id != "default" else None)
    if not session_id:
        session_id = SessionManager.generate_session_id()

    metadata: Dict[str, Any] = {
        "source": payload.source or "extension",
    }
    if payload.user_agent:
        metadata["user_agent"] = payload.user_agent

    target_manager = SessionManager(session_id=session_id)
    target_manager.save_cookies(
        cookies,
        metadata=metadata
    )

    # Verify session against Uni Bern ILIAS
    is_valid, user_or_msg = await target_manager.verify_session()

    if is_valid:
        meta = target_manager.load_metadata()
        meta["user_name"] = user_or_msg
        target_manager.save_metadata(meta)

        # Also update default single-tenant session_manager for seamless local fallback
        try:
            from backend.auth.session import session_manager as default_manager
            default_manager.save_cookies(cookies, metadata=meta)
        except Exception:
            pass

    return ExtensionSyncResponse(
        success=True,
        authenticated=is_valid,
        session_id=session_id,
        user_name=user_or_msg if is_valid else None,
        message="Erfolgreich mit ILIAS synchronisiert" if is_valid else f"Sitzung ungültig: {user_or_msg}"
    )


@router.post("/login-browser")
async def trigger_browser_login(
    manager: SessionManager = Depends(get_session_manager)
):
    """
    Launch a headed Playwright browser to allow manual SWITCH edu-ID login.
    Waits until the user logs in and returns captured session cookies.
    """
    success, cookies, message = await run_browser_login(headless=False)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    # Save to manager
    manager.save_cookies(cookies, metadata={"source": "browser_login"})

    return {
        "success": True,
        "session_id": manager.session_id if manager.session_id != "default" else None,
        "message": message,
        "cookies_captured": list(cookies.keys()),
    }


@router.post("/cookies")
async def set_cookies_manually(
    payload: ManualCookiesInput,
    manager: SessionManager = Depends(get_session_manager)
):
    """
    Manually inject session cookies (PHPSESSID, ilClientId) from browser devtools.
    """
    cookies: Dict[str, str] = {
        "PHPSESSID": payload.phpsessid,
        "ilClientId": payload.il_client_id or "ilias3_unibe",
    }
    if payload.additional_cookies:
        cookies.update(payload.additional_cookies)

    target_manager = manager
    if payload.session_id:
        target_manager = SessionManager(session_id=payload.session_id)

    target_manager.save_cookies(cookies, metadata={"source": "manual_input"})
    return {
        "success": True,
        "session_id": target_manager.session_id if target_manager.session_id != "default" else None,
        "message": "Cookies saved successfully."
    }


@router.post("/logout")
async def logout(manager: SessionManager = Depends(get_session_manager)):
    """Clear stored session cookies for the current tenant."""
    cleared = manager.clear_session()
    return {"success": True, "message": "Session cleared." if cleared else "No active session was found."}

