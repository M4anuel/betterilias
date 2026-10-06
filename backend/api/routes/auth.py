from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from typing import Dict, Any

from backend.api.deps import get_ilias_client, get_session_manager
from backend.auth.playwright_login import run_browser_login
from backend.auth.session import SessionManager
from backend.schemas import AuthStatus, ManualCookiesInput
from backend.services.ilias_client import IliasClient

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/status", response_model=AuthStatus)
async def check_status(client: IliasClient = Depends(get_ilias_client)):
    """Check whether the current ILIAS session is valid."""
    return await client.get_auth_status()


@router.post("/login-browser")
async def trigger_browser_login():
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
    return {
        "success": True,
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

    manager.save_cookies(cookies, metadata={"source": "manual_input"})
    return {"success": True, "message": "Cookies saved successfully."}


@router.post("/logout")
async def logout(manager: SessionManager = Depends(get_session_manager)):
    """Clear stored session cookies."""
    cleared = manager.clear_session()
    return {"success": True, "message": "Session cleared." if cleared else "No active session was found."}

