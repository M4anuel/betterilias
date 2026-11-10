"""Tests for pointer cursor consistency, accurate folder preview breakdown, course content tree, and assignment quick-links."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api


def test_cursor_pointer_rules_present_in_css_and_components():
    css = (ROOT / 'frontend' / 'src' / 'index.css').read_text(encoding='utf-8')
    assert 'button:not(:disabled)' in css
    assert 'cursor: pointer;' in css

    breadcrumbs = (ROOT / 'frontend' / 'src' / 'components' / 'CompactBreadcrumbs.tsx').read_text(encoding='utf-8')
    assert 'cursor-pointer' in breadcrumbs
    assert 'disabled:cursor-default' in breadcrumbs

    sidebar = (ROOT / 'frontend' / 'src' / 'components' / 'Sidebar.tsx').read_text(encoding='utf-8')
    assert 'data-sidebar-assignment-link' in sidebar
    assert 'cursor-pointer' in sidebar


def test_course_tree_and_folder_stats_logic():
    """Verify folder item categorization and assignment quick-link resolution rules."""
    course_tree_src = (ROOT / 'frontend' / 'src' / 'lib' / 'courseTree.ts').read_text(encoding='utf-8')
    assert 'export function countFolderItems' in course_tree_src
    assert 'export function formatFolderStats' in course_tree_src
    assert 'export function resolveCourseAssignmentTarget' in course_tree_src
    assert 'export function upsertCourseTreeContainer' in course_tree_src


@pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')
def test_folder_preview_and_assignment_quicklinks_in_browser(local_site):
    pw = pytest.importorskip('playwright.sync_api')

    courses = [
        {
            'ref_id': '100',
            'title': '1001: Single Assignment Course',
            'item_type': 'crs',
            'url': 'https://ilias.unibe.ch/goto.php?target=crs_100',
            'semester': 'HS2026',
            'subject': 'Informatik',
        },
        {
            'ref_id': '200',
            'title': '2002: Bundled Assignments Course',
            'item_type': 'crs',
            'url': 'https://ilias.unibe.ch/goto.php?target=crs_200',
            'semester': 'HS2026',
            'subject': 'Informatik',
        },
        {
            'ref_id': '300',
            'title': '3003: Scattered Assignments Course',
            'item_type': 'crs',
            'url': 'https://ilias.unibe.ch/goto.php?target=crs_300',
            'semester': 'HS2026',
            'subject': 'Informatik',
        },
    ]

    materials_by_ref = {
        '100': {
            'container_ref_id': '100',
            'title': '1001: Single Assignment Course',
            'breadcrumbs': [{'title': 'HS 2026', 'ref_id': '10'}, {'title': '1001: Single Assignment Course', 'ref_id': '100'}],
            'items': [
                {'ref_id': '101', 'title': 'Mixed Folder', 'item_type': 'fold', 'url': 'https://ilias.unibe.ch/goto.php?target=fold_101', 'properties': {}},
                {'ref_id': '102', 'title': 'Exercise Series', 'item_type': 'exc', 'url': 'https://ilias.unibe.ch/goto.php?target=exc_102', 'properties': {}},
            ],
            'sections': [],
            'blocks': [
                {
                    'id': 'b-100',
                    'block_type': 'items',
                    'title': 'Inhalte',
                    'items': [
                        {'ref_id': '101', 'title': 'Mixed Folder', 'item_type': 'fold', 'url': 'https://ilias.unibe.ch/goto.php?target=fold_101', 'properties': {}},
                        {'ref_id': '102', 'title': 'Exercise Series', 'item_type': 'exc', 'url': 'https://ilias.unibe.ch/goto.php?target=exc_102', 'properties': {}},
                    ],
                }
            ],
            'fetched_at': '2026-11-10T12:00:00Z',
        },
        '101': {
            'container_ref_id': '101',
            'title': 'Mixed Folder',
            'breadcrumbs': [
                {'title': 'HS 2026', 'ref_id': '10'},
                {'title': '1001: Single Assignment Course', 'ref_id': '100'},
                {'title': 'Mixed Folder', 'ref_id': '101'},
            ],
            'items': [
                {'ref_id': '1011', 'title': 'Course Forum', 'item_type': 'frm', 'url': 'https://ilias.unibe.ch/goto.php?target=frm_1011', 'properties': {}},
                {'ref_id': '1012', 'title': 'Slides.pdf', 'item_type': 'file', 'url': 'https://ilias.unibe.ch/goto.php?target=file_1012', 'properties': {}},
            ],
            'sections': [],
            'blocks': [],
            'fetched_at': '2026-11-10T12:00:00Z',
        },
    }

    def handle_route(route):
        path = urlparse(route.request.url).path
        if path.endswith('/semesters'):
            route.fulfill(
                content_type='application/json',
                body=json.dumps({
                    'active_semester': 'HS2026',
                    'available_semesters': [],
                    'courses': courses,
                    'grouped_by_category': {'Informatik': courses},
                    'fetched_at': '2026-11-10T12:00:00Z',
                }),
            )
            return
        for ref_id, payload in materials_by_ref.items():
            if path.endswith(f'/courses/{ref_id}/materials') or path.endswith(f'/materials/{ref_id}'):
                route.fulfill(content_type='application/json', body=json.dumps(payload))
                return
        if path.endswith('/exercises/102'):
            route.fulfill(
                content_type='application/json',
                body=json.dumps({
                    'ref_id': '102',
                    'title': 'Exercise Series',
                    'assignments': [],
                    'is_tutor': False,
                    'fetched_at': '2026-11-10T12:00:00Z',
                }),
            )
            return
        mock_api(route)

    # Seed course trees for 200 (2 exercises in same folder 210) and 300 (2 exercises in different folders)
    tree_200 = {
        'course_ref_id': '200',
        'course_title': '2002: Bundled Assignments Course',
        'root_ref_id': '200',
        'max_depth_scanned': 2,
        'updated_at': '2026-11-10T12:00:00Z',
        'nodes': {
            '200': {'ref_id': '200', 'title': '2002: Bundled Assignments Course', 'item_type': 'crs', 'url': '', 'parent_ref_id': None, 'depth': 0, 'path': ['2002'], 'path_ref_ids': ['200'], 'children_ref_ids': ['210']},
            '210': {'ref_id': '210', 'title': 'All Assignments Folder', 'item_type': 'fold', 'url': '', 'parent_ref_id': '200', 'depth': 1, 'path': ['2002', 'All Assignments Folder'], 'path_ref_ids': ['200', '210'], 'children_ref_ids': ['211', '212']},
            '211': {'ref_id': '211', 'title': 'Sheet 1', 'item_type': 'exc', 'url': '', 'parent_ref_id': '210', 'depth': 2, 'path': ['2002', 'All Assignments Folder', 'Sheet 1'], 'path_ref_ids': ['200', '210', '211'], 'children_ref_ids': []},
            '212': {'ref_id': '212', 'title': 'Sheet 2', 'item_type': 'exc', 'url': '', 'parent_ref_id': '210', 'depth': 2, 'path': ['2002', 'All Assignments Folder', 'Sheet 2'], 'path_ref_ids': ['200', '210', '212'], 'children_ref_ids': []},
        },
    }
    tree_300 = {
        'course_ref_id': '300',
        'course_title': '3003: Scattered Assignments Course',
        'root_ref_id': '300',
        'max_depth_scanned': 2,
        'updated_at': '2026-11-10T12:00:00Z',
        'nodes': {
            '300': {'ref_id': '300', 'title': '3003: Scattered Assignments Course', 'item_type': 'crs', 'url': '', 'parent_ref_id': None, 'depth': 0, 'path': ['3003'], 'path_ref_ids': ['300'], 'children_ref_ids': ['310', '320']},
            '310': {'ref_id': '310', 'title': 'Folder A', 'item_type': 'fold', 'url': '', 'parent_ref_id': '300', 'depth': 1, 'path': ['3003', 'Folder A'], 'path_ref_ids': ['300', '310'], 'children_ref_ids': ['311']},
            '311': {'ref_id': '311', 'title': 'Exercise A', 'item_type': 'exc', 'url': '', 'parent_ref_id': '310', 'depth': 2, 'path': ['3003', 'Folder A', 'Exercise A'], 'path_ref_ids': ['300', '310', '311'], 'children_ref_ids': []},
            '320': {'ref_id': '320', 'title': 'Folder B', 'item_type': 'fold', 'url': '', 'parent_ref_id': '300', 'depth': 1, 'path': ['3003', 'Folder B'], 'path_ref_ids': ['300', '320'], 'children_ref_ids': ['321']},
            '321': {'ref_id': '321', 'title': 'Exercise B', 'item_type': 'exc', 'url': '', 'parent_ref_id': '320', 'depth': 2, 'path': ['3003', 'Folder B', 'Exercise B'], 'path_ref_ids': ['300', '320', '321'], 'children_ref_ids': []},
        },
    }

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.add_init_script(f"""
            localStorage.setItem('betterilias_visited', '1');
            localStorage.setItem('betterilias_language', 'de');
            localStorage.setItem('ilias_course_tree_200', {json.dumps(json.dumps(tree_200))});
            localStorage.setItem('ilias_course_tree_300', {json.dumps(json.dumps(tree_300))});
        """)
        page.route('**/api/**', handle_route)
        page.goto(local_site + '/?semester=HS2026')

        # Course 200 has quick-link to folder 210; Course 300 has NO quick-link
        pw.expect(page.locator('[data-sidebar-assignment-link="200"]')).to_be_visible()
        pw.expect(page.locator('[data-overview-assignment-link="200"]')).to_be_visible()
        pw.expect(page.locator('[data-sidebar-assignment-link="300"]')).to_have_count(0)
        pw.expect(page.locator('[data-overview-assignment-link="300"]')).to_have_count(0)

        # Open Course 100 to trigger tree building & folder preview
        page.get_by_role('button', name='Single Assignment Course').first.click()
        pw.expect(page.get_by_text('1 Datei, 1 Forum')).to_be_visible()

        # Now Course 100 also has its assignment quick-link in the sidebar!
        pw.expect(page.locator('[data-sidebar-assignment-link="100"]')).to_be_visible()

        # Check pointer cursor on breadcrumbs and sidebar buttons
        crumb_cursor = page.locator('nav[aria-label="Navigationspfad"] button:not(:disabled)').first.evaluate(
            'el => getComputedStyle(el).cursor'
        )
        assert crumb_cursor == 'pointer'

        edit_cursor = page.get_by_role('button', name='Vorlesungen anpassen', exact=True).evaluate(
            'el => getComputedStyle(el).cursor'
        )
        assert edit_cursor == 'pointer'

        browser.close()
