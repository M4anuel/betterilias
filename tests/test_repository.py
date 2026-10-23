"""Repository layouts reduced from the Uni Bern reference pages."""
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.main import app
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.repository import parse_repository


def test_repository_cards_and_breadcrumb_order():
    result = parse_repository('''
      <h1 class="il-page-content-header">Repository</h1>
      <nav class="breadcrumb-wrapper"><div dir="rtl">
        <span class="breadcrumb-crumb"><a href="/go/cat/425698">Faculty</a></span>
        <span class="breadcrumb-crumb"><a href="/go/root/1">Repository</a></span>
      </div></nav>
      <div id="il_center_col"><div class="il-card thumbnail">
        <img alt="Category" src="icon_custom.svg">
        <div class="dropdown"><button data-action="ilias.php?ref_id=1&item_ref_id=425698&cmd=addToDesk">Favourite</button></div>
        <div class="il-card-image-container"><a href="/go/cat/425698"><img></a></div>
        <div class="caption card-title"><a href="/go/cat/425698">Faculty<span data-list-item-id="lg_div_425698_pref_-1"></span></a></div>
      </div></div>
      <aside><div class="il-card"><div class="card-title"><a href="/go/cat/99">Not content</a></div></div></aside>
    ''', '1')
    assert [b.ref_id for b in result.breadcrumbs] == ['1', '425698']
    assert [(i.ref_id, i.title, i.item_type) for i in result.items] == [('425698', 'Faculty', 'cat')]
    assert result.items[0].accessible


def test_repository_lists_keep_locked_courses_without_using_info_actions():
    result = parse_repository('''<h1>Vorlesung</h1><div id="il_center_col">
      <div class="ilContainerListItemOuter" id="lg_div_3120833_pref_3120832">
        <img alt="Course" src="icon_custom.svg">
        <div class="il_ContainerItemTitle"><h3 class="il_ContainerItemTitle">Locked course</h3></div>
        <button data-action="ilias.php?cmd=infoScreen&ref_id=3120833">Info</button>
      </div>
      <div class="ilContainerListItemOuter"><img alt="Course">
        <h3 class="il_ContainerItemTitle"><a href="/go/crs/3695526">Open course</a></h3>
      </div>
      <div class="ilContainerListItemOuter"><img alt="Category">
        <h3 class="il_ContainerItemTitle"><a href="/go/cat/1579665">FS2020</a></h3>
      </div>
    </div>''', '3120832')
    assert len(result.items) == 3
    locked, course, semester = result.items
    assert (locked.ref_id, locked.item_type, locked.accessible, locked.url) == ('3120833', 'crs', False, '')
    assert (course.ref_id, course.item_type, course.accessible) == ('3695526', 'crs', True)
    assert (semester.title, semester.item_type) == ('FS2020', 'cat')


def test_enrollment_requires_membership_evidence():
    enrolled = parse_course_materials('<h1>Course</h1><a href="ilias.php?cmd=unsubscribe&ref_id=42">Unsubscribe</a>', '42')
    preview = parse_course_materials('<h1>Course</h1><button data-action="ilias.php?cmd=join&ref_id=42">Join</button>', '42')
    assert enrolled.is_enrolled is True
    assert preview.is_enrolled is None


def test_repository_api_and_reference_validation():
    service = AsyncMock()
    service.get_repository.return_value = parse_repository('<h1>Repository</h1><div id="il_center_col"></div>', '1')
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        client = TestClient(app)
        response = client.get('/api/repository/1')
        assert response.status_code == 200
        assert response.json()['title'] == 'Repository'
        service.get_repository.assert_awaited_once_with('1')
        assert client.get('/api/repository/not-an-id').status_code == 422
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
