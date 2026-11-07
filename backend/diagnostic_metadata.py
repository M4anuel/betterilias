"""Code-defined diagnostic context. Never format exceptions or inspect locals."""
import ast
import asyncio
import errno
from collections import deque
from functools import lru_cache
import hashlib
from pathlib import Path
import re
import sqlite3
from weakref import ref

import httpx
from starlette.routing import Mount, compile_path

APP_VERSION = '1.0.0'
ROOT = Path(__file__).resolve().parent.parent
REASONS = frozenset(('empty_html', 'empty_result', 'dom_extraction', 'timeout', 'network_error',
    'storage_error', 'permission_denied', 'missing_key', 'invalid_value', 'type_error',
    'missing_attribute', 'index_error', 'assertion_failed', 'cancelled', 'unknown_exception',
    'partial_result', 'reported_failure', 'dispatch_interrupted', 'operation_rejected',
    'session_expired', 'submission_listing_incomplete', 'http_error',
    'connect_timeout', 'read_timeout', 'write_timeout', 'pool_timeout',
    'storage_busy', 'storage_full', 'file_missing', 'filesystem_error'))
_routes = {}


@lru_cache(maxsize=1)
def source_manifest():
    """Snapshot trusted deployed Python source, once per worker startup.

    Names come from the AST, never from exception type names, frame globals,
    runtime filenames or log messages. Missing source means omitted frames.
    """
    frames, parsers = {}, set()
    digest = hashlib.sha256()
    for path in sorted((ROOT / 'backend').rglob('*.py')):
        relative = path.relative_to(ROOT).as_posix()
        if not re.fullmatch(r'backend/[a-z0-9_/]+\.py', relative):
            continue
        try:
            resolved = path.resolve()
            resolved.relative_to(ROOT / 'backend')
            source = path.read_bytes()
            tree = ast.parse(source)
        except (OSError, ValueError, SyntaxError):
            continue
        digest.update(relative.encode() + b'\0' + source.replace(b'\r\n', b'\n'))

        def visit(node, parents=()):
            qualified = parents
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                qualified = (*parents, node.name)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    first = min([node.lineno, *(item.lineno for item in node.decorator_list)])
                    for start in {first, node.lineno}:
                        frames[(str(resolved), node.name, start)] = (relative, '.'.join(qualified), first, node.end_lineno)
                    for decorator in node.decorator_list:
                        if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name) and decorator.func.id == 'safe_parser':
                            name = decorator.args[0] if decorator.args else next((item.value for item in decorator.keywords if item.arg == 'context_name'), None)
                            if isinstance(name, ast.Constant) and isinstance(name.value, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}', name.value):
                                parsers.add(name.value)
            for child in ast.iter_child_nodes(node):
                visit(child, qualified)

        visit(tree)
    return frames, frozenset(parsers), 'backend-' + digest.hexdigest()[:16]


def release():
    return {'app_version': APP_VERSION, 'build': source_manifest()[2]}


def parser_name(value):
    return value if isinstance(value, str) and value in source_manifest()[1] else 'unspecified'


def register_routes(app):
    """Freeze templates from the configured router, never from request paths."""
    def remember(route, template):
        if not template or len(template) > 240 or not re.fullmatch(r'/[A-Za-z0-9_/{}/.:-]*', template):
            return
        key = id(route)
        if key not in _routes or _routes[key][0]() is not route:
            try:
                _routes[key] = (ref(route, lambda value, key=key: _routes.pop(key, None)), {})
            except TypeError:
                return
        _routes[key][1][template] = compile_path(template)[0]

    def visit(routes, prefix='', depth=0):
        if depth > 8:
            return
        for route in routes:
            # Newer FastAPI retains included routers lazily. Their configured
            # effective contexts carry the full prefix; scope['route'] still
            # refers to the original route, which can have multiple aliases.
            effective = getattr(route, 'effective_route_contexts', None)
            if callable(effective):
                for context in effective():
                    original = context.original_route
                    mounted = getattr(context, 'starlette_route', None)
                    configured = getattr(context, 'path_format', None) or getattr(mounted, 'path_format', '')
                    remember(original, prefix + configured)
                    if isinstance(mounted, Mount) and hasattr(mounted.app, 'routes'):
                        visit(mounted.app.routes, prefix + mounted.path, depth + 1)
                continue
            remember(route, prefix + getattr(route, 'path_format', ''))
            child = getattr(route, 'app', None)
            if isinstance(route, Mount) and child is not app and hasattr(child, 'routes'):
                visit(child.routes, prefix + route.path, depth + 1)
    visit(app.routes)


def route_template(scope):
    route = scope.get('route')
    registered = _routes.get(id(route))
    if not registered or registered[0]() is not route:
        return 'unmatched'
    choices = registered[1]
    if len(choices) == 1:
        return next(iter(choices))
    # Compare against frozen patterns for aliases; never derive or persist a
    # template by replacing values in an incoming path.
    path = scope.get('path', '')
    matches = [template for template, pattern in choices.items() if isinstance(path, str) and pattern.fullmatch(path)]
    return matches[0] if len(matches) == 1 else 'unmatched'


def exception_reason(error):
    # Fixed categories prevent a user-defined exception name reaching storage.
    if isinstance(error, sqlite3.Error):
        code = getattr(error, 'sqlite_errorcode', None)
        if type(code) is int:
            if (code & 255) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                return 'storage_busy'
            if (code & 255) == sqlite3.SQLITE_FULL:
                return 'storage_full'
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return 'storage_full'
    for kind, reason in ((asyncio.CancelledError, 'cancelled'),
            (httpx.ConnectTimeout, 'connect_timeout'), (httpx.ReadTimeout, 'read_timeout'),
            (httpx.WriteTimeout, 'write_timeout'), (httpx.PoolTimeout, 'pool_timeout'),
            (httpx.TimeoutException, 'timeout'),
            (TimeoutError, 'timeout'), (httpx.NetworkError, 'network_error'), (ConnectionError, 'network_error'),
            (sqlite3.Error, 'storage_error'), (PermissionError, 'permission_denied'),
            (FileNotFoundError, 'file_missing'), (OSError, 'filesystem_error'),
            (KeyError, 'missing_key'), (IndexError, 'index_error'), (AttributeError, 'missing_attribute'),
            (TypeError, 'type_error'), (ValueError, 'invalid_value'), (AssertionError, 'assertion_failed')):
        if isinstance(error, kind):
            return reason
    return 'unknown_exception'


def stack_frames(error):
    """Only project file, static qualified function name, bounded source line.

    No source lines, absolute paths, exception messages, arguments, locals or
    third-party frames. Bound traversal even for pathological tracebacks.
    """
    manifest = source_manifest()[0]
    frames = deque(maxlen=12)
    tb = error.__traceback__
    seen = count = 0
    while tb is not None and seen < 256:
        code = tb.tb_frame.f_code
        info = manifest.get((code.co_filename, code.co_name, code.co_firstlineno))
        if info and info[2] <= tb.tb_lineno <= info[3]:
            frames.append({'file': info[0], 'function': info[1], 'line': tb.tb_lineno})
            count += 1
        seen += 1
        tb = tb.tb_next
    return list(frames), count > 12 or tb is not None


def error_details(error):
    pending, visited, frames = [error], set(), deque(maxlen=12)
    reason, truncated, count = 'unknown_exception', False, 0
    while pending and len(visited) < 8:
        item = pending.pop()
        if id(item) in visited:
            continue
        visited.add(id(item))
        known_reason = exception_reason(item)
        if reason == 'unknown_exception' and known_reason != 'unknown_exception':
            reason = known_reason
        selected, limited = stack_frames(item)
        frames.extend(selected)
        count += len(selected)
        truncated |= limited
        if isinstance(item, BaseExceptionGroup):
            pending.extend(reversed(item.exceptions[:8]))
            truncated |= len(item.exceptions) > 8
        cause = item.__cause__ or (None if item.__suppress_context__ else item.__context__)
        if cause is not None:
            pending.append(cause)
    return {'error_kind': reason, 'stack': list(frames),
            'stack_truncated': truncated or count > 12 or bool(pending)}


def source_location(filename, function, line):
    if not isinstance(filename, str) or not isinstance(function, str) or type(line) is not int:
        return None
    candidates = [info for (path, name, _), info in source_manifest()[0].items()
                  if path == filename and name == function and info[2] <= line <= info[3]]
    if candidates:
        info = min(candidates, key=lambda value: value[3] - value[2])
        return {'file': info[0], 'function': info[1], 'line': line}
