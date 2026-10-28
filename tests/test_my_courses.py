from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.scrapers.dashboard import parse_my_courses
from backend.services.ilias_client import IliasClient


FIXTURE = Path(__file__).parent / 'fixtures/unibe/unibe_my_courses.html'


def test_saved_memberships_preserve_types_semesters_and_native_favourites():
    courses = parse_my_courses(FIXTURE.read_text(encoding='utf-8'))
    assert len(courses) == 64
    assert len({course.ref_id for course in courses}) == 64
    assert sum(course.item_type == 'grp' for course in courses) == 4
    by_id = {course.ref_id: course for course in courses}
    assert by_id['3419492'].item_type == 'crs'
    assert by_id['3419492'].semester == 'FS2026'
    assert by_id['3684711'].semester == 'HS2026'
    assert by_id['1098039'].is_favourite
    assert not by_id['3419492'].is_favourite
    assert by_id['1098039'].semester is None


def test_notifications_and_bulk_confirmation_are_excluded():
    item = '<div class="il-item"><h4 class="il-item-title"><a href="/go/crs/42">Course HS2026</a></h4></div>'
    html = item.replace('42', '99') + '<main>' + item + '<div role="dialog">' + item.replace('42', '100') + '</div></main>'
    assert [course.ref_id for course in parse_my_courses(html)] == ['42']


@pytest.mark.asyncio
async def test_memberships_endpoint_fetches_all_memberships_not_selected_desktop_items():
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, text='<span class="il-avatar-initials">TS</span>'
                              + FIXTURE.read_text(encoding='utf-8') + '<p>Kein Zugriffsrecht</p>')
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    client = IliasClient(manager)
    # Saved page contains authenticated navigation, and its closed-course notices
    # must not be interpreted as global session loss.
    result = await client.get_my_courses()
    assert len(result.courses) == 64
    assert requests[0].url.params['baseClass'] == 'ilmembershipoverviewgui'

    app.dependency_overrides[get_ilias_client] = lambda: client
    try:
        with TestClient(app) as api:
            response = api.get('/api/dashboard/memberships')
            assert response.status_code == 200
            assert len(response.json()['courses']) == 64
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
