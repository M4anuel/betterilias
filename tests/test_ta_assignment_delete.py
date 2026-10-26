"""Never replay an uncertain deletion or equate HTTP 200 with a deleted object."""
from pathlib import Path
from urllib.parse import parse_qs
import httpx
import pytest
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient
from backend.main import app
from backend.api.deps import get_ilias_client
from backend.services.ilias_client import AssignmentDeletionError
from backend.scrapers.dumper import ScrapingParsingError
from tests.test_ta_assignment_save import NativeMarkupScenario

CONFIRM = (Path(__file__).parent / 'fixtures/ta_delete_confirmation.html').read_text(encoding='utf-8').replace('54652', '39067')


class DeletionScenario(NativeMarkupScenario):
    def __init__(self, outcome='success'):
        super().__init__()
        self.outcome = outcome
        self.deleted = False
        self.confirmation = CONFIRM
        self.reads = 0

    def listing(self):
        soup = BeautifulSoup(super().listing(), 'lxml')
        if self.deleted:
            soup.select_one('input[name="id[]"][value="39067"]').find_parent('tr').decompose()
        return str(soup)

    def handle(self, request):
        self.requests.append(request)
        if request.method == 'GET':
            self.reads += 1
            if self.reads > 1 and self.outcome == 'verification_timeout':
                raise httpx.ReadTimeout('list unavailable', request=request)
            if self.reads > 1 and self.outcome == 'verification_http_error':
                self.deleted = True
                return httpx.Response(500, text=self.listing())
            return httpx.Response(200, text=self.listing())
        fields = parse_qs(request.content.decode())
        self.posts.append(fields)
        assert fields['id[]'] == ['39067']
        if 'cmd[confirmAssignmentsDeletion]' in fields:
            return httpx.Response(200, text=self.confirmation, headers={'Set-Cookie': 'confirm=fresh; Path=/'})
        assert fields['cmd[deleteAssignments]'] == ['Delete']
        assert 'confirm=fresh' in request.headers['cookie']
        assert parse_qs(request.url.query.decode())['rtoken'] == ['fixture-delete-token']
        assert request.extensions['timeout']['read'] == 120
        self.deleted = self.outcome in ('success', 'timeout_deleted', 'disconnect_deleted', 'server_error_deleted')
        if self.outcome in ('timeout_deleted', 'timeout_present'):
            raise httpx.ReadTimeout('slow ILIAS response', request=request)
        if self.outcome == 'disconnect_deleted':
            raise httpx.ReadError('connection lost', request=request)
        if self.outcome == 'server_error_deleted': return httpx.Response(500, text='cleanup response failed')
        if self.outcome == 'present': return httpx.Response(200, text='<p>Nothing deleted</p>')
        # This redirect must not be followed; verify with the known list URL instead.
        return httpx.Response(302, headers={'Location': 'https://example.invalid/expensive-redirect'})

    async def delete(self):
        return await self.client.delete_ta_assignment(self.ref, '39067')


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', ['success', 'timeout_deleted', 'disconnect_deleted', 'server_error_deleted'])
async def test_deleted_assignment_is_confirmed_even_when_response_fails(outcome):
    scenario = DeletionScenario(outcome)
    assert await scenario.delete() is True
    assert len(scenario.posts) == 2 and scenario.reads == 2
    assert scenario.manager.get_http_client.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(('outcome', 'status'), [('present', 409), ('timeout_present', 504), ('verification_timeout', 504), ('verification_http_error', 504)])
async def test_unconfirmed_deletion_is_not_success_or_retried(outcome, status):
    scenario = DeletionScenario(outcome)
    with pytest.raises(AssignmentDeletionError) as error:
        await scenario.delete()
    assert error.value.status_code == status
    assert len(scenario.posts) == 2


@pytest.mark.asyncio
async def test_already_absent_assignment_never_sends_another_delete():
    scenario = DeletionScenario()
    scenario.deleted = True
    assert await scenario.delete() is True
    assert scenario.posts == []


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['wrong_id', 'multiple_ids', 'no_form', 'wrong_server'])
async def test_invalid_confirmation_never_sends_deletion(change, monkeypatch):
    monkeypatch.setattr('backend.scrapers.dumper.dump_failed_html', lambda *args, **kwargs: None)
    scenario = DeletionScenario()
    if change == 'wrong_id': scenario.confirmation = CONFIRM.replace('39067', '12345')
    if change == 'multiple_ids': scenario.confirmation = CONFIRM.replace('</form>', '<input name="id[]" value="12345" type="hidden"></form>')
    if change == 'no_form': scenario.confirmation = '<p>No confirmation</p>'
    if change == 'wrong_server': scenario.confirmation = CONFIRM.replace('https://ilias.unibe.ch', 'https://example.invalid')
    with pytest.raises((ScrapingParsingError, AssignmentDeletionError)):
        await scenario.delete()
    assert len(scenario.posts) == 1


def test_api_returns_localised_uncertainty_instead_of_unhandled_500():
    scenario = DeletionScenario('timeout_present')
    app.dependency_overrides[get_ilias_client] = lambda: scenario.client
    try:
        response = TestClient(app).delete(f'/api/exercises/{scenario.ref}/ta/assignments/39067', headers={'Accept-Language': 'en'})
        assert response.status_code == 504
        assert 'Refresh the assignment list' in response.json()['detail']
        assert len(scenario.posts) == 2
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
