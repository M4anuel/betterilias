"""Repository writes must follow live controls and match the user's reviewed scope."""
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.schemas import DeleteMaterialsRequest, SaveMaterialOrderRequest
from backend.scrapers.dumper import ScrapingParsingError
from backend.scrapers.management import parse_management, parse_sorting, parse_delete_confirmation
from backend.services.authoring import AuthoringError
from backend.services.management import order_revision
from tests.test_authoring import service, CONTEXT

FIXTURES = Path(__file__).parent / 'fixtures' / 'management'
MANAGE = (FIXTURES / 'manage.html').read_text(encoding='utf8')
SORT = (FIXTURES / 'sorting.html').read_text(encoding='utf8')


def native_manage(ref, items):
    rows = ''.join(f'''<div class="ilContainerListItemOuter"><input name="id[]" type="checkbox" value="{child}">
      <img src="icon_{kind}.svg"><div class="il_ContainerListItem"><h3><a href="https://ilias.unibe.ch/go/{kind}/{child}">{title}</a></h3></div></div>'''
                   for child, title, kind in items)
    return f'''<div id="ilTab"></div><a href="ilias.php?ref_id={ref}&cmd=editOrder">Sorting</a>
      <form action="https://ilias.unibe.ch/ilias.php?ref_id={ref}&cmd=post&rtoken=fresh">
      <input type="hidden" name="csrf" value="native-token"><input name="cmd[delete]" type="submit" value="Delete">{rows}</form>'''


def native_sort(ids):
    return '<form action="https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=post&rtoken=sort-token"><input type="submit" name="cmd[saveSorting]" value="Save Order">' + ''.join(
        f'<input name="position[{ref}]" value="{(index+1)*10}">' for index, ref in enumerate(ids)) + '</form>'


def confirmation(ids, modern=True):
    if modern:
        inputs = ''.join(f'<input type="hidden" name="form/input_{index}" value="{ref}">' for index, ref in enumerate(ids))
        return f'''<form action="https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=confirmedDelete&id={','.join(ids)}&rtoken=confirm-token">
          {inputs}<input type="hidden" name="csrf" value="confirmation-token">
          <select name="form/extra[]" multiple><option value="999">Other location</option></select></form>'''
    return f'''<form action="https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=post&rtoken=confirm-token">
      {''.join(f'<input type="hidden" name="id[]" value="{ref}">' for ref in ids)}
      <input name="cmd[confirmedDelete]" type="submit" value="Delete"></form>'''


def test_saved_native_manage_and_sort_forms():
    managed = parse_management(MANAGE, '42')
    assert [item.ref_id for item in managed.items] == ['3856626', '3856627']
    assert all(item.can_delete for item in managed.items)
    sorting = parse_sorting(SORT, '42')
    assert len(sorting.positions) == 9
    assert sorting.positions['3114488'] == ('position[3114488]', '10')
    assert 'fixture-token' in sorting.action


@pytest.mark.parametrize('modern', [True, False])
def test_confirmation_preserves_selected_ids_and_omits_optional_other_references(modern):
    parsed = parse_delete_confirmation(confirmation(['51', '52'], modern), '42', {'51', '52'})
    assert 'confirm-token' in parsed.action
    assert all(name != 'form/extra[]' for name, _ in parsed.values)
    if not modern:
        assert [value for name, value in parsed.values if name == 'id[]'] == ['51', '52']
    with pytest.raises(ScrapingParsingError):
        parse_delete_confirmation(confirmation(['51', '999'], modern), '42', {'51', '52'})


def test_page_element_delete_is_never_used_for_repository_deletion():
    html = '<form action="https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=deleteElements"><input name="target[]" value="page-element"></form>'
    with pytest.raises(ScrapingParsingError):
        parse_delete_confirmation(html, '42', {'51'})


@pytest.mark.parametrize('malformed', [
    lambda html: html.replace('cmd=post', 'cmd=confirmedDelete&id=999'),
    lambda html: html.replace('cmd=post', 'cmd=post&cmdClass=ilpageeditorgui'),
    lambda html: html.replace('</form>', '<input type="hidden" name="cmd[confirmedDelete]" value="Delete"></form>'),
])
def test_management_form_cannot_skip_native_confirmation(malformed):
    with pytest.raises(ScrapingParsingError):
        parse_management(malformed(native_manage('42', [('51', 'Notes', 'file')])), '42')


def test_disabled_items_are_reviewed_and_pagination_is_never_assumed_complete():
    disabled = native_manage('42', [('51', 'Not deletable', 'file')]).replace('type="checkbox"', 'type="checkbox" disabled')
    assert parse_management(disabled, '42').items[0].can_delete is False
    paginated = native_manage('42', []).replace('</form>', '<a href="ilias.php?ref_id=42&offset=20">Next page</a></form>')
    with pytest.raises(ScrapingParsingError):
        parse_management(paginated, '42')


def test_confirmation_rejects_implicit_extra_hidden_references():
    hidden_extra = confirmation(['51']).replace('</form>', '<input type="hidden" name="form/input_99" value="999"></form>')
    with pytest.raises(ScrapingParsingError):
        parse_delete_confirmation(hidden_extra, '42', {'51'})


class NativeRepository:
    def __init__(self):
        self.items = {'42': [('51', 'Lecture notes', 'file'), ('52', 'Folder', 'fold')],
                      '52': [('53', 'Nested file', 'file')]}
        self.order = ['51', '52']
        self.posts = []
        self.timeout = False
        self.confirmed_but_kept = False
        self.extra_id = False
        self.change_after_modal = False

    def __call__(self, request):
        query = parse_qs(request.url.query.decode())
        ref = query.get('ref_id', ['42'])[0]
        if request.method == 'GET':
            if query.get('cmd') == ['editOrder']:
                return httpx.Response(200, text=native_sort(self.order))
            return httpx.Response(200, text=native_manage(ref, self.items.get(ref, [])))
        payload = parse_qs(request.content.decode(), keep_blank_values=True)
        self.posts.append((query, payload))
        if 'cmd[saveSorting]' in payload:
            self.order = sorted(self.order, key=lambda child: int(payload[f'position[{child}]'][0]))
            return httpx.Response(200, text=native_sort(self.order))
        if 'cmd[delete]' in payload:
            ids = payload['id[]'] + (['999'] if self.extra_id else [])
            if self.change_after_modal:
                self.items['52'].append(('54', 'Concurrent upload', 'file'))
            return httpx.Response(200, text=confirmation(ids))
        assert query['cmd'] == ['confirmedDelete']
        if self.timeout:
            raise httpx.ReadTimeout('Native save response lost', request=request)
        assert 'form/extra[]' not in payload
        if not self.confirmed_but_kept:
            selected = set(query['id'][0].split(','))
            self.items[ref] = [item for item in self.items[ref] if item[0] not in selected]
        return httpx.Response(200, text=native_manage(ref, self.items[ref]))


@pytest.mark.asyncio
async def test_recursive_review_then_confirmed_folder_deletion():
    native = NativeRepository()
    client = service(native)
    review = await client.review_material_deletion('42', ['52'])
    assert review.descendants == 1 and review.items[0].children[0].title == 'Nested file'
    assert not native.posts
    result = await client.delete_materials('42', DeleteMaterialsRequest(item_ids=['52'], revision=review.revision))
    assert result['deleted_ids'] == ['52']
    assert len(native.posts) == 2
    assert native.posts[0][1]['id[]'] == ['52']
    assert native.posts[1][1]['form/input_0'] == ['52']


@pytest.mark.asyncio
@pytest.mark.parametrize('when', ['before_confirmation', 'after_modal'])
async def test_changed_folder_contents_abort_before_deletion(when):
    native = NativeRepository()
    client = service(native)
    review = await client.review_material_deletion('42', ['52'])
    if when == 'after_modal':
        native.change_after_modal = True
    else:
        native.items['52'].append(('54', 'Concurrent upload', 'file'))
    with pytest.raises(AuthoringError) as exc:
        await client.delete_materials('42', DeleteMaterialsRequest(item_ids=['52'], revision=review.revision))
    assert exc.value.status_code == 409
    assert len(native.posts) == (1 if when == 'after_modal' else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['timeout', 'confirmed_but_kept', 'extra_id'])
async def test_uncertain_deletion_is_not_replayed(failure):
    native = NativeRepository()
    client = service(native)
    review = await client.review_material_deletion('42', ['51'])
    setattr(native, failure, True)
    with pytest.raises((AuthoringError, ScrapingParsingError)):
        await client.delete_materials('42', DeleteMaterialsRequest(item_ids=['51'], revision=review.revision))
    assert len(native.posts) == (1 if failure == 'extra_id' else 2)


@pytest.mark.asyncio
async def test_native_redirect_cannot_replay_confirmed_deletion():
    native = NativeRepository()
    confirmed = []
    def handler(request):
        if request.method == 'POST' and parse_qs(request.url.query.decode()).get('cmd') == ['confirmedDelete']:
            confirmed.append(request)
            return httpx.Response(307, headers={'Location': str(request.url)})
        return native(request)
    client = service(handler)
    review = await client.review_material_deletion('42', ['51'])
    with pytest.raises(AuthoringError):
        await client.delete_materials('42', DeleteMaterialsRequest(item_ids=['51'], revision=review.revision))
    assert len(confirmed) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('ids', [['999'], ['42'], ['51', '51'], ['invalid']])
async def test_unrelated_or_duplicate_ids_are_rejected(ids):
    native = NativeRepository()
    with pytest.raises(AuthoringError):
        await service(native).review_material_deletion('42', ids)
    assert not native.posts


@pytest.mark.asyncio
async def test_unreadable_folder_contents_are_not_assumed_empty():
    native = NativeRepository()
    def handler(request):
        if parse_qs(request.url.query.decode()).get('ref_id') == ['52']:
            return httpx.Response(200, text='<div id="ilTab">No management permission</div>')
        return native(request)
    with pytest.raises(AuthoringError):
        await service(handler).review_material_deletion('42', ['52'])
    assert not native.posts


@pytest.mark.asyncio
async def test_read_only_management_is_denied_without_native_writes():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, text='<div id="ilTab">Student content</div>')
    with pytest.raises(AuthoringError) as exc:
        await service(handler).get_management('42')
    assert exc.value.status_code == 403
    assert all(request.method == 'GET' for request in calls)


@pytest.mark.asyncio
async def test_management_restores_content_mode_and_keeps_page_editor_capability():
    calls = []
    def handler(request):
        command = parse_qs(request.url.query.decode()).get('cmd', [''])[0]
        calls.append(command)
        return httpx.Response(200, text=MANAGE if command == 'enableAdministrationPanel' else SORT if command == 'editOrder' else CONTEXT)
    data = await service(handler).get_management('42')
    assert data.authoring.can_create and data.authoring.can_edit_page
    assert data.editor_url and 'editPageFrame' in data.editor_url
    assert calls[-1] == 'view'


@pytest.mark.asyncio
async def test_native_order_uses_fresh_fields_and_rejects_stale_or_missing_items():
    native = NativeRepository()
    client = service(native)
    state = await client.get_management('42')
    assert state.can_sort and state.order == ['51', '52']
    await client.save_material_order('42', SaveMaterialOrderRequest(item_ids=['52', '51'], revision=state.order_revision))
    assert native.order == ['52', '51']
    assert native.posts[0][1]['position[52]'] == ['10']
    with pytest.raises(AuthoringError):
        await client.save_material_order('42', SaveMaterialOrderRequest(item_ids=['51', '52'], revision=state.order_revision))
    with pytest.raises(AuthoringError):
        await client.save_material_order('42', SaveMaterialOrderRequest(item_ids=['51'], revision=state.order_revision))
    assert len(native.posts) == 1


def test_management_routes_hide_native_fields_and_validate_selections():
    native = NativeRepository()
    app.dependency_overrides[get_ilias_client] = lambda: service(native)
    try:
        with TestClient(app) as client:
            data = client.get('/api/materials/42/management').json()
            assert data['can_sort'] and 'action' not in data
            assert 'creation_urls' not in data['authoring']
            assert client.post('/api/materials/42/deletion-review', json={'item_ids': []}).status_code == 422
            review = client.post('/api/materials/42/deletion-review', json={'item_ids': ['51']}).json()
            response = client.post('/api/materials/42/batch/delete', json={'item_ids': ['51'], 'revision': review['revision']})
            assert response.status_code == 200 and response.json()['deleted_ids'] == ['51']
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
