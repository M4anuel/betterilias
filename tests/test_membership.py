from unittest.mock import MagicMock
from urllib.parse import parse_qs

import httpx
import pytest
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.schemas import MembershipRequest
from backend.scrapers.membership import parse_membership, prepare_membership_form
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.repository import parse_repository
from backend.services.ilias_client import IliasClient


JOIN_LINK = '<a href="ilias.php?baseClass=ilrepositorygui&cmd=join&ref_id=42">Join</a>'
LEAVE_LINK = '<a href="ilias.php?baseClass=ilrepositorygui&cmd=unsubscribe&ref_id=42">Unsubscribe</a>'
JOIN_FORM = '''<form action="ilias.php?baseClass=ilrepositorygui&cmdClass=ilCourseRegistrationGUI&cmd=post&ref_id=42&rtoken=fresh-test-token" method="post">
  <div class="form-group">Registration Type: You can join this course directly.</div>
  <input type="hidden" name="csrf" value="server-value">
  <label for="course-password">Course password</label><input id="course-password" name="course_password" type="password" required>
  <label for="terms">Agree</label><input id="terms" name="terms" type="checkbox" value="yes" required>
  <input type="submit" name="cmd[join]" value="Join">
  <input type="submit" name="cmd[cancel]" value="Cancel">
</form>'''
LEAVE_FORM = '''<form action="ilias.php?baseClass=ilrepositorygui&cmdClass=ilObjCourseGUI&cmd=post&ref_id=42&rtoken=leave-test-token" method="post">
  <input type="hidden" name="csrf" value="leave-server-value">
  <input type="submit" name="cmd[performUnsubscribe]" value="Unsubscribe from Course">
  <input type="submit" name="cmd[cancel]" value="Cancel">
</form>'''


def service(handler):
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return IliasClient(manager)


def test_only_actions_for_the_requested_course_are_offered():
    soup = BeautifulSoup(JOIN_LINK + LEAVE_LINK.replace('42', '43'), 'lxml')
    state = parse_membership(soup, '42')
    assert state.can_join and not state.can_leave and state.is_enrolled is False
    managed = parse_membership(BeautifulSoup('<h1>KSL course</h1>', 'lxml'), '42')
    assert not managed.can_join and not managed.can_leave and managed.is_enrolled is None
    disabled = parse_membership(BeautifulSoup('<button disabled data-action="ilias.php?cmd=join&ref_id=42">Join</button>', 'lxml'), '42')
    assert not disabled.can_join


def test_form_uses_real_hidden_fields_and_separates_cancel():
    form = prepare_membership_form(JOIN_FORM, '42', 'join')
    assert form.payload == {'csrf': 'server-value', 'cmd[join]': 'Join'}
    assert [(f.name, f.field_type, f.required) for f in form.fields] == [('course_password', 'password', True), ('terms', 'checkbox', True)]
    assert 'directly' in form.message
    assert prepare_membership_form(JOIN_FORM, '43', 'join') is None
    leave = prepare_membership_form('<div class="alert alert-warning">-confirmation_message- Are you sure?</div>' + LEAVE_FORM, '42', 'leave')
    assert leave.message == 'Are you sure?'


def test_special_registration_forms_fall_back_to_ilias():
    html = JOIN_FORM.replace('<input type="hidden"', '<select name="registration_type"><option>Other</option></select><input type="hidden"', 1)
    assert not prepare_membership_form(html, '42', 'join').supported


def test_registration_is_not_embedded_as_native_course_content():
    page = parse_course_materials(f'<h1>Course</h1><main>{JOIN_FORM}</main>', '42')
    assert page.membership.can_join and page.is_enrolled is False
    assert all('<form' not in (block.html_content or '') for block in page.blocks)


def test_repository_offers_join_even_when_course_content_is_locked():
    html = f'''<div id="il_center_col"><div class="ilContainerListItemOuter" id="lg_div_42_pref_13">
      <img alt="Course"><h3 class="il_ContainerItemTitle">Voluntary course</h3>{JOIN_LINK}
    </div></div>'''
    item = parse_repository(html, '13').items[0]
    assert not item.accessible and item.membership.can_join


@pytest.mark.asyncio
async def test_join_gets_fresh_form_then_posts_and_verifies_membership():
    requests = []
    posted = False

    def handler(request):
        nonlocal posted
        requests.append(request)
        params = parse_qs(request.url.query.decode())
        if request.method == 'POST':
            payload = parse_qs(request.content.decode())
            assert payload == {'csrf': ['server-value'], 'cmd[join]': ['Join'], 'course_password': ['provided-password'], 'terms': ['yes']}
            assert params['rtoken'] == ['fresh-test-token']
            posted = True
            return httpx.Response(200, text='<div class="alert-success">You joined the course.</div>')
        return httpx.Response(200, text=JOIN_FORM if params.get('cmd') == ['join'] else LEAVE_LINK if posted else JOIN_LINK)

    client = service(handler)
    form = await client.get_membership_form('42', 'join')
    assert form.available and all(r.method == 'GET' for r in requests)
    result = await client.change_course_membership('42', MembershipRequest(action='join', values={'course_password': 'provided-password', 'terms': 'yes'}))
    assert result.success and result.is_enrolled is True
    assert len([r for r in requests if r.method == 'POST']) == 1


@pytest.mark.asyncio
async def test_leave_uses_ilias_confirmation_command():
    posted = False

    def handler(request):
        nonlocal posted
        assert not posted, 'A confirmed leave must not read a now-protected course again'
        if request.method == 'POST':
            assert parse_qs(request.content.decode()) == {'csrf': ['leave-server-value'], 'cmd[performUnsubscribe]': ['Unsubscribe from Course']}
            posted = True
            return httpx.Response(200, text='<div class="alert-success">Unsubscribed.</div>')
        cmd = parse_qs(request.url.query.decode()).get('cmd')
        return httpx.Response(200, text=LEAVE_FORM if cmd == ['unsubscribe'] else JOIN_LINK if posted else LEAVE_LINK)

    result = await service(handler).change_course_membership('42', MembershipRequest(action='leave'))
    assert result.success and result.is_enrolled is False


@pytest.mark.asyncio
async def test_no_post_when_ksl_controls_membership():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, text='<h1>Managed course</h1>')

    with pytest.raises(ValueError, match='KSL'):
        await service(handler).change_course_membership('42', MembershipRequest(action='leave'))
    assert all(r.method == 'GET' for r in requests)


@pytest.mark.asyncio
@pytest.mark.parametrize('values', [{}, {'course_password': 'x', 'terms': 'yes', 'csrf': 'forged'}, {'course_password': 'x'}])
async def test_missing_or_forged_fields_never_post(values):
    def handler(request):
        assert request.method == 'GET'
        return httpx.Response(200, text=JOIN_FORM)

    with pytest.raises(ValueError):
        await service(handler).change_course_membership('42', MembershipRequest(action='join', values=values))


@pytest.mark.asyncio
async def test_join_can_be_discovered_in_parent_category():
    empty = '<nav class="breadcrumb-wrapper"><ol><li><a href="/go/cat/13">Lectures</a></li></ol></nav><h1>Course</h1>'

    def handler(request):
        params = parse_qs(request.url.query.decode())
        if params.get('ref_id') == ['13']:
            return httpx.Response(200, text=JOIN_LINK)
        return httpx.Response(200, text=JOIN_FORM if params.get('cmd') == ['join'] else empty)

    assert (await service(handler).get_membership_form('42', 'join')).available


@pytest.mark.asyncio
async def test_failed_post_is_reported_without_claiming_success():
    def handler(request):
        return httpx.Response(200, text='<div class="alert-danger">Wrong password</div>' if request.method == 'POST' else JOIN_FORM)

    with pytest.raises(ValueError, match='Wrong password'):
        await service(handler).change_course_membership('42', MembershipRequest(action='join', values={'course_password': 'x', 'terms': 'yes'}))


@pytest.mark.asyncio
async def test_cross_origin_form_is_rejected():
    def handler(request):
        return httpx.Response(200, text=JOIN_FORM.replace('action="ilias.php', 'action="https://example.com/ilias.php'))

    with pytest.raises(ValueError, match='Kursziel'):
        await service(handler).get_membership_form('42', 'join')


def test_membership_api_rejects_unknown_actions_and_unavailable_changes():
    from unittest.mock import AsyncMock
    mock = AsyncMock()
    mock.change_course_membership.side_effect = ValueError('Not allowed')
    app.dependency_overrides[get_ilias_client] = lambda: mock
    try:
        client = TestClient(app)
        assert client.get('/api/courses/42/membership?action=delete').status_code == 422
        assert client.post('/api/courses/42/membership', json={'action': 'leave', 'values': {}}).status_code == 400
        assert client.post('/api/courses/42/membership', json={'action': 'delete'}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
