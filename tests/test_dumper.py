import os
import pytest
from pathlib import Path

from backend.config import settings
from backend.scrapers.dumper import (
    ScrapingParsingError,
    dump_failed_html,
    list_failed_dumps,
    safe_parser,
    get_dump_content,
)
from backend.scrapers.dashboard import parse_dashboard


def test_safe_parser_dumps_on_exception(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "logs_dir", str(tmp_path))

    @safe_parser(context_name="test_faulty")
    def faulty_parser(html: str):
        raise ValueError("Simulated parsing crash on broken structure")

    corrupted_html = "<html><body><broken-div>Fatal ILIAS crash</broken-div></body></html>"

    with pytest.raises(ScrapingParsingError) as exc_info:
        faulty_parser(corrupted_html)

    err = exc_info.value
    assert err.context == "test_faulty"
    assert err.dump_path is not None
    assert err.dump_path.exists()

    content = err.dump_path.read_text(encoding="utf-8")
    assert "ILIAS SCRAPER DUMP" in content
    assert "Simulated parsing crash" in content
    assert corrupted_html in content


def test_safe_parser_empty_html(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "logs_dir", str(tmp_path))

    with pytest.raises(ScrapingParsingError) as exc_info:
        parse_dashboard("")

    assert exc_info.value.context == "dashboard"
    assert exc_info.value.dump_path is not None
    assert exc_info.value.dump_path.exists()


def test_list_and_get_failed_dumps(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "logs_dir", str(tmp_path))

    dump_path = dump_failed_html(
        "<div>raw data</div>",
        context="unit_test_context",
        error=RuntimeError("Test error")
    )

    dumps = list_failed_dumps()
    assert len(dumps) >= 1
    assert any(d["filename"] == dump_path.name for d in dumps)

    content = get_dump_content(dump_path.name)
    assert content is not None
    assert "<div>raw data</div>" in content

