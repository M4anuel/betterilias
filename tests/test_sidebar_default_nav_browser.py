"""Tests for hideable default sidebar navigation entries and collapsed sidebar geometry."""
import json
import os
from urllib.parse import urlparse
import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


def make_courses(count=3):
    return [
        dict(ref_id=str(100 + i), title=f'Course {i}: Computer Science', item_type='crs', url='', semester='HS2026', subject='Informatik')
        for i in range(count)
    ]


def setup_mock(page, courses):
    def route_handler(route):
        if urlparse(route.request.url).path.endswith('/semesters'):
            route.fulfill(content_type='application/json', body=json.dumps(dict(
                active_semester='HS2026',
                available_semesters=[],
                courses=courses,
                grouped_by_category={'Informatik': courses}
            )))
        else:
            mock_api(route)
    page.route('**/api/**', route_handler)


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
@pytest.mark.parametrize('width', [390, 1280])
def test_hide_and_show_default_sidebar_nav_entries(local_site, language, scheme, width):
    pw = pytest.importorskip('playwright.sync_api')
    catalogue = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8'))
    def tr(key, **values):
        text = catalogue[key]
        for k, v in values.items():
            text = text.replace('{' + k + '}', str(v))
        return text

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=800), color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        setup_mock(page, make_courses(3))
        page.goto(local_site + '/?semester=HS2026')

        if width < 1024:
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()

        sidebar = page.locator('aside:visible')
        nav = sidebar.locator('nav')

        # Initially all default navigation entries exist
        overview_name = tr('Semester-Übersicht')
        calendar_name = tr('calendar.sidebar_nav')
        my_courses_name = tr('my_courses.title')
        repository_name = tr('Magazin')
        board_name = tr('requests.title')

        pw.expect(nav.get_by_role('button', name=overview_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=calendar_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=my_courses_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=repository_name, exact=True)).to_be_visible()

        # Open customize courses modal
        sidebar.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        modal = page.locator('.app-overlay')
        pw.expect(modal).to_be_visible()
        pw.expect(modal.get_by_text(tr('sidebar.default_nav_title'), exact=True)).to_be_visible()

        # Hide calendar and repository
        hide_cal = modal.get_by_role('button', name=tr('sidebar.hide_entry', name=calendar_name), exact=True)
        hide_repo = modal.get_by_role('button', name=tr('sidebar.hide_entry', name=repository_name), exact=True)
        assert hide_cal.bounding_box()['width'] >= 44
        assert hide_cal.bounding_box()['height'] >= 44

        hide_cal.click()
        hide_repo.click()
        modal.get_by_role('button', name=tr('sidebar.hide_entry', name=board_name), exact=True).click()

        # Save changes
        modal.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        pw.expect(modal).to_have_count(0)

        if width < 1024:
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()

        # In sidebar, calendar and repository are now hidden, while overview and my_courses remain
        pw.expect(nav.get_by_role('button', name=overview_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=my_courses_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=calendar_name, exact=True)).to_have_count(0)
        pw.expect(nav.get_by_role('button', name=repository_name, exact=True)).to_have_count(0)

        # Verify persisted in localStorage
        stored_hidden = page.evaluate("localStorage.getItem('ilias_hidden_sidebar_nav')")
        assert 'calendar' in stored_hidden and 'repository' in stored_hidden and 'feature_requests' in stored_hidden
        pw.expect(nav.get_by_role('button', name=board_name, exact=True)).to_have_count(0)

        # Open customize modal again and hide all 4 entries
        sidebar.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        pw.expect(modal).to_be_visible()
        modal.get_by_role('button', name=tr('sidebar.hide_entry', name=overview_name), exact=True).click()
        modal.get_by_role('button', name=tr('sidebar.hide_entry', name=my_courses_name), exact=True).click()
        modal.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        pw.expect(modal).to_have_count(0)

        if width < 1024:
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()

        # All 4 are hidden
        pw.expect(nav.get_by_role('button', name=overview_name, exact=True)).to_have_count(0)
        pw.expect(nav.get_by_role('button', name=calendar_name, exact=True)).to_have_count(0)
        pw.expect(nav.get_by_role('button', name=my_courses_name, exact=True)).to_have_count(0)
        pw.expect(nav.get_by_role('button', name=repository_name, exact=True)).to_have_count(0)

        # Reopen modal and use "Alle einblenden" (Show all) to restore all entries
        sidebar.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        pw.expect(modal).to_be_visible()
        modal.get_by_role('button', name=tr('Alle einblenden'), exact=True).click()
        modal.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        pw.expect(modal).to_have_count(0)

        if width < 1024:
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()

        # All 4 entries are visible again
        pw.expect(nav.get_by_role('button', name=overview_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=calendar_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=my_courses_name, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name=repository_name, exact=True)).to_be_visible()

        pw.expect(nav.get_by_role('button', name=board_name, exact=True)).to_be_visible()
        assert_no_overflow(page)
        browser.close()


def test_collapsed_sidebar_scrollbar_spacing(local_site):
    """Verify collapsed sidebar has visible background bar between icon and scrollbar."""
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=1280, height=500), color_scheme='dark')
        page.add_init_script("localStorage.setItem('betterilias_language', 'de');")
        # 25 courses to force vertical scrolling
        setup_mock(page, make_courses(25))
        page.goto(local_site + '/?semester=HS2026')

        sidebar = page.locator('aside')
        page.wait_for_selector('aside nav button')
        sidebar.get_by_role('button', name='Seitenleiste einklappen', exact=True).click()
        page.wait_for_timeout(300)

        aside_box = sidebar.bounding_box()
        assert abs(aside_box['width'] - 68) <= 1

        # Check button spacing
        button = sidebar.locator('nav button[aria-current="page"]')
        btn_box = button.bounding_box()
        assert abs(btn_box['width'] - 44) <= 1

        # Left margin between button and aside is at least 10px
        left_margin = btn_box['x'] - aside_box['x']
        assert left_margin >= 10

        # Right margin between button and aside right edge is at least 10px
        right_margin = (aside_box['x'] + aside_box['width']) - (btn_box['x'] + btn_box['width'])
        assert right_margin >= 10

        browser.close()


def test_connection_notice_has_close_button_and_dismisses(local_site):
    """Verify that the service connection banner at the bottom has a functional close button and reappears on sync."""
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / 'de.json').read_text(encoding='utf8')).__getitem__

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=1280, height=800))
        page.add_init_script("localStorage.setItem('betterilias_language', 'de');")

        # Initially load successfully
        setup_mock(page, make_courses(2))
        page.goto(local_site + '/?semester=HS2026')

        sync_btn = page.get_by_role('button', name=tr('Übersicht aktualisieren'), exact=True)
        pw.expect(sync_btn).to_be_visible()

        # Route backend failures
        page.route('**/api/dashboard/semesters*', lambda route: route.fulfill(status=503, content_type='application/json', body=json.dumps(dict(detail='Service Unavailable'))))
        sync_btn.click()

        notice = page.locator('[data-connection-notice]')
        pw.expect(notice).to_be_visible()
        pw.expect(notice.get_by_text(tr('connection.unavailable.title'), exact=True)).to_be_visible()

        # Notice has a close (X) button
        close_btn = notice.get_by_role('button', name=tr('Schliessen'), exact=True)
        pw.expect(close_btn).to_be_visible()
        assert close_btn.bounding_box()['width'] >= 44
        assert close_btn.bounding_box()['height'] >= 44

        # Clicking close dismisses the notice banner
        close_btn.click()
        pw.expect(notice).to_have_count(0)

        # When the user reloads with the sync button and backend is still unreachable, the banner reappears
        sync_btn.click()
        pw.expect(notice).to_be_visible()
        pw.expect(notice.get_by_text(tr('connection.unavailable.title'), exact=True)).to_be_visible()

        browser.close()


def test_custom_nav_reorder_nickname_and_icons(local_site):
    """Verify that default nav items can be reordered per-semester, renamed, have custom icons, and lectures can use nav icons."""
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / 'de.json').read_text(encoding='utf8')).__getitem__

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=1280, height=800))
        page.add_init_script("localStorage.setItem('betterilias_language', 'de');")
        setup_mock(page, make_courses(2))
        page.goto(local_site + '/?semester=HS2026')

        sidebar = page.locator('aside:visible')
        nav = sidebar.locator('nav')

        # Open customize modal
        sidebar.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        modal = page.locator('.app-overlay')
        pw.expect(modal).to_be_visible()

        # 1. Check original name remains next to drag handle before and after nickname entry
        overview_card = modal.locator('[data-nav-card="semester"]')
        pw.expect(overview_card.locator('.truncate')).to_have_text('Semester-Übersicht')
        overview_input = overview_card.locator('#nav-nickname-semester')
        pw.expect(overview_input).to_be_visible()
        overview_input.fill('Meine Übersicht')
        # Header next to drag handle still displays the original default title
        pw.expect(overview_card.locator('.truncate')).to_have_text('Semester-Übersicht')

        # 2. Check course card has cleaned original title (without "Course 0: ") next to drag handle
        course_card = modal.locator('[data-course-card="100"]')
        pw.expect(course_card.locator('.sidebar-course-title')).to_have_text('Computer Science')
        course_input = course_card.locator('#course-nickname-100')
        pw.expect(course_input).to_have_attribute('placeholder', 'Computer Science')
        course_input.fill('CS Vorlesung')
        # Even after filling custom nickname, header next to drag handle still displays cleaned original title
        pw.expect(course_card.locator('.sidebar-course-title')).to_have_text('Computer Science')

        # 3. Change overview icon to 'Brain'
        overview_card.get_by_role('button', name=tr('Icon auswählen')).click()
        picker = overview_card.locator('.sidebar-icon-picker')
        pw.expect(picker).to_be_visible()
        picker.get_by_role('button', name=tr('KI & Kognition')).click()

        # 4. Change Course 0's icon to 'Calendar' (testing nav icon available for lectures at the end of the list)
        course_card.get_by_role('button', name=tr('Icon auswählen')).click()
        course_picker = course_card.locator('.sidebar-icon-picker')
        pw.expect(course_picker).to_be_visible()

        # Check navigation icons are positioned at the end of the picker
        picker_buttons = course_picker.locator('button')
        btn_count = picker_buttons.count()
        assert picker_buttons.nth(btn_count - 3).get_attribute('title') == tr('icon.semester_overview')
        assert picker_buttons.nth(btn_count - 2).get_attribute('title') == tr('icon.calendar')
        assert picker_buttons.nth(btn_count - 1).get_attribute('title') == tr('icon.repository')

        course_picker.get_by_role('button', name=tr('icon.calendar')).click()

        # 5. Move "Kalender & Stundenplan" down
        calendar_card = modal.locator('[data-nav-card="calendar"]')
        calendar_down_btn = calendar_card.get_by_role('button', name=tr('Nach unten verschieben'))
        calendar_down_btn.click()
        calendar_down_btn.click()
        calendar_down_btn.click()

        # Save changes
        modal.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        pw.expect(modal).to_have_count(0)

        # In sidebar: "Meine Übersicht" and "CS Vorlesung" are visible
        pw.expect(nav.get_by_role('button', name='Meine Übersicht', exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('button', name='CS Vorlesung', exact=True)).to_be_visible()

        # Verify custom order is saved under HS2026
        saved_order = page.evaluate("localStorage.getItem('ilias_sidebar_order_HS2026')")
        assert saved_order is not None
        order_json = json.loads(saved_order)
        # Verify nav items are in the order array
        nav_items_in_order = [item['id'] for item in order_json if item.get('type') == 'nav']
        assert 'semester' in nav_items_in_order
        assert 'calendar' in nav_items_in_order

        # Verify saved custom nickname and custom icon
        saved_nicknames = json.loads(page.evaluate("localStorage.getItem('ilias_course_nicknames')") or '{}')
        assert saved_nicknames.get('nav_semester') == 'Meine Übersicht'

        saved_icons = json.loads(page.evaluate("localStorage.getItem('ilias_course_icons')") or '{}')
        assert saved_icons.get('nav_semester') == 'Brain'
        assert saved_icons.get('100') == 'Calendar'

        browser.close()
