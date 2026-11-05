import os
from pathlib import Path
from typing import List, Literal
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    app_env: Literal['production', 'development', 'test'] = 'production'
    coordination_dir: str = '.coordination'
    # Private diagnostics; never serve this directory as static content.
    observability_dir: str = '.observability'
    observability_retention_days: int = Field(default=7, ge=1, le=30)
    observability_max_events: int = Field(default=50000, ge=100, le=500000)
    observability_queue_size: int = Field(default=2048, ge=16, le=10000)
    observability_max_mb: int = Field(default=32, ge=4, le=256)
    # Empty disables admin routes. Independent of all student credentials.
    admin_api_key: str = ''
    # Raw pages can contain student data. Capture only with explicit dev consent.
    capture_failed_html: bool = False
    failed_html_retention_hours: int = Field(default=24, ge=1, le=168)
    failed_html_max_files: int = Field(default=20, ge=1, le=100)
    failed_html_max_bytes: int = Field(default=1048576, ge=1024, le=5242880)

    @property
    def coordination_path(self) -> Path:
        return BASE_DIR / self.coordination_dir

    @property
    def observability_path(self) -> Path:
        return BASE_DIR / self.observability_dir

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
    # Shared across all workers using COORDINATION_DIR, including file streams.
    outbound_max_concurrency: int = Field(default=6, ge=1, le=64)
    outbound_per_session_concurrency: int = Field(default=2, ge=1, le=64)
    outbound_requests_per_second: float = Field(default=5.0, gt=0, le=1000)
    outbound_queue_limit: int = Field(default=512, ge=1, le=10000)
    outbound_per_session_queue_limit: int = Field(default=32, ge=1, le=1000)
    outbound_queue_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    outbound_read_retries: int = Field(default=2, ge=0, le=3)
    outbound_coalesce_max_bytes: int = Field(default=2_097_152, ge=0, le=8_388_608)
    outbound_media_origins: List[str] = ['https://opencast.unibe.ch', 'https://dist.opencast.unibe.ch']
    outbound_allow_local_ilias: bool = False
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
