"""Tests for human-readable console log formatting."""
import json
import pytest

from backend.config import settings
from backend.observability import format_console_event, _ANSI_RESET, _ANSI_GREEN, _ANSI_BOLD_RED, _ANSI_YELLOW


@pytest.fixture(autouse=True)
def force_human_console(monkeypatch):
    monkeypatch.setattr(settings, 'log_console_format', 'human')


def test_format_console_event_http_request_clean_plain():
    event = {
        'timestamp': 1763380000.0,
        'level': 'INFO',
        'method': 'GET',
        'route': '/api/courses/123/materials',
        'status': 200,
        'duration_ms': 142.6,
        'worker': 'w123',
        'schema': 1,
    }
    output = format_console_event(event, color=False)
    assert '[INFO] ' in output
    assert 'GET   ' in output
    assert '/api/courses/123/materials' in output
    assert '200 OK' in output
    assert '143ms' in output
    # Excludes noisy metadata
    assert 'w123' not in output
    assert 'schema' not in output


def test_format_console_event_http_request_color_and_duration():
    # 200 OK should use green
    event_ok = {
        'timestamp': 1763380000.0,
        'level': 'INFO',
        'method': 'GET',
        'route': '/api/health',
        'status': 200,
        'duration_ms': 45.0,
    }
    colored_ok = format_console_event(event_ok, color=True)
    assert _ANSI_GREEN in colored_ok
    assert '200 OK' in colored_ok

    # 404 Not Found should use yellow
    event_404 = {
        'timestamp': 1763380000.0,
        'level': 'WARNING',
        'method': 'GET',
        'route': '/api/unknown',
        'status': 404,
        'duration_ms': 80.0,
    }
    colored_404 = format_console_event(event_404, color=True)
    assert _ANSI_YELLOW in colored_404
    assert '404 Not Found' in colored_404

    # 502 Bad Gateway should use bold red
    event_502 = {
        'timestamp': 1763380000.0,
        'level': 'ERROR',
        'method': 'POST',
        'route': '/api/sync',
        'status': 502,
        'duration_ms': 1500.0,
        'reason': 'ilias_unreachable',
    }
    colored_502 = format_console_event(event_502, color=True)
    assert _ANSI_BOLD_RED in colored_502
    assert '502 Bad Gateway' in colored_502
    assert '1.5s' in colored_502
    assert 'reason: ilias_unreachable' in colored_502


def test_format_console_event_parser_failed():
    event = {
        'timestamp': 1763380000.0,
        'level': 'ERROR',
        'code': 'parser.failed',
        'parser': 'course_members',
        'reason': 'table_not_found',
        'error_kind': 'IndexError',
    }
    output = format_console_event(event, color=False)
    assert '[ERROR]' in output
    assert 'PARSER [course_members] failed' in output
    assert 'reason: table_not_found' in output
    assert 'kind: IndexError' in output


def test_format_console_event_outbound_failure():
    event = {
        'timestamp': 1763380000.0,
        'level': 'ERROR',
        'code': 'outbound.timeout',
        'status': 504,
        'reason': 'connect_timeout',
    }
    output = format_console_event(event, color=False)
    assert '[ERROR]' in output
    assert 'OUTBOUND outbound.timeout [ilias.unibe.ch]' in output
    assert 'status: 504' in output
    assert 'reason: connect_timeout' in output


def test_format_console_event_generic_runtime():
    event = {
        'timestamp': 1763380000.0,
        'level': 'ERROR',
        'code': 'runtime.error',
        'component': 'auth',
        'reason': 'token_expired',
        'app_version': '1.1.0',
        'build': 'abc1234',
        'worker': 'w1',
    }
    output = format_console_event(event, color=False)
    assert '[ERROR]' in output
    assert 'runtime.error' in output
    assert 'component: auth' in output
    assert 'reason: token_expired' in output
    # Strips build and version from terminal console
    assert 'abc1234' not in output
    assert '1.1.0' not in output


def test_format_console_event_json_mode(monkeypatch):
    monkeypatch.setattr(settings, 'log_console_format', 'json')
    event = {
        'timestamp': 1763380000.0,
        'code': 'request.completed',
        'status': 200,
        'method': 'GET',
    }
    output = format_console_event(event)
    parsed = json.loads(output)
    assert parsed['code'] == 'request.completed'
    assert parsed['status'] == 200
