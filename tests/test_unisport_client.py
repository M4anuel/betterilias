import json
import httpx
import pytest
from pydantic import SecretStr

from backend.outbound_budget import OutboundBudget, BudgetPolicy
from backend.services.unisport_client import UnisportAccount, UnisportClient, UnisportReadError


@pytest.fixture
def account():
    return UnisportAccount('subject-a', SecretStr('own-id-token'), 'own-affiliation')


@pytest.fixture
def budget(tmp_path):
    return OutboundBudget(tmp_path, BudgetPolicy(rate=1000))


@pytest.mark.asyncio
async def test_read_contract_and_independent_credentials(account, budget):
    requests=[]
    def handler(request):
        requests.append(request)
        assert request.method == 'GET'
        assert request.headers['authorization'] == 'Bearer own-id-token'
        assert request.headers['x-unicampus-affiliation'] == 'own-affiliation'
        assert 'cookie' not in request.headers and 'x-session-id' not in request.headers
        return httpx.Response(200,json={'id':12})
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        assert await client.offer(12,'en') == {'id':12}
    assert requests[0].url.path == '/api/v3/sports/offers/getOffer/12'
    assert requests[0].url.params['locale'] == 'en'
    assert 'own-id-token' not in repr(account)
    assert not hasattr(UnisportClient,'apply')


@pytest.mark.asyncio
async def test_complete_pagination_preserves_occurrences(account,budget):
    def handler(request):
        offset=int(request.url.params['offset'])
        assert request.url.params['limit'] == '20'
        return httpx.Response(200,json=[{'offer_id':1,'start':i} for i in range(offset,min(offset+20,23))])
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        applications=await client.applications()
        assert len(applications) == 23
        assert applications[0]['offer_id'] == applications[22]['offer_id']


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [None, {'items':[]}, [1], [{'id':1}]*21])
async def test_invalid_application_lists_are_not_absence(account,budget,payload):
    async with UnisportClient(account,transport=httpx.MockTransport(lambda r:httpx.Response(200,text=json.dumps(payload))),budget=budget) as client:
        with pytest.raises(UnisportReadError,match='incomplete_applications'):
            await client.applications()


@pytest.mark.asyncio
async def test_repeated_pages_are_incomplete(account,budget):
    async with UnisportClient(account,transport=httpx.MockTransport(lambda r:httpx.Response(200,json=[{'id':i} for i in range(20)])),budget=budget) as client:
        with pytest.raises(UnisportReadError,match='incomplete_applications'):
            await client.applications()


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code',[(401,'connection_required'),(403,'connection_required'),(500,'upstream_unavailable'),(302,'upstream_unavailable')])
async def test_failures_are_not_retried_or_redirected(account,budget,status,code):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(status,headers={'location':'https://attacker.invalid/'},text='private response')
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        with pytest.raises(UnisportReadError,match=code):await client.offer(12)
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('offer_id',[0,-1,True,'12','https://attacker.invalid/'])
async def test_invalid_offer_ids_never_reach_network(account,budget,offer_id):
    def handler(request):raise AssertionError('No network request expected')
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        with pytest.raises(ValueError):await client.offer(offer_id)


@pytest.mark.parametrize('subject,token,affiliation',[('', 'token','aff'),('subject','','aff'),('subject','token',''),('subject','token\nsecret','aff')])
def test_missing_account_context_is_not_a_default_session(subject,token,affiliation):
    with pytest.raises(ValueError):UnisportAccount(subject,SecretStr(token),affiliation)


@pytest.mark.asyncio
@pytest.mark.parametrize('body',[b'not-json',b'x' * 2_000_001],ids=['malformed','oversized'])
async def test_invalid_or_oversized_responses_do_not_escape(account,budget,body):
    async with UnisportClient(account,transport=httpx.MockTransport(lambda r:httpx.Response(200,content=body)),budget=budget) as client:
        with pytest.raises(UnisportReadError,match='invalid_response'):await client.offer(12)


@pytest.mark.asyncio
async def test_exhausted_pagination_is_not_complete(account,budget,monkeypatch):
    monkeypatch.setattr('backend.services.unisport_client.MAX_APPLICATIONS',40)
    def handler(request):
        offset=int(request.url.params['offset'])
        return httpx.Response(200,json=[{'id':i} for i in range(offset,offset+20)])
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        with pytest.raises(UnisportReadError,match='incomplete_applications'):await client.applications()


@pytest.mark.asyncio
async def test_complete_public_catalogue_never_sends_credentials(account, budget):
    calls=[]
    def handler(request):
        calls.append(request)
        assert 'authorization' not in request.headers and 'x-unicampus-affiliation' not in request.headers and 'cookie' not in request.headers
        assert request.url.params['limit']=='100' and request.url.params['search']=='' and request.url.params['available']=='false'
        offset=int(request.url.params['offset'])
        return httpx.Response(200,headers={'set-cookie':'private=must-not-be-replayed'},
            json=[{'id':i+1,'title':'Offer'} for i in range(offset,min(offset+100,103))])
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        assert len(await client.catalogue('en'))==103
    assert len(calls)==2


@pytest.mark.asyncio
async def test_public_detail_and_private_bookmarks_are_explicit(account,budget):
    calls=[]
    def handler(request):
        calls.append(request)
        public='getOffer' in request.url.path
        assert ('authorization' in request.headers) is not public
        assert ('x-unicampus-affiliation' in request.headers) is not public
        return httpx.Response(200,json={'id':12} if public else [{'id':12}])
    async with UnisportClient(account,transport=httpx.MockTransport(handler),budget=budget) as client:
        await client.offer(12,'en',public=True)
        assert await client.bookmarks('en')==[{'id':12}]
    async with UnisportClient(transport=httpx.MockTransport(handler),budget=budget) as client:
        with pytest.raises(UnisportReadError,match='connection_required'): await client.bookmarks()
    assert len(calls)==2
