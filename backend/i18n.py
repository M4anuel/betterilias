"""Request-scoped localisation for application messages, never ILIAS content."""
from contextvars import ContextVar
import json
from pathlib import Path
import re

LOCALES = Path(__file__).resolve().parents[1] / 'locales'
LANGUAGES = json.loads((LOCALES / 'languages.json').read_text(encoding='utf-8'))
CATALOGUES = {
    code: json.loads((LOCALES / f'{code}.json').read_text(encoding='utf-8'))
    if (LOCALES / f'{code}.json').exists() else {}
    for code in LANGUAGES
}
# Keep the existing German CLI/parser behaviour; HTTP requests negotiate separately.
current_language = ContextVar('betterilias_language', default='de')


def negotiate_language(header: str = '') -> str:
    """Respect quality values, regional tags and unsupported-language fallback."""
    preferences = []
    for index, item in enumerate(header.split(',')):
        parts = item.strip().split(';')
        code = parts[0].lower().replace('_', '-').split('-')[0]
        try:
            quality = next((float(p.strip()[2:]) for p in parts[1:] if p.strip().startswith('q=')), 1.0)
        except ValueError:
            continue
        if 0 < quality <= 1 and code in LANGUAGES:
            preferences.append((-quality, index, code))
    return min(preferences)[2] if preferences else 'en'


def translate(key: str, language: str, **values) -> str:
    message = CATALOGUES.get(language, {}).get(key)
    if not isinstance(message, str) or not message.strip():
        message = CATALOGUES['en'].get(key) or key
    return re.sub(r'\{(\w+)\}', lambda match: str(values.get(match[1], match[0])), message)


def t(key: str, **values) -> str:
    return translate(key, current_language.get(), **values)


class LanguageMiddleware:
    """Pure ASGI middleware keeps the locale isolated across concurrent requests."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        # Direct downloads cannot attach request headers; the frontend supplies lang.
        from urllib.parse import parse_qs
        query = parse_qs(scope.get('query_string', b'').decode('utf-8', errors='replace'))
        language = negotiate_language(query.get('lang', [headers.get(b'accept-language', b'').decode('latin1')])[0])
        token = current_language.set(language)
        async def send_localised(message):
            if message['type'] == 'http.response.start':
                response_headers = list(message.get('headers', []))
                response_headers.append((b'content-language', language.encode('ascii')))
                response_headers.append((b'vary', b'Accept-Language'))
                message = {**message, 'headers': response_headers}
            await send(message)
        try:
            await self.app(scope, receive, send_localised)
        finally:
            current_language.reset(token)
