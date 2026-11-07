"""Built app opt-in, UUID lifetime and request isolation; Chromium emulation."""
import json
import os
import uuid
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320,740), (390,844), (430,900), (768,900), (1280,900), (667,375)])
@pytest.mark.parametrize('language,scheme', [('en','light'), ('de','dark')])
def test_browser_statistics_opt_in_reconnect_withdraw_and_expire(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    requests = []
    key = 'betterilias_browser_statistics'

    def respond(route):
        path = urlparse(route.request.url).path
        requests.append((path, route.request.headers))
        if path.startswith('/api/diagnostics/'):
            route.fulfill(content_type='application/json', body='{"mode":"ask","available":false}')
        else:
            mock_api(route)

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width,height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.add_init_script("localStorage.setItem('betterilias_language',%s);if(!localStorage.getItem('betterilias_session_id'))localStorage.setItem('betterilias_session_id','alpha');" % json.dumps(language))
        page.route('**/api/**', respond)

        def settings():
            page.get_by_role('button', name=tr('Design & Einstellungen'), exact=True).click()
            dialog = page.get_by_role('dialog', name=tr('Einstellungen & Design'), exact=True)
            return dialog, dialog.get_by_role('switch', name=tr('statistics.enable'), exact=True)

        page.goto(local_site)
        dialog, toggle = settings()
        pw.expect(toggle).to_have_attribute('aria-checked', 'false')
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        directory = ROOT / 'scratch/browser-statistics-review'
        directory.mkdir(parents=True, exist_ok=True)
        info = dialog.get_by_role('button', name=tr('statistics.details'), exact=True)
        pw.expect(dialog.get_by_text(tr('statistics.disclosure'), exact=True)).to_have_count(0)
        info.click()
        details = page.get_by_role('dialog', name=tr('statistics.title'), exact=True)
        pw.expect(details).to_be_visible()
        pw.expect(details.get_by_text(tr('statistics.disclosure'), exact=True)).to_be_visible()
        pw.expect(details.get_by_text(tr('statistics.withdrawal'), exact=True)).to_be_visible()
        for close in details.get_by_role('button', name=tr('Schliessen'), exact=True).all():
            pw.expect(close).to_be_in_viewport()
            assert close.bounding_box()['height'] >= 44
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        assert details.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        page.screenshot(path=str(directory / f'info-{width}-{language}-{scheme}.png'))
        details.get_by_role('button', name=tr('Schliessen'), exact=True).last.click()
        pw.expect(dialog).to_be_visible()
        pw.expect(info).to_be_focused()
        info.click()
        page.keyboard.press('Escape')
        pw.expect(details).to_have_count(0)
        pw.expect(dialog).to_be_visible()
        pw.expect(info).to_be_focused()
        toggle.focus()
        toggle.press('Space')
        pw.expect(toggle).to_have_attribute('aria-checked', 'true')
        first = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
        assert uuid.UUID(first['id']).version == 4
        assert first['version'] == 1
        assert toggle.bounding_box()['height'] >= 44
        track = toggle.locator('span').first.bounding_box()
        assert track['width'] > track['height']
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        page.screenshot(path=str(directory / f'settings-{width}-{language}-{scheme}.png'), animations='disabled')
        page.keyboard.press('Escape')
        requests.clear()
        page.reload()
        dialog, toggle = settings()
        pw.expect(toggle).to_have_attribute('aria-checked', 'true')
        assert any(headers.get('x-betterilias-browser-id') == first['id'] for _, headers in requests)
        assert all('x-betterilias-browser-id' not in headers for path, headers in requests
                   if path.startswith(('/api/auth/', '/api/diagnostics/')))
        # Replacing an ILIAS connection keeps the independently consented browser ID.
        page.evaluate("localStorage.setItem('betterilias_session_id','beta')")
        requests.clear()
        page.reload()
        dialog, toggle = settings()
        pw.expect(toggle).to_have_attribute('aria-checked', 'true')
        assert any(headers.get('x-session-id') == 'beta' and headers.get('x-betterilias-browser-id') == first['id']
                   for _, headers in requests)
        toggle.click()
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        page.keyboard.press('Escape')
        requests.clear()
        page.reload()
        dialog, toggle = settings()
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        toggle.click()
        second = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
        assert second['id'] != first['id']
        page.evaluate('(key) => {const value=JSON.parse(localStorage.getItem(key));value.expires=Date.now()-1;localStorage.setItem(key,JSON.stringify(value));}', key)
        requests.clear()
        page.reload()
        dialog, toggle = settings()
        pw.expect(toggle).to_have_attribute('aria-checked', 'false')
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        browser.close()
