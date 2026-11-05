from backend.i18n import t
import functools
import hashlib
import secrets
import time
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.config import settings
from backend.coordination import SharedLock, CoordinationBusy
from backend.observability import emit

logger = logging.getLogger("ilias.scraper.dumper")


class ScrapingParsingError(Exception):
    """Raised when an HTML scraping or parsing operation fails."""

    def __init__(self, context: str, message: str, dump_path: Optional[Path] = None, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.context = context
        self.message = message
        self.dump_path = dump_path
        self.original_error = original_error

    def __str__(self) -> str:
        dump_info = f" (HTML dumped to: {self.dump_path})" if self.dump_path else ""
        return f"Parsing failed for context '{self.context}': {self.message}{dump_info}"


METADATA_MARKER = '<!-- BetterIlias diagnostic metadata only -->'


def _prune_dumps_locked():
    directory = settings.log_path
    if not directory.exists():
        return
    raw_allowed = settings.app_env == 'development' and settings.capture_failed_html
    retained = []
    for path in directory.glob('failed_html_dump_*.html'):
        if path.is_symlink() or not path.is_file():
            continue
        info = path.stat()
        expired = info.st_mtime < time.time() - settings.failed_html_retention_hours * 3600
        # Purge old raw captures too when switching to private defaults.
        with path.open('rb') as file:
            metadata_only = file.read(len(METADATA_MARKER)).decode('ascii', errors='replace') == METADATA_MARKER
        if expired or info.st_size > settings.failed_html_max_bytes or (not raw_allowed and not metadata_only):
            path.unlink()
        else:
            retained.append((info.st_mtime, path))
    retained.sort(reverse=True)
    for _, path in retained[settings.failed_html_max_files:]:
        path.unlink()


def prune_failed_dumps(*, strict=False):
    try:
        with SharedLock('private-diagnostic-dumps', timeout=0).sync():
            _prune_dumps_locked()
    except (OSError, CoordinationBusy):
        if strict:
            raise
        # A diagnostic failure must not hide the original parser failure.
        pass


def dump_failed_html(
    html: str,
    context: str,
    error: Optional[Exception] = None,
    extra_info: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    """Write bounded metadata; raw HTML requires explicit development opt-in.

    Never persist exception text or extra_info: both can contain credentials or
    student content. Parser context is hashed to avoid dynamic names/identifiers.
    """
    emit('parser.failed')
    try:
        with SharedLock('private-diagnostic-dumps', timeout=0).sync():
            logs_dir = settings.log_path
            logs_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            if os.name != 'nt':
                logs_dir.chmod(0o700)
            _prune_dumps_locked()
            context_key = hashlib.sha256(str(context).encode()).hexdigest()[:12]
            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')
            dump_path = logs_dir / f'failed_html_dump_{context_key}_{timestamp}_{secrets.token_hex(4)}.html'
            raw_allowed = settings.app_env == 'development' and settings.capture_failed_html
            content = (html or '<!-- EMPTY HTML -->') if raw_allowed else METADATA_MARKER
            content = content.encode('utf-8', errors='replace')[:settings.failed_html_max_bytes]
            fd = os.open(dump_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as file:
                file.write(content)
            _prune_dumps_locked()
            return dump_path
    except (OSError, CoordinationBusy):
        return None


def safe_parser(context_name: str, check_empty: bool = False):
    """
    Decorator that wraps HTML parsing functions in a try/except block.
    If parsing fails (or returns empty data if check_empty=True), dumps the raw HTML.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(html_content: str, *args, **kwargs):
            if not html_content or not html_content.strip():
                dump_path = dump_failed_html("", context_name, error=ValueError(t('Empty HTML received')))
                raise ScrapingParsingError(
                    context=context_name,
                    message=t('Received empty HTML content'),
                    dump_path=dump_path
                )

            try:
                result = func(html_content, *args, **kwargs)
                if check_empty and not result:
                    dump_path = dump_failed_html(
                        html_content,
                        context_name,
                        error=ValueError(t('Parser returned empty result collection'))
                    )
                    raise ScrapingParsingError(
                        context=context_name,
                        message=t('Parser returned 0 items unexpectedly'),
                        dump_path=dump_path
                    )
                return result
            except ScrapingParsingError:
                raise
            except Exception as e:
                dump_path = dump_failed_html(html_content, context_name, error=e)
                raise ScrapingParsingError(
                    context=context_name,
                    message=t('DOM extraction error: {p0}', p0=str(e)),
                    dump_path=dump_path,
                    original_error=e
                ) from e
        return wrapper
    return decorator


def list_failed_dumps() -> List[Dict[str, Any]]:
    """List all failed HTML dumps in logs directory."""
    prune_failed_dumps()
    logs_dir = settings.log_path
    if not logs_dir.exists():
        return []

    dumps = []
    for file_path in logs_dir.glob("failed_html_dump_*.html"):
        stat = file_path.stat()
        name = file_path.name
        # Extract context and timestamp from failed_html_dump_{context}_{timestamp}.html
        match = re.match(r"failed_html_dump_(.+?)_(\d{8}_\d{6})(?:_\d+)?(?:_[a-f0-9]+)?\.html", name)
        context = match.group(1) if match else "unknown"
        created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()

        dumps.append({
            "filename": name,
            "context": context,
            "created_at": created_at,
            "size_bytes": stat.st_size,
            "file_path": str(file_path.resolve())
        })

    # Sort newest first
    dumps.sort(key=lambda x: x["created_at"], reverse=True)
    return dumps


def get_dump_content(filename: str) -> Optional[str]:
    """Retrieve content of a specific dump file securely."""
    # Prevent path traversal
    safe_name = Path(filename).name
    target_path = settings.log_path / safe_name
    prune_failed_dumps()
    if target_path.exists() and not target_path.is_symlink() and target_path.is_file():
        return target_path.read_text(encoding="utf-8", errors="replace")
    return None

