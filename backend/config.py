import os
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # ILIAS Configuration
    ilias_base_url: str = "https://ilias.unibe.ch"
    ilias_client_id: str = "ilias3_unibe"
    
    # Storage files and paths
    session_cookie_file: str = "session_cookies.json"
    sessions_dir: str = ".sessions"
    browser_profile_dir: str = ".browser_profile"
    logs_dir: str = "logs"

    # Server Configuration
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    # Playwright Settings
    playwright_headless: bool = False
    playwright_timeout_seconds: int = 240  # 4 minutes to accommodate 2FA / SWITCH edu-ID login
    
    # HTTP Client Configuration
    http_timeout_seconds: float = 30.0
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )

    @property
    def cookie_path(self) -> Path:
        p = Path(self.session_cookie_file)
        if not p.is_absolute():
            return BASE_DIR / p
        return p

    @property
    def sessions_path(self) -> Path:
        p = Path(self.sessions_dir)
        if not p.is_absolute():
            return BASE_DIR / p
        return p

    @property
    def browser_profile_path(self) -> Path:
        p = Path(self.browser_profile_dir)
        if not p.is_absolute():
            return BASE_DIR / p
        return p

    @property
    def log_path(self) -> Path:
        p = Path(self.logs_dir)
        if not p.is_absolute():
            return BASE_DIR / p
        return p

settings = Settings()
