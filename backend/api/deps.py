from typing import Optional
from fastapi import Cookie, Depends, Header, Request

from backend.auth.session import SessionManager, session_manager
from backend.services.ilias_client import IliasClient, ilias_client


def get_session_manager(
    request: Request,
    x_session_id: Optional[str] = Header(None, alias="X-Session-Id"),
    betterilias_session: Optional[str] = Cookie(None),
) -> SessionManager:
    """
    Resolve SessionManager based on tenant identifier:
    1. Header X-Session-Id
    2. Cookie betterilias_session
    3. Authorization: Bearer <session_id>
    4. Query parameter ?session_id=... (for file streams / direct downloads)
    5. Fallback to default single-tenant session_manager (for legacy tests & CLI)
    """
    session_id = x_session_id or betterilias_session

    if not session_id:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_id = auth_header.split(" ", 1)[1].strip()

    if not session_id:
        session_id = request.query_params.get("session_id")

    if session_id:
        try:
            return SessionManager(session_id=session_id)
        except Exception:
            pass

    return session_manager


def get_ilias_client(
    manager: SessionManager = Depends(get_session_manager),
) -> IliasClient:
    """
    Returns an IliasClient instance configured with the resolved tenant's SessionManager.
    """
    if manager is session_manager:
        return ilias_client
    return IliasClient(manager=manager)

