"""Read-only UniApp transport; not an authentication implementation.

The caller must supply an independently verified Unisport account context.
No ILIAS session, login fallback, affiliation discovery or registration is implied.
The only upstream operations established by the supplied developer excerpt are
getOffer and myApplications; mutations are deliberately absent from this adapter.
"""
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
    def __init__(self, account: UnisportAccount, *, transport=None, budget=None):
        self.account = account
        self.identity = 'unisport:' + hashlib.sha256(account.subject.encode()).hexdigest()
        self.budget = budget or OutboundBudget()
        policy = TargetPolicy(native_url=ORIGIN, media_origins=[], allow_local=False)
        self.client = httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=transport),
            timeout=httpx.Timeout(20, connect=10), follow_redirects=False, trust_env=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.client.aclose()

    async def _read(self, path, locale, **params):
        if locale not in ('de', 'en'):
            raise ValueError('Unsupported Unisport language')
        permit = await self.budget.acquire(self.identity)
        try:
            async with self.client.stream('GET', BASE + path, params={**params, 'locale': locale}, headers={
                'Authorization': 'Bearer ' + self.account.id_token.get_secret_value(),
                'X-UNICAMPUS-AFFILIATION': self.account.affiliation,
                'Accept': 'application/json',
            }) as response:
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

    async def offer(self, offer_id: int, locale='de'):
        if type(offer_id) is not int or offer_id <= 0:
            raise ValueError('A positive offer ID is required')
        data = await self._read(f'/sports/offers/getOffer/{offer_id}', locale)
        if not isinstance(data, dict):
            raise UnisportReadError('invalid_response')
        return data

    async def applications(self, locale='de'):
        items, seen_pages = [], set()
        for offset in range(0, MAX_APPLICATIONS, PAGE_SIZE):
            page = await self._read('/sports/offers/myApplications', locale, offset=offset, limit=PAGE_SIZE)
            if not isinstance(page, list) or len(page) > PAGE_SIZE or any(not isinstance(item, dict) for item in page):
                raise UnisportReadError('incomplete_applications')
            if page:
                fingerprint = hashlib.sha256(json.dumps(page, sort_keys=True).encode()).digest()
                if fingerprint in seen_pages:
                    raise UnisportReadError('incomplete_applications')
                seen_pages.add(fingerprint)
            items.extend(page)
            if len(page) < PAGE_SIZE:
                return items
        raise UnisportReadError('incomplete_applications')
