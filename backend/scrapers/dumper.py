import functools
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.config import settings

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


def dump_failed_html(
    html: str,
    context: str,
    error: Optional[Exception] = None,
    extra_info: Optional[Dict[str, Any]] = None,
) -> Path:
    """
    Dumps raw HTML to logs/failed_html_dump_{context}_{timestamp}.html
    for debugging and the AI Maintenance Protocol.
    """
    logs_dir = settings.log_path
    logs_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:19]
    safe_context = re.sub(r"[^\w\-]", "_", context)
    dump_filename = f"failed_html_dump_{safe_context}_{timestamp}.html"
    dump_path = logs_dir / dump_filename

    header_comment = (
        f"<!--\n"
        f"ILIAS SCRAPER DUMP\n"
        f"Context: {context}\n"
        f"Timestamp: {datetime.now(timezone.utc).isoformat()}\n"
        f"Error: {str(error) if error else 'No error provided'}\n"
    )
    if extra_info:
        for k, v in extra_info.items():
            header_comment += f"{k}: {v}\n"
    header_comment += "-->\n"

    try:
        with open(dump_path, "w", encoding="utf-8", errors="replace") as f:
            f.write(header_comment)
            f.write(html or "<!-- EMPTY HTML RECEIVED -->")
        logger.error(f"Dumped failed HTML to: {dump_path} (Reason: {error})")
    except Exception as io_err:
        logger.critical(f"Failed to write HTML dump to {dump_path}: {io_err}")

    return dump_path


def safe_parser(context_name: str, check_empty: bool = False):
    """
    Decorator that wraps HTML parsing functions in a try/except block.
    If parsing fails (or returns empty data if check_empty=True), dumps the raw HTML.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(html_content: str, *args, **kwargs):
            if not html_content or not html_content.strip():
                dump_path = dump_failed_html("", context_name, error=ValueError("Empty HTML received"))
                raise ScrapingParsingError(
                    context=context_name,
                    message="Received empty HTML content",
                    dump_path=dump_path
                )

            try:
                result = func(html_content, *args, **kwargs)
                if check_empty and not result:
                    dump_path = dump_failed_html(
                        html_content,
                        context_name,
                        error=ValueError("Parser returned empty result collection")
                    )
                    raise ScrapingParsingError(
                        context=context_name,
                        message="Parser returned 0 items unexpectedly",
                        dump_path=dump_path
                    )
                return result
            except ScrapingParsingError:
                raise
            except Exception as e:
                dump_path = dump_failed_html(html_content, context_name, error=e)
                raise ScrapingParsingError(
                    context=context_name,
                    message=f"DOM extraction error: {str(e)}",
                    dump_path=dump_path,
                    original_error=e
                ) from e
        return wrapper
    return decorator


def list_failed_dumps() -> List[Dict[str, Any]]:
    """List all failed HTML dumps in logs directory."""
    logs_dir = settings.log_path
    if not logs_dir.exists():
        return []

    dumps = []
    for file_path in logs_dir.glob("failed_html_dump_*.html"):
        stat = file_path.stat()
        name = file_path.name
        # Extract context and timestamp from failed_html_dump_{context}_{timestamp}.html
        match = re.match(r"failed_html_dump_(.+)_(\d{8}_\d{6})\.html", name)
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
    if target_path.exists() and target_path.is_file():
        return target_path.read_text(encoding="utf-8", errors="replace")
    return None

