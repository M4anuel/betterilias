"""Settings stay below their trigger as QR content grows; Chromium emulation."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320,740), (390,844), (430,900), (768,900), (1280,900), (1440,766), (1280,375), (667,375)])
@pytest.mark.parametrize('language,scheme', [('en','light'), ('de','dark')])
def test_settings_anchor_qr_growth_rotation_and_retired_identifier(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    headers = []

    def respond(route):
        path = urlparse(route.request.url).path
        headers.append(route.request.headers)
        if path == '/api/auth/mobile-session':
            route.fulfill(content_type='application/json', body=json.dumps({'handoff_token': 'synthetic-one-use-handoff-' + 'a'*32, 'expires_in': 60}))
        elif path.startswith('/api/diagnostics/'):
            route.fulfill(content_type='application/json', body='{"mode":"ask","available":false}')
        else:
            mock_api(route)

    artifacts = ROOT / 'scratch/settings-anchor-review'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width,height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('betterilias_language',%s);localStorage.setItem('betterilias_session_id','alpha');localStorage.setItem('betterilias_browser_statistics',JSON.stringify({version:1,id:'12345678-1234-4234-8234-123456789abc',expires:Date.now()+86400000}));" % json.dumps(language))
        page.route('**/api/**', respond)
        page.add_init_script("localStorage.setItem('betterilias_mobile_app_address','https://review.example/')")
        page.goto(local_site + '/?course=42')
        trigger = page.locator('[data-settings-trigger]')
        trigger.click()
        panel = page.get_by_role('dialog', name=tr('Einstellungen & Design'), exact=True)
        pw.expect(panel).to_be_visible()
        assert page.evaluate("localStorage.getItem('betterilias_browser_statistics')") is None
        assert page.evaluate("localStorage.getItem('betterilias_session_id')") == 'alpha'
        assert panel.locator('#browser-statistics-title').count() == 0

        def check_desktop_anchor():
            anchor, menu = trigger.bounding_box(), panel.bounding_box()
            assert menu['y'] >= anchor['y'] + anchor['height'] + 4
            assert menu['y'] + menu['height'] <= page.viewport_size['height'] - 4
            assert trigger.evaluate("e => {const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-settings-trigger]') === e;}")
            return menu['y']

        top = check_desktop_anchor() if width >= 768 else None
        panel.get_by_role('button', name=tr('QR-Code anzeigen'), exact=True).click()
        pw.expect(panel.get_by_role('img', name=tr('QR-Code zum Verbinden mit BetterIlias'), exact=True)).to_be_visible()
        if top is not None:
            assert abs(check_desktop_anchor() - top) <= 1
        address = panel.get_by_label(tr('BetterIlias-Adresse für das Handy'), exact=True)
        address.fill('https://review.example/app')
        panel.get_by_role('button', name=tr('Abmelden'), exact=True).scroll_into_view_if_needed()
        pw.expect(panel.get_by_role('button', name=tr('Abmelden'), exact=True)).to_be_in_viewport()
        assert panel.evaluate('e => e.scrollHeight > e.clientHeight')
        if width >= 768:
            check_desktop_anchor()
        else:
            pw.expect(panel.locator('.settings-sheet-gear')).to_be_in_viewport()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(artifacts / f'expanded-{width}-{height}-{language}-{scheme}.png'))
        target = dict(width=390,height=740) if width >= 768 else dict(width=1280,height=520)
        page.set_viewport_size(target)
        pw.expect(address).to_have_value('https://review.example/app')
        panel.evaluate('e => e.scrollTop = 0')
        if target['width'] >= 768:
            page.wait_for_function("""() => {
              const panel = document.querySelector('.settings-panel');
              const trigger = document.querySelector('[data-settings-trigger]');
              return panel?.open && !panel.matches(':modal') && panel.getBoundingClientRect().top >= trigger.getBoundingClientRect().bottom;
            }""")
            check_desktop_anchor()
            trigger.click()
        else:
            panel.locator('.settings-sheet-gear').click()
        pw.expect(panel).to_have_count(0)
        assert not any('x-betterilias-browser-id' in item for item in headers)
        assert not errors
        browser.close()
