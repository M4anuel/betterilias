import json
import logging
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

from backend.config import settings

logger = logging.getLogger("ilias.auth")


def sanitize_session_id(session_id: Optional[str]) -> str:
    """Sanitize session_id to avoid path traversal."""
    if not session_id:
        return "default"
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "", str(session_id))
    return cleaned if cleaned else "default"


class SessionManager:
    """Manages ILIAS session cookies and HTTP client sessions in single- or multi-tenant mode."""

    def __init__(self, session_id: Optional[str] = None, cookie_file: Optional[Path] = None):
        self._session_id = sanitize_session_id(session_id)
        self._cookie_file = cookie_file

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def cookie_file(self) -> Path:
        if self._cookie_file:
            return self._cookie_file
        if self._session_id and self._session_id != "default":
            return settings.sessions_path / f"{self._session_id}.json"
        return settings.cookie_path

    @staticmethod
    def generate_session_id() -> str:
        """Generate a cryptographically secure random session ID."""
        return secrets.token_urlsafe(32)

    def _read_data(self) -> Dict[str, Any]:
        if not self.cookie_file.exists():
            return {}
        try:
            with open(self.cookie_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read session data from {self.cookie_file}: {e}")
            return {}

    def save_cookies(self, cookies: Dict[str, str], metadata: Optional[Dict[str, Any]] = None) -> None:
        """Save cookies dictionary to JSON file."""
        self.cookie_file.parent.mkdir(parents=True, exist_ok=True)
        current_data = self._read_data()
        merged_meta = current_data.get("metadata", {})
        if metadata:
            merged_meta.update(metadata)
        data = {
            "session_id": self.session_id,
            "saved_at": current_data.get("saved_at") or datetime.now(timezone.utc).isoformat(),
            "last_accessed": datetime.now(timezone.utc).isoformat(),
            "ilias_base_url": settings.ilias_base_url,
            "cookies": cookies,
            "metadata": merged_meta,
        }
        with open(self.cookie_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved {len(cookies)} session cookies for session '{self.session_id}' to {self.cookie_file}")

    def load_cookies(self) -> Dict[str, str]:
        """Load cookies dictionary from JSON file."""
        data = self._read_data()
        return data.get("cookies", {})

    def load_metadata(self) -> Dict[str, Any]:
        """Load session metadata."""
        data = self._read_data()
        return data.get("metadata", {})

    def save_metadata(self, metadata: Dict[str, Any]) -> None:
        """Update session metadata."""
        if not self.cookie_file.exists():
            return
        data = self._read_data()
        merged = data.get("metadata", {})
        merged.update(metadata)
        data["metadata"] = merged
        data["last_accessed"] = datetime.now(timezone.utc).isoformat()
        with open(self.cookie_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def has_cookies(self) -> bool:
        """Check if cookies file exists and has PHPSESSID."""
        cookies = self.load_cookies()
        return bool(cookies.get("PHPSESSID"))

    def clear_session(self) -> bool:
        """Delete stored cookies file."""
        if self.cookie_file.exists():
            try:
                self.cookie_file.unlink()
                logger.info(f"Session cookies cleared for session '{self.session_id}'")
                return True
            except Exception as e:
                logger.error(f"Failed to delete session file {self.cookie_file}: {e}")
                return False
        return False

    @classmethod
    def cleanup_old_sessions(cls, max_age_hours: int = 72) -> int:
        """Remove sessions that have not been accessed within max_age_hours."""
        count = 0
        sessions_dir = settings.sessions_path
        if not sessions_dir.exists():
            return 0
        now = datetime.now(timezone.utc)
        for p in sessions_dir.glob("*.json"):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                last = data.get("last_accessed") or data.get("saved_at")
                if last:
                    dt = datetime.fromisoformat(last)
                    if (now - dt).total_seconds() > max_age_hours * 3600:
                        p.unlink()
                        count += 1
            except Exception:
                pass
        return count

    def get_http_client(self) -> httpx.AsyncClient:
        """Construct an authenticated httpx.AsyncClient with stored cookies and matching User-Agent."""
        cookies = self.load_cookies()
        metadata = self.load_metadata()
        ua = metadata.get("user_agent") or settings.user_agent
        headers = {
            "User-Agent": ua,
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
            return False, "Keine Sitzungs-Cookies gefunden. Bitte zuerst auf ilias.unibe.ch anmelden."

        test_url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilPersonalDesktopGUI"
        async with self.get_http_client() as client:
            try:
                response = await client.get(test_url)
                if response.status_code in (401, 403):
                    return False, f"HTTP {response.status_code} Nicht autorisiert"
                if response.status_code != 200:
                    return False, f"Unerwarteter Server-Status {response.status_code}"

                # 1. Check if redirected to login page or switch edu-id
                final_url = str(response.url).lower()
                login_tokens = ["login.php", "wayf", "eduid", "aai", "shibboleth", "cmd=force_login", "shib_login"]
                if any(token in final_url for token in login_tokens):
                    return False, "Sitzung abgelaufen oder Weiterleitung zum Login"

                text_lower = response.text.lower()
                if (
                    "cmd=force_login" in text_lower
                    or "login.php?client_id=" in text_lower
                    or "login.php?target=" in text_lower
                    or "shib_login.php" in text_lower
                ):
                    return False, "Sitzung abgelaufen: Login-Aufforderung erkannt"

                soup = BeautifulSoup(response.text, "html.parser")
                
                # 2. Check for login forms or startup screen
                if soup.find("input", {"name": "username"}) and soup.find("input", {"name": "password"}):
                    return False, "Sitzung abgelaufen: Login-Formular angezeigt"

                if soup.find(id="ilStartupSection") or soup.find(class_="ilStartupSection") or soup.find(id="ilStartupFrame"):
                    return False, "Sitzung abgelaufen: Startbildschirm angezeigt"

                # 3. Check for positive indicators of an authenticated ILIAS session
                # - User avatar / profile button
                # - Main menu / navigation
                # - Personal desktop container
                user_name = None
                user_elem = (
                    soup.select_one(".il-maincontrols-metabar a.il-user-avatar")
                    or soup.select_one("#il_mbt_usr")
                    or soup.select_one(".ilTopTitle")
                    or soup.select_one("span.il-avatar-initials")
                    or soup.select_one("a.il-user-avatar")
                )
                if user_elem:
                    user_name = user_elem.get_text(strip=True) or user_elem.get("title")

                desktop_present = bool(
                    soup.select_one(".il-view-content")
                    or soup.select_one("#il_mbt_pdesk")
                    or soup.select_one("#ilTab")
                    or soup.find(id="mainspace")
                    or soup.select_one(".il-item-group")
                )

                if user_elem or desktop_present:
                    return True, user_name or "Angemeldet"

                # 4. If neither user avatar nor desktop is present, verify unauthorized reason
                og_title = soup.find("meta", property="og:title")
                og_title_content = og_title.get("content", "").lower() if og_title else ""

                unauth_phrases = [
                    "kein zugriffsrecht",
                    "sitzung abgelaufen",
                    "ihre sitzung ist abgelaufen",
                    "sie sind nicht angemeldet",
                    "session expired",
                    "you are not logged in",
                ]
                if "kein zugriffsrecht" in og_title_content or any(phrase in text_lower for phrase in unauth_phrases):
                    return False, "Sitzung auf ilias.unibe.ch ist abgelaufen oder nicht angemeldet. Bitte logge dich im Browser auf ilias.unibe.ch ein."

                return False, "ILIAS Dashboard-Struktur konnte nicht verifiziert werden."

            except Exception as e:
                logger.error(f"Error verifying ILIAS session: {e}")
                return False, f"Verifizierung fehlgeschlagen: {str(e)}"


# Default singleton instance
session_manager = SessionManager()
