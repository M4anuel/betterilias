"""Status reveal on mouse, hybrid and touch devices (mocked Chromium checks)."""
import json
import os

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser checks')


@pytest.mark.parametrize('touch', [False, True])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_status_reveals_with_mouse_keyboard_and_touch(local_site, touch, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    artifacts = ROOT / 'scratch' / 'status-hover-checks'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=dict(width=1280, height=900), has_touch=touch, color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}'); localStorage.setItem('betterilias_theme_mode', '{scheme}');")
        page.route('**/api/**', mock_api)
        page.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
        page.goto(local_site + '/?semester=HS2026', wait_until='domcontentloaded')
        badge = page.get_by_role('status', name=tr('ILIAS-Sitzung aktiv'), exact=True)
        trigger = badge.get_by_role('button', name=tr('Verbunden'), exact=True)
        label = trigger.locator('.session-status-label')
        pw.expect(trigger).to_be_visible()
        assert page.evaluate("matchMedia('(hover: none)').matches") == touch
        for width, height in [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (844, 390)]:
            page.set_viewport_size(dict(width=width, height=height))
            page.mouse.move(0, height - 1)
            trigger.evaluate('(e) => e.blur()')
            pw.expect(label).to_have_css('max-width', '0px')
            trigger.hover()
            pw.expect(label).to_have_css('opacity', '1')
            pw.expect(label).to_have_css('max-width', '160px')
            assert label.bounding_box()['width'] > 30
            assert trigger.bounding_box()['height'] >= 44
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(artifacts / f'{language}-{scheme}-{touch}-{width}.png'), animations='disabled')
            page.mouse.move(0, height - 1)
            pw.expect(label).to_have_css('max-width', '0px')
            page.locator('header [data-settings-trigger]').focus()
            page.keyboard.press('Shift+Tab')
            pw.expect(trigger).to_be_focused()
            pw.expect(label).to_have_css('opacity', '1')
            trigger.press('Escape')
            pw.expect(label).to_have_css('max-width', '0px')
            if touch:
                trigger.tap()
                pw.expect(label).to_have_css('opacity', '1')
                page.locator('header [data-settings-trigger]').tap()
                page.keyboard.press('Escape')
        page.emulate_media(reduced_motion='reduce')
        pw.expect(label).to_have_css('transition-duration', '0s')
        pw.expect(trigger.locator('.animate-ping')).to_have_css('animation-name', 'none')
        browser.close()
