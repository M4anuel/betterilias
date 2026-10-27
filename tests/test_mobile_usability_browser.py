"""Phone navigation, contained content and keyboard-sized authoring regressions."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('language,scheme', [('en', 'light'), ('de', 'dark')])
@pytest.mark.parametrize('width', [320, 390, 430, 768])
def test_mobile_navigation_content_settings_and_draft(local_site, language, scheme, width):
    playwright = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    title = 'VeryLongCourseTitle' * 8
    authoring = dict(ref_id='42', can_manage=True, can_create=True, creatable_types=['fold', 'file'])
    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/status'):
            body = dict(authenticated=True, cookies_present=True)
        elif path.endswith('/semesters'):
            body = dict(active_semester='HS2026', available_semesters=[], grouped_by_category={}, courses=[
                dict(ref_id='42', title=title, url='', item_type='crs', semester='HS2026')])
        elif path.endswith('/materials'):
            body = dict(container_ref_id='42', title=title, authoring=authoring, items=[], sections=[], sessions=[], logs=[],
                        breadcrumbs=[dict(ref_id='42', title=title)], rich_text_blocks=[], blocks=[
                            dict(id='text', block_type='text', html_content='<p>' + 'LongLecturerContent' * 40 + '</p><table><tr>' +
                                 '<td>Wide column content</td>' * 12 + '</tr></table><iframe src="https://example.org/notes.pdf"></iframe>')])
        elif path.endswith('/authoring-context'):
            body = authoring
        elif path.endswith('/management'):
            body = dict(ref_id='42', authoring=authoring, items=[], order=[], can_sort=False)
        else:
            body = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=740), is_mobile=width < 1024, has_touch=True,
                                locale=language, color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42')
        toggle = page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True)
        if width < 1024:
            playwright.expect(page.locator('aside')).to_be_hidden()
            toggle.click()
            drawer = page.get_by_role('dialog', name=tr('Meine Vorlesungen'))
            playwright.expect(drawer).to_be_visible()
            assert drawer.bounding_box()['width'] < width
            drawer.get_by_role('button', name=title, exact=True).click()
            playwright.expect(drawer).to_be_hidden()
            toggle.click()
            page.keyboard.press('Escape')
            playwright.expect(toggle).to_be_focused()
        playwright.expect(page.get_by_role('button', name=tr('management.enter'), exact=True)).to_be_visible()
        playwright.expect(page.get_by_role('link', name=tr('media.open_pdf'))).to_have_attribute('href', 'https://example.org/notes.pdf')
        playwright.expect(page.get_by_role('region', name=tr('media.scroll_table'))).to_be_visible()
        assert page.locator('main').evaluate('(e) => e.scrollWidth <= e.clientWidth + 1'), page.locator('main').evaluate('''e => [...e.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > e.getBoundingClientRect().right + 1).slice(0, 12).map(n => [n.tagName, n.className, n.getBoundingClientRect().width])''')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('button', name=tr('Design & Einstellungen'), exact=True).click()
        settings = page.locator('select').filter(has=page.locator('option[value="en"]'))
        playwright.expect(settings).to_be_visible()
        page.keyboard.press('Escape')
        page.screenshot(path=f'.pytest_cache/mobile-{width}-{language}.png')
        page.get_by_role('button', name=tr('management.enter'), exact=True).click()
        page.get_by_role('button', name=tr('authoring.add'), exact=True).click()
        dialog = page.get_by_role('dialog', name=tr('authoring.add'), exact=True)
        search = dialog.locator('input')
        search.fill('draft')
        # Resize to a keyboard-sized landscape viewport without remounting the draft.
        page.set_viewport_size(dict(width=667, height=320))
        playwright.expect(search).to_have_value('draft')
        bounds = dialog.bounding_box()
        assert bounds['y'] >= 0 and bounds['y'] + bounds['height'] <= 321
        page.evaluate("""() => {
            Object.defineProperty(visualViewport, 'height', {configurable: true, value: 240});
            Object.defineProperty(visualViewport, 'offsetTop', {configurable: true, value: 55});
            visualViewport.dispatchEvent(new Event('resize'));
        }""")
        bounds = dialog.bounding_box()
        assert bounds['y'] >= 55 and bounds['y'] + bounds['height'] <= 295
        playwright.expect(search).to_have_value('draft')
        close = dialog.get_by_role('button', name=tr('authoring.close'), exact=True)
        close.click()
        playwright.expect(dialog).to_have_count(0)
        browser.close()
