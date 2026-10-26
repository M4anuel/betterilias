from html import escape
from importlib import import_module
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import parse_qs, urlencode
from unittest.mock import MagicMock, AsyncMock

import httpx
import pytest
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.schemas import SaveTAAssignmentRequest
from backend.scrapers.exercise_editor import (
    parse_ta_assignment_form, build_ta_assignment_payload, parse_ta_assignment_error,
    parse_ta_assignments_list,
)
from backend.services.ilias_client import IliasClient, SessionExpiredError
from backend.services.assignment_multipart import encode_assignment_form
from backend.scrapers.dumper import ScrapingParsingError
from tests.test_student_upload import multipart

NATIVE_FORM = (Path(__file__).parent/'fixtures/ta_create_upload.html').read_text(encoding='utf-8')
NATIVE_LIST = (Path(__file__).parent/'fixtures/ta_assignments_list.html').read_text(encoding='utf-8')


def upload_parts(request):
    message = BytesParser(policy=policy.default).parsebytes(
        b'Content-Type: ' + request.headers['content-type'].encode() + b'\r\n\r\n' + request.content)
    # PHP classifies a multipart part as an upload by the presence of filename,
    # including filename="". Looking only at the part's bytes misses the bug.
    return {part.get_param('name', header='content-disposition'): part
            for part in message.iter_parts() if part.get_filename() is not None}


def test_empty_native_uploads_have_explicit_filename_parameters():
    form = parse_ta_assignment_form(NATIVE_FORM, '2978156')
    assert set(form.file_inputs) == {'files[0]', 'fb_file'}
    body, content_type = encode_assignment_form({'title': 'Übung', 'instruction': 'a\nb'}, form.file_inputs)
    request = httpx.Request('POST', 'https://example.invalid', content=body, headers={'Content-Type': content_type})
    uploads = upload_parts(request)
    assert set(uploads) == {'files[0]', 'fb_file'}
    assert all(part.get_filename() == '' and part.get_payload(decode=True) == b'' for part in uploads.values())
    assert multipart(request)['title'].decode() == 'Übung'
    assert multipart(request)['instruction'] == b'a\r\nb'


def test_httpx_empty_file_tuple_is_not_a_php_upload():
    request = httpx.Request('POST', 'https://example.invalid', files={'files[0]': ('', b'', 'application/octet-stream')})
    request.read()
    assert upload_parts(request) == {}


def editor_form(type_id=1, ass_id=None, title='', tutor_teams=False):
    """Native upload fixture, with team controls matching ILIAS 10's editor."""
    soup = BeautifulSoup(NATIVE_FORM, 'lxml')
    form = soup.find('form')
    query = parse_qs(httpx.URL(form['action']).query.decode())
    values = {key: value[0] for key, value in query.items()}
    values['ass_type'] = str(type_id)
    if ass_id:
        values['ass_id'] = ass_id
        for control in form.find_all(attrs={'name': 'cmd[saveAssignment]'}):
            control['name'] = 'cmd[updateAssignment]'
    form['action'] = 'https://ilias.unibe.ch/ilias.php?' + urlencode(values)
    form.find(attrs={'name': 'title'})['value'] = title
    form.find('input', attrs={'name': 'type'})['value'] = str(type_id)
    for option in form.select('select[name="type"] option'):
        option.attrs.pop('selected', None)
        if option['value'] == str(type_id): option['selected'] = ''
    if type_id == 4:
        # Team forms are not included in CreateExercises. This reconstruction
        # deliberately exercises the nested controls omitted by the old payload.
        team_html = '''<div id="team_creator">
          <input type="radio" name="team_creator" value="0" checked>
          <input type="radio" name="team_creator" value="1">
          <div class="ilSubForm" id="subform_team_creator_1" style="display:none">
            <input type="radio" name="team_creation" value="0" checked required>
            <input type="radio" name="team_creation" value="1">
            <div class="ilSubForm" id="subform_team_creation_1">
              <input name="number_teams" required value="">
              <input name="min_participants_team" required value="">
              <input name="max_participants_team" required value="">
            </div>
          </div></div>'''
        if tutor_teams:
            team_html = team_html.replace('value="0" checked>', 'value="0">', 1).replace('value="1">', 'value="1" checked>', 1)
        form.append(BeautifulSoup(team_html, 'html.parser'))
    return str(form)


def test_native_form_defaults_and_inactive_required_fields():
    form = parse_ta_assignment_form(NATIVE_FORM, '2978156')
    assert parse_ta_assignment_error(NATIVE_FORM) is None
    request = SaveTAAssignmentRequest(title='New assignment', deadline='2030-12-31T23:59')
    values = build_ta_assignment_payload(form, request)
    assert values['deadline_mode'] == '0'
    assert values['deadline'] == '2030-12-31T23:59'
    assert values['start_time'] == ''
    assert values['ilfilehash'] == 'fixture-file-hash'
    assert values['cmd[saveAssignment]'] == 'Save'
    assert not {'fb_date', 'fb_date_custom', 'rmd_submit_template_id', 'rmd_grade_template_id', 'relative_deadline', 'max_file'} & values.keys()


@pytest.mark.parametrize('tutor_teams', [False, True])
def test_team_formation_defaults_are_preserved_only_in_the_active_branch(tutor_teams):
    form = parse_ta_assignment_form(editor_form(4, tutor_teams=tutor_teams), '2978156')
    values = build_ta_assignment_payload(form, SaveTAAssignmentRequest(title='Team work', type_id=4, deadline_mode=-1))
    assert values['team_creator'] == ('1' if tutor_teams else '0')
    assert ('team_creation' in values) == tutor_teams
    if tutor_teams: assert values['team_creation'] == '0'
    assert not {'number_teams', 'min_participants_team', 'max_participants_team', 'deadline', 'deadline2'} & values.keys()


def test_existing_settings_are_not_disabled_by_unrelated_edits():
    soup = BeautifulSoup(editor_form(4, '10', 'Old', tutor_teams=True), 'lxml')
    soup.find(attrs={'name': 'fb'})['checked'] = ''
    form = parse_ta_assignment_form(str(soup), '2978156', '10')
    values = build_ta_assignment_payload(form, SaveTAAssignmentRequest(ass_id='10', title='Edited', type_id=4, deadline='2030-12-31T23:59'))
    assert values['fb'] == '1' and values['fb_date'] == '1'
    assert values['team_creator'] == '1' and values['team_creation'] == '0'
    assert values['cmd[updateAssignment]'] == 'Save'
    assert 'cmd[saveAssignment]' not in values


def test_unselected_native_team_radio_does_not_invent_a_tutor_creation_mode():
    soup = BeautifulSoup(editor_form(4), 'lxml')
    for control in soup.select('input[name="team_creator"]'):
        control.attrs.pop('checked', None)
    form = parse_ta_assignment_form(str(soup), '2978156')
    values = build_ta_assignment_payload(form, SaveTAAssignmentRequest(title='Team work', type_id=4, deadline_mode=-1))
    assert not {'team_creator', 'team_creation', 'number_teams'} & values.keys()


def test_validation_errors_exclude_hints_and_hidden_dialogs():
    html = '''<div class="alert alert-danger"><span class="ilAccHeadingHidden">Failure</span>Incomplete input.</div>
      <p class="help-block">Participants opt for teams.</p>
      <p class="help-block">Maximum upload size: 953.7 MB</p>
      <div class="modal"><p class="alert-danger">The uploaded file exceeds the max size.</p></div>
      <div class="has-error"><p class="help-block" id="desc_deadline">Ordinary deadline hint</p>
      <p class="help-block">This input is required.</p></div>'''
    assert parse_ta_assignment_error(html) == 'Incomplete input.\nThis input is required.'
    assert parse_ta_assignment_error('<div class="has-error"><label class="control-label">Deadline *</label><p class="help-block">Required.</p></div>') == 'Deadline: Required.'


class CreationScenario:
    ref = '2978156'
    def __init__(self, type_id=4, editing=False):
        self.type_id, self.editing = type_id, editing
        self.title = 'New team assignment'
        self.created = False
        self.confirm = True
        self.post_error = None
        self.save_status = 200
        self.posts, self.requests = [], []
        self.manager = MagicMock()
        self.manager.has_cookies.return_value = True
        self.manager.get_http_client.side_effect = lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(self.handle), cookies={'PHPSESSID':'tenant'}, follow_redirects=True)
        self.client = IliasClient(self.manager)
        self.client._exercise_cmd_nodes[self.ref] = 'dc:o5'

    def url(self, command, **extra):
        return 'https://ilias.unibe.ch/ilias.php?' + urlencode(dict(
            baseClass='ilexercisehandlergui', cmdNode='dc:o5:cs', cmdClass='ilExAssignmentEditorGUI',
            cmd=command, ref_id=self.ref, rtoken='b'*64, **extra))

    def listing(self):
        html = '<form action="' + escape(self.url('post', fallbackCmd='addAssignment')) + '''">
          <select name="type"><option value="1">Upload</option><option value="4">Team Upload</option>
          <option value="5">Text</option><option value="3">Portfolio</option><option value="6">Team Wiki</option></select>
          <button name="cmd[addAssignment]">Add</button></form>'''
        html += '<form action="' + escape(self.url('post')) + '"><input name="cmd[saveAssignmentOrder]" type="submit"><table><tbody>'
        entries = [('10', self.title if not self.editing or self.created else 'Existing assignment', self.type_id)]
        if self.created and self.confirm and not self.editing: entries.append(('99', self.title, self.type_id))
        for ass_id,title,type_id in entries:
            type_name = 'Team Upload' if type_id == 4 else 'Upload'
            html += f'''<tr><td><input name="id[]" value="{ass_id}"></td>
              <td><a href="{escape(self.url('editAssignment', ass_id=ass_id))}">{escape(title)}</a></td>
              <td>{type_name}</td><td><input name="order[{ass_id}]" value="10"></td></tr>'''
        return html + '</tbody></table></form>'

    def handle(self, request):
        self.requests.append(request)
        query = parse_qs(request.url.query.decode())
        if query.get('cmdClass') == ['ilResourceCollectionGUI']:
            return httpx.Response(200, text='<p>No instruction files</p>')
        if request.method == 'GET':
            if query['cmd'] == ['listAssignments']:
                return httpx.Response(200, text=self.listing())
            assert query['cmd'] == ['editAssignment']
            ass_id = query['ass_id'][0]
            return httpx.Response(200, text=editor_form(self.type_id, ass_id, self.title if self.created else 'Existing assignment'))
        if request.headers['content-type'].startswith('multipart/'):
            fields = {key: value.decode() for key,value in multipart(request).items()}
        else:
            fields = {key: value[0] for key,value in parse_qs(request.content.decode(), keep_blank_values=True).items()}
        self.posts.append((request, fields))
        if 'cmd[addAssignment]' in fields or query.get('fallbackCmd') == ['addAssignment']:
            assert query['fallbackCmd'] == ['addAssignment']
            assert fields['type'] == str(self.type_id)
            return httpx.Response(200, text=editor_form(self.type_id), headers={'Set-Cookie':'fresh-form=yes; Path=/'})
        assert 'cmd[updateAssignment]' in fields if self.editing else 'cmd[saveAssignment]' in fields
        if not self.editing: assert 'fresh-form=yes' in request.headers.get('cookie', '')
        assert fields['type'] == str(self.type_id)
        assert fields['ilfilehash'] == 'fixture-file-hash'
        assert fields['title'] == self.title
        if self.type_id == 4: assert fields['team_creator'] == '0'
        assert 'rmd_submit_template_id' not in fields and 'fb_date' not in fields
        assert request.headers['content-type'].startswith('multipart/form-data')
        uploads = upload_parts(request)
        # Both native file validators run, including the unchecked sample
        # solution subform; absent $_FILES causes the bogus max-size errors.
        assert set(uploads) == {'files[0]', 'fb_file'}
        assert all(part.get_filename() == '' and part.get_payload(decode=True) == b'' for part in uploads.values())
        self.created = True
        return httpx.Response(self.save_status, text=self.post_error or '<p>Saved</p>')

    async def save(self, **changes):
        values = dict(title=self.title, type_id=self.type_id, deadline='2030-12-31T23:59', ass_id='10' if self.editing else None)
        values.update(changes)
        return await self.client.save_ta_assignment(self.ref, SaveTAAssignmentRequest(**values))


class NativeMarkupScenario(CreationScenario):
    """Use the real list/toolbar structure rather than the older simplified mock."""
    def listing(self):
        soup = BeautifulSoup(NATIVE_LIST.replace('3114495', self.ref), 'lxml')
        if self.created and self.confirm:
            row = soup.select_one('input[name="id[]"]').find_parent('tr')
            clone = BeautifulSoup(str(row), 'html.parser').find('tr')
            clone.select_one('input[name="id[]"]')['value'] = '99'
            clone.find_all('td', recursive=False)[1].string = self.title
            clone.find_all('td', recursive=False)[2].string = 'Team Upload'
            order = clone.select_one('input[name^="order["]')
            order['name'] = 'order[99]'
            clone.select_one('a[href*="editAssignment"]')['href'] = self.url('editAssignment', ass_id='99')
            row.find_parent('tbody').append(clone)
        return str(soup)


def test_native_list_uses_assignment_table_after_layout_table_and_unnamed_toolbar():
    parsed = parse_ta_assignments_list(NATIVE_LIST, '3114495')
    assert len(parsed.assignments) == 12
    assert parsed.assignments[0].ass_id == '39067'
    assert parsed.assignments[0].edit_url
    assert parse_qs(httpx.URL(parsed.add_action_url).query.decode())['fallbackCmd'] == ['addAssignment']
    assert parsed.add_submit_command is None
    assert parsed.available_types[4] == 'Team Upload'


def test_native_list_accepts_case_insensitive_controller_query():
    html = NATIVE_LIST.replace('ilExAssignmentEditorGUI', 'ilexassignmenteditorgui')
    parsed = parse_ta_assignments_list(html, '3114495')
    assert len(parsed.assignments) == 12 and parsed.add_action_url


def test_recognized_empty_assignment_table_is_still_a_valid_list():
    soup = BeautifulSoup(NATIVE_LIST, 'lxml')
    table = soup.select_one('input[name="id[]"]').find_parent('table')
    table.find('tbody').clear()
    parsed = parse_ta_assignments_list(str(soup), '3114495')
    assert parsed.assignments == [] and parsed.add_action_url


def test_unrecognized_page_is_not_reported_as_an_empty_assignment_list(monkeypatch):
    monkeypatch.setattr('backend.scrapers.dumper.dump_failed_html', lambda *args, **kwargs: None)
    html = '<html><table class="table-striped"><tr><td>Unrelated table</td></tr></table></html>'
    with pytest.raises(ScrapingParsingError) as error:
        parse_ta_assignments_list(html, '3114495')
    assert error.value.context == 'ta_assignments_list'


@pytest.mark.asyncio
async def test_creation_uses_unnamed_native_toolbar_fallback_command():
    scenario = NativeMarkupScenario()
    saved = await scenario.save()
    assert saved.ass_id == '99'
    assert len(scenario.posts) == 2
    assert scenario.posts[0][1] == {'type': '4'}


def test_management_endpoint_returns_the_twelve_native_assignments():
    scenario = NativeMarkupScenario()
    app.dependency_overrides[get_ilias_client] = lambda: scenario.client
    try:
        result = TestClient(app).get(f'/api/exercises/{scenario.ref}/ta/assignments')
        assert result.status_code == 200
        assert len(result.json()['assignments']) == 12
        assert result.json()['available_types']['4'] == 'Team Upload'
        assert scenario.posts == []
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)


@pytest.mark.asyncio
@pytest.mark.parametrize('type_id', [1,4])
async def test_create_uses_native_defaults_fresh_tokens_and_exact_new_id(type_id):
    scenario = CreationScenario(type_id)
    result = await scenario.save()
    assert result.ass_id == '99' and result.type_id == type_id
    assert scenario.manager.get_http_client.call_count == 1
    assert len(scenario.posts) == 2
    action = scenario.posts[-1][0]
    assert parse_qs(action.url.query.decode())['ass_type'] == [str(type_id)]
    assert parse_qs(action.url.query.decode())['rtoken'] == ['a'*64]


@pytest.mark.asyncio
async def test_update_never_uses_the_creation_command():
    scenario = CreationScenario(editing=True)
    result = await scenario.save()
    assert result.ass_id == '10'
    assert len(scenario.posts) == 1
    assert 'cmd[updateAssignment]' in scenario.posts[0][1]


@pytest.mark.asyncio
async def test_same_title_existing_assignment_is_not_a_creation_confirmation():
    scenario = CreationScenario()
    scenario.confirm = False
    with pytest.raises(ValueError, match='bestätigt|confirmed'):
        await scenario.save()
    assert not any(parse_qs(request.url.query.decode()).get('cmd') == ['editAssignment'] for request in scenario.requests)


@pytest.mark.asyncio
async def test_native_validation_rejection_returns_only_real_errors(monkeypatch):
    dump = MagicMock()
    monkeypatch.setattr(import_module('backend.services.ilias_client'), 'dump_failed_html', dump)
    scenario = CreationScenario()
    scenario.post_error = '<div class="alert-danger">Invalid date</div><p class="help-block">Maximum upload size: 953.7 MB</p>'
    with pytest.raises(ValueError, match='Invalid date') as error:
        await scenario.save()
    assert '953.7' not in str(error.value)
    dump.assert_called_once()
    assert dump.call_args.args == (scenario.post_error, 'ta_assignment_save')
    assert 'ilfilehash' in dump.call_args.kwargs['extra_info']['field_names']
    assert 'fixture-file-hash' not in str(dump.call_args.kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize('values', [
    {'title':''}, {'title':'x'*201}, {'deadline':None}, {'deadline':'not a date'},
    {'deadline_mode':1}, {'start_time':'2031-01-01T00:00'},
    {'has_grace_period':True,'deadline2':None},
    {'has_grace_period':True,'deadline2':'2029-01-01T00:00'},
    {'max_file_enabled':True,'max_file':0},
])
async def test_invalid_draft_is_rejected_before_any_ilias_requests(values):
    scenario = CreationScenario()
    with pytest.raises(ValueError):
        await scenario.save(**values)
    assert scenario.requests == []


@pytest.mark.asyncio
async def test_existing_assignment_type_change_cannot_create_a_duplicate():
    scenario = CreationScenario(editing=True)
    with pytest.raises(ValueError):
        await scenario.save(type_id=1)
    assert scenario.posts == []


def test_list_parser_separates_creation_toolbar_from_ordering_form():
    scenario = CreationScenario()
    result = parse_ta_assignments_list(scenario.listing(), scenario.ref)
    assert 'fallbackCmd=addAssignment' in result.add_action_url
    assert 'fallbackCmd' not in result.form_action_url
    assert set(result.available_types) == {1,3,4,5,6}


def test_expired_session_remains_a_401_instead_of_generic_500():
    client = MagicMock()
    client.save_ta_assignment = AsyncMock(side_effect=SessionExpiredError('Expired'))
    app.dependency_overrides[get_ilias_client] = lambda: client
    try:
        result = TestClient(app).post('/api/exercises/2978156/ta/assignment-detail', json={'title':'Test'})
        assert result.status_code == 401
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
