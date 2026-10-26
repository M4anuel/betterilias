"""Native TA resource-collection upload contract, including real table markup."""
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import parse_qs
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.api.deps import get_ilias_client
from backend.services.ilias_client import IliasClient, StudentUploadError
from backend.scrapers.submissions import parse_native_file_upload_form
from backend.scrapers.exercise_editor import parse_instruction_files, parse_ta_assignment_form, build_ta_assignment_payload
from backend.schemas import SaveTAAssignmentRequest
from tests.test_student_upload import multipart
from tests.test_ta_assignment_save import NATIVE_FORM

FIXTURES = Path(__file__).parent / 'fixtures'
UPLOAD = (FIXTURES / 'ta_instruction_upload.html').read_text(encoding='utf-8')
FILES = (FIXTURES / 'ta_instruction_files.html').read_text(encoding='utf-8')


def test_native_resource_upload_form_and_table():
    form = parse_native_file_upload_form(UPLOAD, command='postUpload')
    assert parse_qs(httpx.URL(form.upload_url).query.decode())['cmd'] == ['upload']
    assert form.token_input_name == 'form/input_0[input_0][]'
    assert form.file_identifier == 'resource_id' and form.file_field == 'file[0]'
    files = parse_instruction_files(FILES)
    assert len(files) == 1
    assert files[0].filename == '05-conditional-handout.pdf'
    assert files[0].file_size == '9.98 MB' and files[0].download_url


def test_instruction_html_uses_ilias_mini_rte_tags_and_survives_editing():
    html = '<p><strong>Bold</strong> <em>italic</em><br/><a href="https://example.org" target="_blank">Link</a></p>'
    native = NATIVE_FORM.replace('style="display: none;"></textarea>', 'style="display: none;">' + html.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') + '</textarea>', 1)
    form = parse_ta_assignment_form(native, '2978156')
    assert form.instruction_html == html
    payload = build_ta_assignment_payload(form, SaveTAAssignmentRequest(title='Test', instruction_html='<div><b>Bold</b> <i>Italic</i><br></div>', deadline_mode=-1))
    assert payload['instruction'] == '<p><strong>Bold</strong> <em>Italic</em><br/></p>'


class Scenario:
    def __init__(self):
        self.requests = []
        self.result = {'status': 1, 'resource_id': 'new-resource'}
        self.status = 200
        self.show_file = True
        self.preexisting = False
        self.uploaded = False
        manager = MagicMock()
        manager.has_cookies.return_value = True
        manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(self.handle), follow_redirects=True)
        self.client = IliasClient(manager)
        self.manager = manager

    def handle(self, request):
        self.requests.append(request)
        cmd = parse_qs(request.url.query.decode())['cmd'][0]
        if request.method == 'GET':
            assert cmd == 'index'
            listing = FILES if (self.uploaded and self.show_file) or self.preexisting else ''
            return httpx.Response(200, text=UPLOAD + listing, headers={'Set-Cookie': 'fresh=form; Path=/'})
        assert 'fresh=form' in request.headers.get('cookie', '')
        if cmd == 'upload':
            assert multipart(request) == {'file[0]': b'%PDF-test'}
            self.uploaded = True
            if isinstance(self.result, str): return httpx.Response(self.status, text=self.result)
            return httpx.Response(self.status, json=self.result)
        assert cmd == 'postUpload'
        assert parse_qs(request.content.decode()) == {'form/input_0[input_0][]': ['new-resource']}
        return httpx.Response(200, text='<p>Saved</p>')

    async def upload(self):
        return await self.client.upload_instruction_file('2978156', '54652', '05-conditional-handout.pdf', b'%PDF-test', 'application/pdf')


@pytest.mark.asyncio
async def test_upload_binary_then_resource_token_then_verify_new_file():
    scenario = Scenario()
    files = await scenario.upload()
    assert len(files) == 1 and files[0].filename == '05-conditional-handout.pdf'
    assert [parse_qs(r.url.query.decode())['cmd'][0] for r in scenario.requests] == ['index', 'upload', 'postUpload', 'index']
    assert scenario.manager.get_http_client.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('result', ['<p>Redirected to desktop</p>', {}, [], {'status': 1}, {'status': True, 'resource_id': 'x'}, {'status': 0, 'message': 'File rejected'}])
async def test_bad_upload_response_never_posts_save_or_reports_success(result):
    scenario = Scenario()
    scenario.result = result
    with pytest.raises(StudentUploadError): await scenario.upload()
    assert len(scenario.requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('preexisting', [False, True])
async def test_missing_new_file_is_not_reported_as_success(preexisting):
    scenario = Scenario()
    scenario.preexisting = preexisting
    scenario.show_file = False
    with pytest.raises(StudentUploadError) as error: await scenario.upload()
    assert error.value.status_code == 409


def test_api_returns_actionable_upload_failure():
    scenario = Scenario()
    scenario.result = {'status': 0, 'message': 'File rejected'}
    app.dependency_overrides[get_ilias_client] = lambda: scenario.client
    try:
        response = TestClient(app).post('/api/exercises/2978156/ta/assignments/54652/instruction-files', files={'file': ('test.pdf', b'%PDF-test', 'application/pdf')})
        assert response.status_code == 400
        assert response.json()['detail'] == 'File rejected'
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
