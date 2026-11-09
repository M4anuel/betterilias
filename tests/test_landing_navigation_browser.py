"""Landing-to-app navigation in Chromium emulation with mocked ILIAS data."""
import json
import os
import re

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser checks')


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_landing_course_navigation_matches_url_and_history(local_site, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    artifacts = ROOT / 'scratch' / 'landing-navigation-checks'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1280, height=900), color_scheme=scheme)
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}'); localStorage.setItem('betterilias_theme_mode', '{scheme}');")
        page.route('**/api/**', mock_api)
        page.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        hero = page.get_by_role('heading').filter(has_text=tr('landing.hero_tagline'))

        def open_course(width):
            if width < 1024:
                page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
            page.locator('#course-navigation').get_by_role('button', name='Human Computer Interaction', exact=True).click()
            pw.expect(page).to_have_url(re.compile(r'\?course=42$'))
            pw.expect(page.locator('main').get_by_text('Folder one', exact=True).first).to_be_visible()
            pw.expect(hero).to_have_count(0)
            pw.expect(page.locator('.mobile-navigation[open]')).to_have_count(0)

        # First-time visits show the landing page until a destination is selected.
        page.goto(local_site, wait_until='domcontentloaded')
        pw.expect(hero).to_be_visible()
        open_course(1280)
        for index, (width, height) in enumerate([(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (1440, 766), (844, 390)]):
            page.set_viewport_size(dict(width=width, height=height))
            page.goto(local_site + ('/?view=about' if index % 2 == 0 else '/?view=landing'), wait_until='domcontentloaded')
            pw.expect(hero).to_be_visible()
            open_course(width)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(artifacts / f'{language}-{scheme}-{width}-{height}.png'), animations='disabled')
            page.go_back(wait_until='domcontentloaded')
            pw.expect(hero).to_be_visible()
            page.go_forward(wait_until='domcontentloaded')
            pw.expect(page.locator('main').get_by_text('Folder one', exact=True).first).to_be_visible()
            pw.expect(hero).to_have_count(0)
            # Returning to the overview from the landing page must update its URL too.
            page.goto(local_site + '/?view=about', wait_until='domcontentloaded')
            page.get_by_role('button', name=tr('landing.go_to_app'), exact=True).click()
            pw.expect(hero).to_have_count(0)
            pw.expect(page).to_have_url(re.compile(r'\?semester='))
        assert not errors
        browser.close()
