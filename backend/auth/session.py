import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

from backend.config import settings

logger = logging.getLogger("ilias.auth")


class SessionManager:
    """Manages ILIAS session cookies and HTTP client sessions."""

    def __init__(self, cookie_file: Optional[Path] = None):
        self._cookie_file = cookie_file

    @property
    def cookie_file(self) -> Path:
        return self._cookie_file or settings.cookie_path

    def save_cookies(self, cookies: Dict[str, str], metadata: Optional[Dict[str, Any]] = None) -> None:
        """Save cookies dictionary to JSON file."""
        self.cookie_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "ilias_base_url": settings.ilias_base_url,
            "cookies": cookies,
            "metadata": metadata or {}
        }
        with open(self.cookie_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved {len(cookies)} session cookies to {self.cookie_file}")

    def load_cookies(self) -> Dict[str, str]:
        """Load cookies dictionary from JSON file."""
        if not self.cookie_file.exists():
            return {}
        try:
            with open(self.cookie_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("cookies", {})
        except Exception as e:
            logger.error(f"Failed to read cookies from {self.cookie_file}: {e}")
            return {}

    def has_cookies(self) -> bool:
        """Check if cookies file exists and has PHPSESSID."""
        cookies = self.load_cookies()
        return bool(cookies.get("PHPSESSID"))

    def clear_session(self) -> bool:
        """Delete stored cookies file."""
        if self.cookie_file.exists():
            self.cookie_file.unlink()
            logger.info("Session cookies cleared")
            return True
        return False

    def get_http_client(self) -> httpx.AsyncClient:
        """Construct an authenticated httpx.AsyncClient with stored cookies."""
        cookies = self.load_cookies()
        headers = {
            "User-Agent": settings.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": settings.ilias_base_url,
        }
        return httpx.AsyncClient(
            base_url=settings.ilias_base_url,
            cookies=cookies,
            headers=headers,
            timeout=settings.http_timeout_seconds,
            follow_redirects=True,
        )

    async def verify_session(self) -> Tuple[bool, Optional[str]]:
        """
        Verify if the stored session is valid by pinging the Personal Desktop.
        Returns (is_valid, user_or_message).
        """
        if not self.has_cookies():
            return False, "No session cookies found. Please log in."

        test_url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilPersonalDesktopGUI"
        async with self.get_http_client() as client:
            try:
                response = await client.get(test_url)
                if response.status_code != 200:
                    return False, f"Unexpected response status {response.status_code}"

                # Check if redirected to login page or switch edu-id
                final_url = str(response.url).lower()
                if "login.php" in final_url or "eduid" in final_url or "wayf" in final_url:
                    return False, "Session expired or redirected to login"

                soup = BeautifulSoup(response.text, "html.parser")
                
                # Check for login forms or error prompts
                if soup.find("input", {"name": "username"}) and soup.find("input", {"name": "password"}):
                    return False, "Session expired: login form detected"

                # Check for indicators of an authenticated ILIAS session
                # 1. User avatar / profile button
                # 2. Main menu / navigation
                # 3. Personal desktop container
                user_name = None
                user_elem = (
                    soup.select_one(".il-maincontrols-metabar a.il-user-avatar")
                    or soup.select_one("#il_mbt_usr")
                    or soup.select_one(".ilTopTitle")
                    or soup.select_one("span.il-avatar-initials")
                )
                if user_elem:
                    user_name = user_elem.get_text(strip=True) or user_elem.get("title")

                desktop_present = bool(
                    soup.select_one(".il-view-content")
                    or soup.select_one("#il_mbt_pdesk")
                    or soup.select_one("#ilTab")
                    or soup.find(id="mainspace")
                    or "ilPersonalDesktopGUI" in response.text
                )

                if desktop_present:
                    return True, user_name or "Authenticated"

                return False, "Could not verify ILIAS dashboard page structure"

            except Exception as e:
                logger.error(f"Error verifying ILIAS session: {e}")
                return False, f"Verification failed: {str(e)}"


# Default singleton instance
session_manager = SessionManager()
