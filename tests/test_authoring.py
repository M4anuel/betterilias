"""Native authoring contract regression tests using sanitized saved-page excerpts."""
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import parse_qs
from email import policy
from email.parser import BytesParser

import httpx
import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.schemas import CreateFolderRequest
from backend.scrapers.authoring import parse_authoring_context, parse_creation_form, parse_file_names
from backend.services.authoring import AuthoringError
from backend.services.ilias_client import IliasClient

FIXTURES = Path(__file__).parent / 'fixtures' / 'authoring'
CONTEXT = (FIXTURES / 'context.html').read_text(encoding='utf8')
FOLDER = (FIXTURES / 'folder.html').read_text(encoding='utf8')
FILE = (FIXTURES / 'file.html').read_text(encoding='utf8')
CREATED_FILE = (FIXTURES / 'created_file.html').read_text(encoding='utf8')


def material(ref_id, title, kind):
    return f'''<div class="ilContainerListItem" id="lg_div_{ref_id}">
      <img src="icon_{kind}.svg"><h3 class="il_ContainerItemTitle"><a href="https://ilias.unibe.ch/go/{kind}/{ref_id}">{title}</a></h3></div>'''


def service(handler):
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return IliasClient(manager)


def multipart(request):
    msg = BytesParser(policy=policy.default).parsebytes(
        f'Content-Type: {request.headers["content-type"]}\r\nMIME-Version: 1.0\r\n\r\n'.encode() + request.content)
    return {part.get_param('name', header='content-disposition'): part.get_payload(decode=True).decode()
            for part in msg.iter_parts()}


def test_saved_context_detects_all_objects_and_scopes_permissions():
    context = parse_authoring_context(CONTEXT, '42')
    assert len(context.creatable_types) == 30
    assert {'fold', 'file', 'exc'} <= set(context.creatable_types)
    assert context.can_create and context.can_manage and context.can_edit_page
    assert 'creation_urls' not in context.model_dump()
    assert not parse_authoring_context(CONTEXT, '43').can_create
    assert not parse_authoring_context('<h1>Student course</h1>', '42').can_create
    disabled = '<a aria-disabled="true" href="ilias.php?ref_id=42&cmd=create&new_type=fold">Folder</a>'
    assert not parse_authoring_context(disabled, '42').can_create


def test_saved_forms_use_real_template_labels_tokens_and_file_metadata():
    folder = parse_creation_form(FOLDER, '42', 'fold')
    assert folder.title_field == 'form/input_0/input_1'
    assert folder.description_field == 'form/input_0/input_2'
    assert folder.templates == [dict(value='dtpl_0', label='Default', selected=True), dict(value='dtpl_5', label='Hidden folder', selected=False)]
    assert 'rtoken=fixture-token' in folder.action
    file = parse_creation_form(FILE, '42', 'file')
    assert len(file.licenses) == 8 and file.licenses[0]['selected']
    assert 'ilObjFileUploadHandlerGUI' in file.upload_url
    assert file.file_fields == ['form/input_0[input_1][]', 'form/input_0[input_2][]', 'form/input_0[input_3][]']


@pytest.mark.asyncio
async def test_folder_creation_preserves_native_defaults_and_verifies_new_ref():
    posted = []
    existing = material('50', 'New folder', 'fold')
    def handler(request):
        if request.method == 'POST':
            posted.append(multipart(request))
            assert 'rtoken=fixture-token' in str(request.url)
            return httpx.Response(200, text='<div id="ilTab">Saved</div>')
        if parse_qs(request.url.query.decode()).get('cmd') == ['create']:
            return httpx.Response(200, text=FOLDER)
        return httpx.Response(200, text=CONTEXT + existing + (material('51', 'New folder', 'fold') if posted else ''))
    result = await service(handler).create_folder('42', CreateFolderRequest(title=' New folder ', description='Teaching materials'))
    assert [item.ref_id for item in result.items] == ['51']
    assert posted == [{'form/input_0/input_1': 'New folder', 'form/input_0/input_2': 'Teaching materials', 'form/input_3': 'dtpl_0'}]


@pytest.mark.asyncio
async def test_student_cannot_bypass_creation_permissions():
    def handler(request):
        assert request.method == 'GET'
        return httpx.Response(200, text='<div id="ilTab">Student</div>')
    with pytest.raises(AuthoringError) as exc:
        await service(handler).create_folder('42', CreateFolderRequest(title='Unauthorized'))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_timeout_does_not_replay_folder_creation():
    posts = []
    def handler(request):
        if request.method == 'POST':
            posts.append(request)
            raise httpx.ReadTimeout('Response lost', request=request)
        return httpx.Response(200, text=FOLDER if 'cmd=create' in str(request.url) else CONTEXT)
    with pytest.raises(AuthoringError) as exc:
        await service(handler).create_folder('42', CreateFolderRequest(title='New folder'))
    assert exc.value.status_code == 502 and len(posts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('upload_result', [{'status': 1, 'file_id': 'resource-123'}, {'status': 0}, {'status': 1}])
@pytest.mark.parametrize('display_title', ['notes.pdf', 'notes'])
async def test_file_upload_follows_handler_then_metadata_save(upload_result, display_title):
    posts = []
    def handler(request):
        query = parse_qs(request.url.query.decode())
        if request.method == 'POST':
            posts.append(request)
            if query.get('cmd') == ['upload']:
                payload = multipart(request)
                assert payload == {'file[0]': 'PDF content'}
                return httpx.Response(200, json=upload_result)
            payload = multipart(request)
            assert payload == {'form/input_0[input_1][]': 'notes.pdf', 'form/input_0[input_2][]': '',
                               'form/input_0[input_3][]': 'resource-123', 'form/input_1': 'il_copyright_entry__0__7'}
            return httpx.Response(200, text='<div id="ilTab">Saved</div>')
        if query.get('cmd') == ['create']:
            return httpx.Response(200, text=FILE)
        return httpx.Response(200, text=CONTEXT + (material('51', display_title, 'file') if len(posts) == 2 else ''))
    upload = UploadFile(filename='notes.pdf', file=BytesIO(b'PDF content'))
    if upload_result.get('file_id'):
        result = await service(handler).upload_course_file('42', upload, 'il_copyright_entry__0__7')
        assert result.success and result.items[0].ref_id == '51' and len(posts) == 2
    else:
        with pytest.raises(AuthoringError):
            await service(handler).upload_course_file('42', upload, 'il_copyright_entry__0__7')
        assert len(posts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('existing,filename,confirmed', [(False, 'downloadfile.pdf', True), (True, 'downloadfile.pdf', False), (False, 'downloadfile.txt', False)])
async def test_live_extensionless_file_title_and_full_filename(existing, filename, confirmed):
    posts = []
    def handler(request):
        if request.method == 'POST':
            posts.append(request)
            if 'cmd=upload&' in str(request.url):
                return httpx.Response(200, json={'status': 1, 'file_id': 'native-resource'})
            return httpx.Response(200, text=CREATED_FILE)
        if 'cmd=create' in str(request.url):
            return httpx.Response(200, text=FILE)
        return httpx.Response(200, text=CONTEXT + (CREATED_FILE if existing or len(posts) == 2 else ''))
    assert parse_file_names(CREATED_FILE) == {'51': 'downloadfile.pdf'}
    upload = UploadFile(filename=filename, file=BytesIO(b'file content'))
    if confirmed:
        result = await service(handler).upload_course_file('42', upload, 'il_copyright_entry__0__7')
        assert result.items[0].title == 'downloadfile'
    else:
        with pytest.raises(AuthoringError):
            await service(handler).upload_course_file('42', upload, 'il_copyright_entry__0__7')
    assert len(posts) == 2


@pytest.mark.asyncio
async def test_stale_license_is_rejected_before_upload():
    def handler(request):
        assert request.method == 'GET'
        return httpx.Response(200, text=FILE if 'cmd=create' in str(request.url) else CONTEXT)
    with pytest.raises(AuthoringError) as exc:
        await service(handler).upload_course_file('42', UploadFile(filename='notes.pdf', file=BytesIO(b'data')), 'removed-license')
    assert exc.value.status_code == 400


def test_routes_validate_input_and_hide_native_urls():
    app.dependency_overrides[get_ilias_client] = lambda: service(lambda request: httpx.Response(200, text=CONTEXT))
    try:
        with TestClient(app) as client:
            context = client.get('/api/materials/42/authoring-context').json()
            assert context['can_create'] and 'creation_urls' not in context
            assert client.post('/api/materials/42/folders', json={'title': ''}).status_code == 422
            assert client.post('/api/materials/invalid/folders', json={'title': 'Test'}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
