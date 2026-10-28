"""Mocked Chromium coverage; no physical device or live ILIAS access."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 800), (430, 800), (768, 850), (1280, 900), (740, 360)])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_membership_search_sort_pin_navigation_and_persistence(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    courses = [dict(ref_id='42', title='2414-HS2026-0: Human Computer Interaction', semester='HS2026', item_type='crs'),
               dict(ref_id='43', title='Alpha mathematics', semester='FS2023', item_type='crs'),
               dict(ref_id='44', title='Zebra study group with a longer title for small screens', item_type='grp', is_favourite=True)]
    for course in courses:
        course['url'] = 'https://ilias.unibe.ch/go/' + course['item_type'] + '/' + course['ref_id']
    failure = [False]
    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/memberships'):
            route.fulfill(status=503 if failure[0] else 200, content_type='application/json', body=json.dumps(dict(courses=courses)))
        elif path == '/api/repository/44':
            route.fulfill(status=200, content_type='application/json', body=json.dumps(dict(ref_id='44', title=courses[2]['title'], items=[], breadcrumbs=[])))
        else:
            mock_api(route)

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme, has_touch=width < 768)
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}'); localStorage.setItem('betterilias_theme_mode', '{scheme}');")
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/?semester=HS2026')
        if width < 1024:
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
        page.get_by_role('button', name=tr('my_courses.title'), exact=True).click()
        pw.expect(page).to_have_url(local_site + '/?view=my-courses')
        pw.expect(page.get_by_role('heading', name=tr('my_courses.title'), exact=True)).to_be_visible()
        rows = page.locator('article[data-course-id]')
        pw.expect(rows).to_have_count(3)
        assert rows.first.get_attribute('data-course-id') == '44'
        search = page.get_by_role('searchbox', name=tr('my_courses.search'))
        search.fill('2414')
        pw.expect(rows).to_have_count(1)
        search.fill('no match')
        page.get_by_role('button', name=tr('my_courses.clear'), exact=True).click()
        pw.expect(rows).to_have_count(3)
        if width < 640:
            page.get_by_role('button', name=tr('my_courses.filters'), exact=True).click()
        kind = page.get_by_role('combobox', name=tr('my_courses.type'), exact=True)
        kind.select_option('grp')
        pw.expect(rows).to_have_count(1)
        kind.select_option('all')
        semester = page.get_by_role('combobox', name=tr('my_courses.semester'), exact=True)
        semester.select_option('FS2023')
        pw.expect(rows).to_have_count(1)
        assert rows.first.get_attribute('data-course-id') == '43'
        semester.select_option('all')
        page.get_by_role('combobox', name=tr('my_courses.sort'), exact=True).select_option('semester')
        assert rows.nth(1).get_attribute('data-course-id') == '42'
        pin = page.locator('article[data-course-id="42"]').get_by_role('button').last
        pin.click()
        pw.expect(pin).to_be_focused()
        pw.expect(page.get_by_role('region', name=tr('my_courses.favourites')).locator('article')).to_have_count(2)
        page.reload()
        pw.expect(page.get_by_role('region', name=tr('my_courses.favourites')).locator('article')).to_have_count(2)
        if width < 640:
            # Controls stay mounted and retain values when the disclosure closes.
            page.get_by_role('button', name=tr('my_courses.filters'), exact=True).click()
        pw.expect(page.get_by_role('combobox', name=tr('my_courses.sort'), exact=True)).to_have_value('semester')
        assert_no_overflow(page)
        for select in page.get_by_role('combobox').all():
            assert select.bounding_box()['height'] >= 48
        if width < 640:
            page.get_by_role('button', name=tr('my_courses.filters'), exact=True).click()
        page.screenshot(path=f'.pytest_cache/my-courses-{width}-{height}-{language}-{scheme}.png', full_page=True, animations='disabled')
        # Cards keep star actions separate from navigation, including on phones.
        page.locator('article[data-course-id="42"]').get_by_role('button').first.click()
        pw.expect(page).to_have_url(local_site + '/?course=42')
        page.go_back()
        pw.expect(rows).to_have_count(3)
        page.locator('article[data-course-id="44"]').get_by_role('button').first.click()
        pw.expect(page).to_have_url(local_site + '/?repository=44')
        page.go_back()
        pw.expect(rows).to_have_count(3)
        page.locator('article[data-course-id="44"]').get_by_role('button').last.click()
        page.reload()
        pw.expect(page.get_by_role('region', name=tr('my_courses.favourites')).locator('article')).to_have_count(1)
        # Refresh failures retain the previous list and offer retry.
        failure[0] = True
        page.get_by_role('button', name=tr('my_courses.refresh')).click()
        pw.expect(page.get_by_role('alert')).to_contain_text(tr('my_courses.load_failed'))
        pw.expect(rows).to_have_count(3)
        failure[0] = False
        page.get_by_role('button', name=tr('Erneut versuchen'), exact=True).click()
        pw.expect(page.get_by_role('alert')).to_have_count(0)
        # A different session gets native defaults rather than another user's pins.
        page.evaluate("localStorage.setItem('betterilias_session_id', 'another-test-session')")
        page.reload()
        native_pin = page.get_by_role('region', name=tr('my_courses.favourites')).locator('article')
        pw.expect(native_pin).to_have_count(1)
        assert native_pin.first.get_attribute('data-course-id') == '44'
        if width < 640:
            page.get_by_role('button', name=tr('my_courses.filters'), exact=True).click()
        pw.expect(page.get_by_role('combobox', name=tr('my_courses.sort'), exact=True)).to_have_value('name')
        courses.clear()
        page.get_by_role('button', name=tr('my_courses.refresh')).click()
        pw.expect(page.get_by_text(tr('my_courses.empty'), exact=True)).to_be_visible()
        assert not errors
        browser.close()
