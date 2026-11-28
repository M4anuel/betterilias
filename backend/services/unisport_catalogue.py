"""Shared public snapshots. No account headers, private lists or partial writes.

All offers and derived sport types are cached together per language for 15 min;
details for five min. Last complete snapshots can be served for up to seven days
on failure, explicitly marked stale. Refreshes coalesce across local workers.
"""
import asyncio
from contextlib import contextmanager
import json
import os
import re
import sqlite3
import time
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from backend.config import settings
from backend.coordination import SharedLock
from backend.outbound_budget import OutboundUnavailable
from backend.scrapers.dumper import safe_parser
from backend.services.unisport_client import UnisportClient, UnisportReadError

CATALOGUE_TTL = 900
DETAIL_TTL = 300
STALE_TTL = 7 * 86400
MAX_DETAILS = 128
FORMAT_TAGS = {
    'p': 'p', 'div': 'div', 'br': 'br', 'ul': 'ul', 'ol': 'ol', 'li': 'li',
    'b': 'strong', 'strong': 'strong', 'i': 'em', 'em': 'em',
    'u': 'u', 's': 's', 'sub': 'sub', 'sup': 'sup',
}


@safe_parser('unisport_public_text')
def offer_html(html, *, formatted=False):
    soup = BeautifulSoup(html, 'lxml')
    for node in soup(['script', 'style', 'iframe', 'object']):
        if not node.decomposed:
            node.decompose()
    content = {'content': soup.get_text(separator='\n', strip=True)}
    if not formatted:
        return content

    for node in soup(['template', 'svg', 'math']):
        if not node.decomposed:
            node.decompose()
    remaining = 2000

    def project(nodes, depth):
        nonlocal remaining
        if depth > 24:
            raise OverflowError
        for node in nodes:
            remaining -= 1
            if remaining < 0:
                raise OverflowError
            if isinstance(node, Comment):
                continue
            if isinstance(node, NavigableString):
                yield str(node)
            elif isinstance(node, Tag):
                kind = FORMAT_TAGS.get(node.name)
                children = list(project(node.children, depth + 1))
                if kind and (children or kind == 'br'):
                    yield {'kind': kind, 'children': children}
                else:
                    yield from children

    try:
        nodes = list(project((soup.body or soup).children, 0))
    except OverflowError:
        return content
    if any(isinstance(node, dict) for node in nodes):
        content['format'] = nodes
    return content


def plain_html(html):
    return offer_html(html)['content']


def text(value):
    return value[:64000] if isinstance(value, str) else ''


def public_url(value):
    if not isinstance(value, str) or '\\' in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme == 'https' and not parsed.username and not parsed.password and parsed.hostname and (
                parsed.hostname == 'unibe.ch' or parsed.hostname.endswith('.unibe.ch')):
            return value
    except (ValueError, TypeError):
        pass
    return None


def present_offer(raw, *, detail=False, formatted=False):
    if not isinstance(raw, dict) or type(raw.get('id')) is not int or raw['id'] <= 0 or not isinstance(raw.get('title'), str):
        raise UnisportReadError('invalid_response')
    def nested(key, field):
        value = raw.get(key)
        return text(value.get(field)) if isinstance(value, dict) else ''
    phases = raw.get('datePhase')
    phase_values = phases.get('phase') if isinstance(phases, dict) else None
    date_range = text(raw.get('dateString'))
    recurring = isinstance(phase_values, list) and any(value in ('1', '2', '3', '4', '5') for value in phase_values)
    # A date range describes an offer, but only offerNextDate supplies a
    # confirmed occurrence. Do not expand the range into bookable sessions.
    offer_type = 'training' if recurring else 'date_range' if re.search(r'\d\.\s*[–-]\s*\d', date_range) else 'dated' if date_range else None
    result = dict(id=raw['id'], title=text(raw['title']), sport=text(raw.get('sportName')),
        begin=nested('offerNextDate', 'begin'), end=nested('offerNextDate', 'end'),
        opens=nested('registrationTimeSlot', 'begin'), closes=nested('registrationTimeSlot', 'end'),
        level=nested('performanceLevel', 'title'), location=nested('location', 'title'),
        address=nested('location', 'subtitle'), status=text(raw.get('registration')),
        registration_state=raw['status'] if type(raw.get('status')) is int and 1 <= raw['status'] <= 10 else None,
        requires_confirmation=raw.get('requiresConfirmation') if type(raw.get('requiresConfirmation')) is bool else None,
        schedule_day=text(raw.get('day')), schedule_time=text(raw.get('time')), date_range=date_range,
        offer_type=offer_type,
        free_places=text(raw.get('freePlaces')), cancelled=bool(raw.get('outage')),
        url=public_url(nested('moreInfo', 'url')))
    if detail:
        sport = raw.get('offerSportDetail')
        sport_link = sport.get('moreInfo') if isinstance(sport, dict) else None
        result['sport_url'] = public_url(sport_link.get('url')) if isinstance(sport_link, dict) else None
        infos = raw.get('generalInfos')
        result['infos'] = [dict(title=text(item.get('title')), **offer_html(text(item['content']), formatted=formatted))
            for item in (infos[:40] if isinstance(infos, list) else [])
            if isinstance(item, dict) and text(item.get('content')).strip()]
        for key, source in [('important', 'importantInfo'), ('special', 'specialInfo'), ('outage', 'outage')]:
            value = text(raw.get(source))
            projected = offer_html(value, formatted=formatted) if value.strip() else {'content': ''}
            result[key] = projected['content']
            if 'format' in projected:
                result[f'{key}_format'] = projected['format']
    if recurring and result['requires_confirmation'] is False:
        infos = raw.get('generalInfos')
        costs = [plain_html(text(item.get('content'))).strip().casefold()
                 for item in (infos[:40] if isinstance(infos, list) else [])
                 if isinstance(item, dict) and text(item.get('title')).strip().casefold() in ('costs', 'kosten')]
        result['quick_candidate'] = (costs in (['none'], ['keine']) and
                                     not any(text(raw.get(key)).strip() for key in ('importantInfo', 'specialInfo')))
    return result


@contextmanager
def database():
    directory = settings.coordination_path / 'unisport-public'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'cache.sqlite3'
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(descriptor)
    db = sqlite3.connect(path, timeout=5)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, fetched REAL, data TEXT)')
        with db:
            yield db
    finally:
        db.close()


def read(key):
    with database() as db:
        row = db.execute('SELECT fetched, data FROM cache WHERE key=?', (key,)).fetchone()
    if row and 0 <= time.time() - row[0] <= STALE_TTL:
        try:
            return {**json.loads(row[1]), 'fetched_at': row[0]}
        except (ValueError, TypeError):
            pass
    return None


async def cached(key, loader, ttl, refresh):
    requested = time.time()
    previous = read(key)
    if previous and not refresh and requested - previous['fetched_at'] < ttl:
        return {**previous, 'stale': False}
    async with SharedLock('unisport-public:' + key, timeout=55).async_():
        current = read(key)
        if current and (current['fetched_at'] >= requested or (not refresh and time.time() - current['fetched_at'] < ttl)):
            return {**current, 'stale': False}
        try:
            async with asyncio.timeout(50):
                data = await loader()
        except (UnisportReadError, OutboundUnavailable, TimeoutError):
            if current:
                return {**current, 'stale': True}
            raise UnisportReadError('upstream_unavailable') from None
        fetched = time.time()
        with database() as db:
            db.execute('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)', (key, fetched, json.dumps(data)))
            db.execute('DELETE FROM cache WHERE fetched<?', (fetched - STALE_TTL,))
            db.execute("DELETE FROM cache WHERE key IN (SELECT key FROM cache WHERE key LIKE 'offer:%' ORDER BY fetched DESC LIMIT -1 OFFSET ?)", (MAX_DETAILS,))
        return {**data, 'fetched_at': fetched, 'stale': False}


async def catalogue(locale, *, refresh=False):
    async def load():
        async with UnisportClient() as client:
            rows = await client.catalogue(locale)
        offers = {}
        for row in rows:
            offer = present_offer(row)
            offers.setdefault(offer['id'], offer)
        items = list(offers.values())
        return {'items': items, 'sports': sorted({item['sport'] for item in items if item['sport']}, key=str.casefold)}
    return await cached('catalogue:' + locale, load, CATALOGUE_TTL, refresh)


async def offer(offer_id, locale, *, refresh=False):
    async def load():
        async with UnisportClient() as client:
            raw = await client.offer(offer_id, locale, public=True)
        if raw.get('id') != offer_id:
            raise UnisportReadError('invalid_response')
        return {'offer': present_offer(raw, detail=True, formatted=True)}
    return await cached(f'offer:{locale}:{offer_id}', load, DETAIL_TTL, refresh)
