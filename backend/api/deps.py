from backend.auth.session import SessionManager, session_manager
from backend.services.ilias_client import IliasClient, ilias_client


def get_session_manager() -> SessionManager:
    return session_manager


def get_ilias_client() -> IliasClient:
    return ilias_client

