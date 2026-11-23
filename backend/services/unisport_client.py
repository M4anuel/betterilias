"""Pinned UniApp transport with explicit public reads and account-owned writes."""
import hashlib
import json
from dataclasses import dataclass

import httpx
from pydantic import SecretStr

from backend.outbound_budget import OutboundBudget
from backend.outbound_network import EgressTransport
from backend.outbound_targets import TargetPolicy

ORIGIN = 'https://api.uniapp-backend.unibe.ch'
BASE = ORIGIN + '/api/v3'
MAX_BYTES = 2_000_000
PAGE_SIZE = 20
MAX_APPLICATIONS = 10_000


class UnisportReadError(Exception):
    """Fixed error category only: never include upstream bodies or credentials."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, repr=False)
class UnisportAccount:
    subject: str
    id_token: SecretStr
    affiliation: str

    def __post_init__(self):
        if not self.subject.strip() or not self.affiliation.strip() or not self.id_token.get_secret_value().strip():
            raise ValueError('A verified Unisport account and affiliation are required')
        if any(c in self.affiliation + self.id_token.get_secret_value() for c in '\r\n'):
            raise ValueError('Invalid Unisport account context')


class UnisportClient:
    def __init__(self, account: UnisportAccount | None = None, *, transport=None, budget=None):
        self.account = account
        self.identity = 'unisport:' + (hashlib.sha256(account.subject.encode()).hexdigest() if account else 'public')
        self.budget = budget or OutboundBudget()
        policy = TargetPolicy(native_url=ORIGIN, media_origins=[], allow_local=False)
        self.client = httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=transport),
            timeout=httpx.Timeout(20, connect=10), follow_redirects=False, trust_env=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.client.aclose()

    async def _read(self, path, locale, *, public=False, **params):
        return await self._request('GET', path, locale, public=public, params=params)

    async def mutate(self, operation, identifier, locale='de', *, answers=None, before_dispatch=None):
        # Only protocol-recovered operations; never accept an upstream URL/path.
        if operation not in ('apply', 'cancelApplication', 'confirmCancellation', 'submitAdditionalInfos'):
            raise ValueError('Unsupported UniSport operation')
        if type(identifier) is not int or identifier <= 0:
            raise ValueError('A positive UniSport identifier is required')
        data = await self._request('POST', f'/sports/offers/{operation}/{identifier}', locale,
            body={'items': answers} if operation == 'submitAdditionalInfos' else None, before_dispatch=before_dispatch)
        if not isinstance(data, dict):
            raise UnisportReadError('invalid_response')
        return data

    async def _request(self, method, path, locale, *, public=False, params=None, body=None, before_dispatch=None):
        if locale not in ('de', 'en'):
            raise ValueError('Unsupported Unisport language')
        headers = {'Accept': 'application/json'}
        if not public:
            if self.account is None:
                raise UnisportReadError('connection_required')
            headers.update({'Authorization': 'Bearer ' + self.account.id_token.get_secret_value(),
                'X-UNICAMPUS-AFFILIATION': self.account.affiliation})
        permit = await self.budget.acquire(self.identity)
        try:
            # UniApp uses explicit bearer/affiliation headers. Do not replay
            # even an upstream-set cookie on subsequent public cache requests.
            self.client.cookies.clear()
            if before_dispatch:
                before_dispatch()
            async with self.client.stream(method, BASE + path, params={**(params or {}), 'locale': locale},
                    headers=headers, **({'json': body} if body is not None else {})) as response:
                if response.status_code in (401, 403):
                    raise UnisportReadError('connection_required')
                if response.status_code != 200:
                    raise UnisportReadError('upstream_unavailable')
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise UnisportReadError('invalid_response')
                try:
                    return json.loads(data)
                except (ValueError, UnicodeError):
                    raise UnisportReadError('invalid_response') from None
        except httpx.HTTPError:
            raise UnisportReadError('upstream_unavailable') from None
        finally:
            await permit.close()

    async def offer(self, offer_id: int, locale='de', *, public=False):
        if type(offer_id) is not int or offer_id <= 0:
            raise ValueError('A positive offer ID is required')
        data = await self._read(f'/sports/offers/getOffer/{offer_id}', locale, public=public)
        if not isinstance(data, dict):
            raise UnisportReadError('invalid_response')
        return data

    async def applications(self, locale='de'):
        return await self._pages('/sports/offers/myApplications', locale, 'incomplete_applications')

    async def bookmarks(self, locale='de'):
        return await self._pages('/sports/recommendation/myBookmarks', locale, 'incomplete_bookmarks')

    async def catalogue(self, locale='de'):
        # The public endpoint accepts 100 items per page (verified separately).
        return await self._pages('/sports/offers/search', locale, 'incomplete_catalogue',
            public=True, size=100, search='', available='false')

    async def _pages(self, path, locale, error, *, public=False, size=PAGE_SIZE, **params):
        items, seen_pages = [], set()
        for offset in range(0, MAX_APPLICATIONS, size):
            page = await self._read(path, locale, public=public, offset=offset, limit=size, **params)
            if not isinstance(page, list) or len(page) > size or any(not isinstance(item, dict) for item in page):
                raise UnisportReadError(error)
            if page:
                fingerprint = hashlib.sha256(json.dumps(page, sort_keys=True).encode()).digest()
                if fingerprint in seen_pages:
                    raise UnisportReadError(error)
                seen_pages.add(fingerprint)
            items.extend(page)
            if len(page) < size:
                return items
        raise UnisportReadError(error)
