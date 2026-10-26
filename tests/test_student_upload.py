"""Exercise the actual two-stage wire protocol, without a live ILIAS session."""
from email import policy
from email.parser import BytesParser
from html import escape
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock
from urllib.parse import parse_qs, urlencode

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.scrapers.submissions import (
    parse_student_upload_form, parse_student_submission_navigation,
    parse_student_submitted_files_screen, parse_student_upload_errors,
)
from backend.services.ilias_client import IliasClient, StudentUploadError, SessionExpiredError

FIXTURES = Path(__file__).parent / 'fixtures'


@pytest.mark.parametrize(('fixture', 'ref_id', 'ass_id'), [
    ('student_upload_gti.html', '3794719', '54555'),
    ('student_upload_mms.html', '3803739', '53188'),
])
def test_real_upload_form_contract(fixture, ref_id, ass_id):
    form = parse_student_upload_form((FIXTURES / fixture).read_text(encoding='utf-8'))
    assert parse_qs(httpx.URL(form.upload_url).query.decode())['ref_id'] == [ref_id]
    assert parse_qs(httpx.URL(form.form_action).query.decode())['ass_id'] == [ass_id]
    assert form.token_input_name == 'form/input_0/input_1[input_0][]'
    assert form.file_field == 'file[0]'
    assert form.file_identifier == 'filename'
    assert form.max_files == 20 and form.max_size == 1_000_000_000
    assert not form.chunked and not form.disabled


def test_widget_configuration_and_dynamic_token_belong_to_the_selected_form():
    html = (FIXTURES / 'student_upload_gti.html').read_text(encoding='utf-8')
    html = html.replace('<template></template>', '<template><input type="hidden" name="form/input_0/input_1[input_7][]" value=""></template>')
    html = html.replace('method="post">', 'method="post"><input type="hidden" name="csrf" value="fresh">', 1)
    unrelated = '''<form action="ilias.php?baseClass=ilexercisehandlergui&amp;cmd=other">
      <input type="hidden" name="wrong" value="wrong"></form>
      <script>il.UI.Input.File.init('other', 'wrong.php', '', 'wrong', 0, 1, 2, '', false);</script>'''
    form = parse_student_upload_form(unrelated + html)
    assert form.token_input_name == 'form/input_0/input_1[input_7][]'
    assert form.hidden_inputs == {'csrf': 'fresh'}
    assert form.file_identifier == 'filename' and 'cmd=upload' in form.upload_url
    assert parse_student_upload_form(unrelated).upload_url is None


def multipart(request):
    message = BytesParser(policy=policy.default).parsebytes(
        b'Content-Type: ' + request.headers['content-type'].encode() + b'\r\nMIME-Version: 1.0\r\n\r\n' + request.content)
    return {part.get_param('name', header='content-disposition'): part.get_payload(decode=True) for part in message.iter_parts()}


class UploadScenario:
    def __init__(self, fixture='student_upload_gti.html', node='different:user:node'):
        self.html = (FIXTURES / fixture).read_text(encoding='utf-8').replace('dc:o5', node)
        self.form = parse_student_upload_form(self.html)
        query = parse_qs(httpx.URL(self.form.form_action).query.decode())
        self.ref, self.ass = query['ref_id'][0], query['ass_id'][0]
        self.node = node
        self.filename = 'Keine_empty_submission.pdf'
        self.file_bytes = b'%PDF-1.7\n\x00binary test file'
        self.posts, self.requests = [], []
        self.result = {'status': 1, 'filename': self.filename}
        self.upload_status, self.save_status = 200, 200
        self.save_html = '<div class="alert alert-success">Saved</div>'
        self.confirm = True
        self.allow_upload = True
        self.saved = False
        self.expected_session = 'this-tenant'
        self.rotate_session = False
        self.manager = MagicMock()
        self.manager.has_cookies.return_value = True
        self.manager.get_http_client.side_effect = lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(self.handle), follow_redirects=True,
            cookies={'PHPSESSID': 'this-tenant'})
        self.service = IliasClient(self.manager)
        # A previous user's successful overview request must never skip discovery.
        self.service._exercise_cmd_nodes[self.ref] = 'stale:other:role'

    def url(self, controller, command='', **extra):
        return 'https://ilias.unibe.ch/ilias.php?' + urlencode({
            'baseClass': 'ilexercisehandlergui', 'cmdNode': self.node,
            'cmdClass': controller, 'cmd': command, 'ref_id': self.ref, 'ass_id': self.ass, **extra,
        })

    def presentation(self):
        return '<h1 id="il_mhead_ttext">Assignment</h1><a href="' + escape(self.url('ilExSubmissionFileGUI', 'submissionScreen')) + '">Hand in</a>'

    def file_table(self):
        names = ['previous.pdf'] + ([self.filename] if self.saved and self.confirm else [])
        table = '<table><thead><tr><th></th><th>File Name</th><th>Date</th><th>Action</th></tr></thead><tbody>'
        for index, name in enumerate(names):
            table += f'''<tr><td><input name="delivered[]" value="{index+1}" type="checkbox"></td>
              <td><label>{escape(name)}</label></td><td>Today, 12:00</td>
              <td><a href="{escape(self.url('ilExSubmissionFileGUI', 'download', delivered=str(index+1)))}">Download</a></td></tr>'''
        return '<table class="calendar"><tbody><tr><td>Unrelated</td></tr></tbody></table>' + table + '</tbody></table>'

    def handle(self, request):
        self.requests.append(request)
        query = parse_qs(request.url.query.decode())
        assert 'PHPSESSID=' + self.expected_session in request.headers.get('cookie', '')
        if request.method == 'GET':
            if request.url.path == '/goto.php':
                assert query['target'] == ['exc_' + self.ref]
                return httpx.Response(200, text='<a href="' + escape(self.url('ilAssignmentPresentationGUI')) + '">Assignment</a>')
            assert query.get('cmdNode') != ['stale:other:role']
            if query['cmdClass'] == ['ilAssignmentPresentationGUI']:
                return httpx.Response(200, text=self.presentation())
            if query['cmd'] == ['submissionScreen']:
                link = '<a href="' + escape(self.url('ilExSubmissionFileGUI', 'uploadForm')) + '">Upload</a>' if self.allow_upload else ''
                return httpx.Response(200, text=link + self.file_table())
            if query['cmd'] == ['uploadForm']:
                headers = [('Set-Cookie', 'upload-context=current; Path=/')]
                if self.rotate_session:
                    self.expected_session = 'rotated-session'
                    headers.append(('Set-Cookie', 'PHPSESSID=rotated-session; Path=/'))
                return httpx.Response(200, text=self.html, headers=headers)
            raise AssertionError(f'Unexpected read: {request.url}')
        self.posts.append(request)
        assert 'upload-context=current' in request.headers['cookie']
        if query['cmd'] == ['upload']:
            if isinstance(self.result, str):
                return httpx.Response(self.upload_status, text=self.result)
            return httpx.Response(self.upload_status, json=self.result)
        assert query['cmd'] == ['addUpload']
        self.saved = True
        return httpx.Response(self.save_status, text=self.save_html)

    async def upload(self):
        return await self.service.upload_student_assignment_file(self.ref, self.ass, self.filename, self.file_bytes, 'application/pdf')


@pytest.mark.asyncio
@pytest.mark.parametrize('fixture', ['student_upload_gti.html', 'student_upload_mms.html'])
async def test_upload_uses_live_navigation_indexed_binary_and_only_nested_token(fixture):
    scenario = UploadScenario(fixture)
    detail = await scenario.upload()
    assert scenario.requests[0].url.path == '/goto.php'
    upload, save = scenario.posts
    assert multipart(upload) == {'file[0]': scenario.file_bytes}
    assert upload.headers['x-requested-with'] == 'XMLHttpRequest'
    assert upload.headers['accept'] == 'application/json'
    assert save.headers['content-type'].startswith('application/x-www-form-urlencoded')
    assert parse_qs(save.content.decode()) == {'form/input_0/input_1[input_0][]': [scenario.filename]}
    assert [file.filename for file in detail.submitted_files] == ['previous.pdf', scenario.filename]
    assert detail.last_submission == 'Today, 12:00'


@pytest.mark.asyncio
async def test_changed_field_names_single_file_limit_and_fresh_hidden_values():
    scenario = UploadScenario()
    scenario.html = scenario.html.replace('form/input_0/input_1', 'form/input_7/input_8').replace('<template></template>',
        '<template><input type="hidden" name="form/input_7/input_8[input_4][]" value=""></template>')
    scenario.html = scenario.html.replace('method="post">', 'method="post"><input type="hidden" name="csrf" value="fresh-token">', 1)
    scenario.html = scenario.html.replace('\n20,', '\n1,')
    await scenario.upload()
    assert multipart(scenario.posts[0]) == {'file': scenario.file_bytes}
    assert parse_qs(scenario.posts[1].content.decode()) == {
        'csrf': ['fresh-token'], 'form/input_7/input_8[input_4][]': [scenario.filename],
    }


@pytest.mark.asyncio
async def test_cookie_rotation_is_preserved_through_confirmation():
    scenario = UploadScenario()
    scenario.rotate_session = True
    await scenario.upload()
    assert scenario.manager.get_http_client.call_count == 1
    assert 'PHPSESSID=rotated-session' in scenario.requests[-1].headers['cookie']


@pytest.mark.asyncio
async def test_chunked_upload_uses_the_form_settings_and_one_upload_identifier():
    scenario = UploadScenario()
    scenario.html = scenario.html.replace('\nfalse,\n900000000', '\ntrue,\n4')
    await scenario.upload()
    chunks = [multipart(request) for request in scenario.posts[:-1]]
    assert len(chunks) == (len(scenario.file_bytes) + 3) // 4
    assert len({chunk['dzuuid'] for chunk in chunks}) == 1
    assert b''.join(chunk['file'] for chunk in chunks) == scenario.file_bytes
    assert [chunk['dzchunkindex'] for chunk in chunks] == [str(i).encode() for i in range(len(chunks))]
    assert [chunk['dzchunkbyteoffset'] for chunk in chunks] == [str(i*4).encode() for i in range(len(chunks))]
    assert all(chunk['dztotalfilesize'] == str(len(scenario.file_bytes)).encode() for chunk in chunks)
    assert all(chunk['dztotalchunkcount'] == str(len(chunks)).encode() for chunk in chunks)


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [
    {'status': 0, 'message': 'Team membership is required.'},
    {'status': 1}, {'filename': 'fallback.pdf'}, {'status': 1, 'filename': ''},
    {'status': 1, 'filename': ['not-a-token']}, {'status': True, 'filename': 'x.pdf'},
    [], '<html>Not JSON</html>',
])
async def test_rejected_or_malformed_upload_never_submits_a_guessed_token(result):
    scenario = UploadScenario()
    scenario.result = result
    with pytest.raises(StudentUploadError) as error:
        await scenario.upload()
    assert len(scenario.posts) == 1
    assert not scenario.saved
    if isinstance(result, dict) and result.get('message'):
        assert str(error.value) == result['message']


@pytest.mark.asyncio
@pytest.mark.parametrize(('status', 'exception'), [(500, StudentUploadError), (401, SessionExpiredError), (403, SessionExpiredError)])
async def test_http_failures_stop_before_final_submission(status, exception):
    scenario = UploadScenario()
    scenario.upload_status = status
    with pytest.raises(exception):
        await scenario.upload()
    assert len(scenario.posts) == 1


@pytest.mark.asyncio
async def test_upload_success_does_not_accept_an_unrelated_existing_file():
    scenario = UploadScenario()
    scenario.confirm = False
    with pytest.raises(StudentUploadError) as error:
        await scenario.upload()
    assert error.value.status_code == 409
    assert scenario.saved


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['closed', 'disabled', 'limit', 'size', 'missing-config', 'external-target', 'wrong-assignment'])
async def test_unavailable_or_invalid_forms_never_send_the_file(change):
    scenario = UploadScenario()
    if change == 'closed': scenario.allow_upload = False
    if change == 'disabled': scenario.html = scenario.html.replace('\nfalse,', '\ntrue,', 1)
    if change == 'limit': scenario.html = scenario.html.replace('\n20,', '\n0,')
    if change == 'size': scenario.html = scenario.html.replace('\n1000000000,', '\n1,')
    if change == 'missing-config': scenario.html = scenario.html.split('<script>')[0]
    if change == 'external-target': scenario.html = scenario.html.replace("'ilias.php?", "'https://example.com/ilias.php?")
    if change == 'wrong-assignment': scenario.html = scenario.html.replace('ass_id=54555', 'ass_id=99999')
    with pytest.raises(StudentUploadError):
        await scenario.upload()
    assert scenario.posts == []


@pytest.mark.asyncio
async def test_visible_final_errors_are_not_mistaken_for_a_successful_post():
    scenario = UploadScenario()
    scenario.save_html = '<div class="alert alert-danger">The file limit has been reached.</div>'
    with pytest.raises(StudentUploadError, match='file limit'):
        await scenario.upload()
    assert len(scenario.posts) == 2


def test_embedded_dialog_errors_do_not_reject_successful_uploads():
    assert parse_student_upload_errors('<div class="modal"><div class="alert-danger">Hidden dialog</div></div><p>Saved</p>') is None


def test_submission_navigation_ignores_links_for_other_assignments():
    html = '<a href="ilias.php?cmdClass=ilExSubmissionFileGUI&amp;cmd=uploadForm&amp;ref_id=42&amp;ass_id=99">Other</a>'
    assert parse_student_submission_navigation(html, '42', '12') == {}


@pytest.mark.parametrize('error', [StudentUploadError('File rejected.', 400), httpx.ConnectError('Network unavailable')])
def test_api_exposes_upload_errors_instead_of_returning_success(error):
    service = MagicMock()
    service.upload_student_assignment_file = AsyncMock(side_effect=error)
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        response = TestClient(app).post('/api/exercises/42/assignment/12/upload', files={'file': ('answer.pdf', b'file', 'application/pdf')}, headers={'Accept-Language': 'en'})
        assert response.status_code == (error.status_code if isinstance(error, StudentUploadError) else 502)
        assert isinstance(response.json()['detail'], str)
        assert 'Network unavailable' not in response.json()['detail']
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
