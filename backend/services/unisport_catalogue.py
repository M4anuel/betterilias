"""Shared public snapshots. No account headers, private lists or partial writes.

All offers and derived sport types are cached together per language for 15 min;
details for five min. Last complete snapshots can be served for up to seven days
on failure, explicitly marked stale. Refreshes coalesce across local workers.
"""
import asyncio
from contextlib import contextmanager
import json
import os
import sqlite3
import time
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from backend.config import settings
from backend.coordination import SharedLock
from backend.outbound_budget import OutboundUnavailable
from backend.scrapers.dumper import safe_parser
from backend.services.unisport_client import UnisportClient, UnisportReadError

CATALOGUE_TTL = 900
DETAIL_TTL = 300
STALE_TTL = 7 * 86400
MAX_DETAILS = 128


@safe_parser('unisport_public_text')
def plain_html(html):
    soup = BeautifulSoup(html, 'lxml')
    for node in soup(['script', 'style', 'iframe', 'object']):
        node.decompose()
    return soup.get_text(separator='\n', strip=True)


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


def present_offer(raw, *, detail=False):
    if not isinstance(raw, dict) or type(raw.get('id')) is not int or raw['id'] <= 0 or not isinstance(raw.get('title'), str):
        raise UnisportReadError('invalid_response')
    def nested(key, field):
        value = raw.get(key)
        return text(value.get(field)) if isinstance(value, dict) else ''
    result = dict(id=raw['id'], title=text(raw['title']), sport=text(raw.get('sportName')),
        begin=nested('offerNextDate', 'begin'), end=nested('offerNextDate', 'end'),
        opens=nested('registrationTimeSlot', 'begin'), closes=nested('registrationTimeSlot', 'end'),
        level=nested('performanceLevel', 'title'), location=nested('location', 'title'),
        address=nested('location', 'subtitle'), status=text(raw.get('registration')),
        free_places=text(raw.get('freePlaces')), cancelled=bool(raw.get('outage')),
        url=public_url(nested('moreInfo', 'url')))
    if detail:
        infos = raw.get('generalInfos')
        result['infos'] = [dict(title=text(item.get('title')), content=plain_html(text(item['content'])))
            for item in (infos[:40] if isinstance(infos, list) else [])
            if isinstance(item, dict) and text(item.get('content')).strip()]
        for key, source in [('important', 'importantInfo'), ('special', 'specialInfo'), ('outage', 'outage')]:
            value = text(raw.get(source))
            result[key] = plain_html(value) if value.strip() else ''
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
        return {'offer': present_offer(raw, detail=True)}
    return await cached(f'offer:{locale}:{offer_id}', load, DETAIL_TTL, refresh)
