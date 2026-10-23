from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import httpx
import pytest

from backend.auth.session import SessionManager
from backend.services.ilias_client import IliasClient, SessionExpiredError

FIXTURES_UNIBE = Path(__file__).parent / "fixtures" / "unibe"


def create_mock_response(status_code: int = 200, url: str = "https://ilias.unibe.ch/ilias.php", text: str = "") -> httpx.Response:
    request = httpx.Request("GET", url)
    return httpx.Response(status_code=status_code, text=text, request=request)


def test_session_loss_on_status_codes():
    client = IliasClient()
    for code in (401, 403):
        resp = create_mock_response(status_code=code)
        with pytest.raises(SessionExpiredError):
            client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php?ref_id=123")


def test_session_loss_on_login_redirect():
    client = IliasClient()
    redirect_urls = [
        "https://ilias.unibe.ch/login.php?client_id=ilias3_unibe&cmd=force_login",
        "https://eduid.ch/idp/profile/SAML2/Redirect/SSO?execution=e1s1",
        "https://wayf.switch.ch/aai/WAYF",
        "https://ilias.unibe.ch/shib_login.php",
    ]
    for url in redirect_urls:
        resp = create_mock_response(url=url, text="Please log in")
        with pytest.raises(SessionExpiredError):
            client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php?ref_id=123")


def test_session_loss_on_force_login_marker():
    client = IliasClient()
    html = """
    <html>
      <body>
        <div class="ilStartupSection">
          <a href="login.php?target=crs_3695522&client_id=ilias3_unibe&cmd=force_login">Anmelden</a>
        </div>
      </body>
    </html>
    """
    resp = create_mock_response(text=html)
    with pytest.raises(SessionExpiredError):
        client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php?ref_id=3695522")


def test_session_loss_on_unauthorized_phrases():
    client = IliasClient()
    phrases = [
        '<meta property="og:title" content="Kein Zugriffsrecht">',
        '<h1>Kein Zugriffsrecht</h1>',
        '<div class="alert alert-danger">Ihre Sitzung ist abgelaufen</div>',
        '<p>Sie sind nicht angemeldet</p>',
        '<span>Session expired</span>',
    ]
    for phrase in phrases:
        html = f"<html><head></head><body>{phrase}</body></html>"
        resp = create_mock_response(text=html)
        with pytest.raises(SessionExpiredError):
            client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php")


def test_session_loss_on_login_form():
    client = IliasClient()
    html = """
    <form action="login.php" method="post">
      <input type="text" name="username" />
      <input type="password" name="password" />
    </form>
    """
    resp = create_mock_response(text=html)
    with pytest.raises(SessionExpiredError):
        client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php")


def test_fixtures_do_not_trigger_false_positives():
    client = IliasClient()
    fixture_files = list(FIXTURES_UNIBE.glob("*.html"))
    assert len(fixture_files) >= 5, "Fixture files should exist"

    for file_path in fixture_files:
        content = file_path.read_text(encoding="utf-8", errors="replace")
        resp = create_mock_response(text=content)
        # Must NOT raise SessionExpiredError
        try:
            client._check_response_for_session_loss(resp, "https://ilias.unibe.ch/ilias.php")
        except SessionExpiredError:
            pytest.fail(f"Legitimate fixture {file_path.name} triggered false positive SessionExpiredError!")


@pytest.mark.asyncio
async def test_session_manager_verify_session_expired():
    manager = SessionManager()
    manager.has_cookies = MagicMock(return_value=True)

    unauth_html = """
    <html>
      <head><meta property="og:title" content="Kein Zugriffsrecht"></head>
      <body>
        <a href="login.php?client_id=ilias3_unibe&cmd=force_login">Anmelden</a>
      </body>
    </html>
    """

    mock_resp = create_mock_response(status_code=200, text=unauth_html)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    manager.get_http_client = MagicMock(return_value=mock_client)

    is_valid, msg = await manager.verify_session()
    assert is_valid is False
    assert (
        "login prompt detected" in msg.lower()
        or "unauthorized" in msg.lower()
        or "expired" in msg.lower()
        or "abgelaufen" in msg.lower()
    )


@pytest.mark.asyncio
async def test_session_manager_verify_session_authenticated():
    manager = SessionManager()
    manager.has_cookies = MagicMock(return_value=True)

    auth_html = """
    <html>
      <body>
        <div class="il-maincontrols-metabar">
          <a class="il-user-avatar" title="Manuel Studer">MS</a>
        </div>
        <div class="il-view-content">Personal Desktop Content</div>
      </body>
    </html>
    """

    mock_resp = create_mock_response(status_code=200, text=auth_html)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    manager.get_http_client = MagicMock(return_value=mock_client)

    is_valid, user = await manager.verify_session()
    assert is_valid is True
    assert user == "Manuel Studer" or "MS" in user

