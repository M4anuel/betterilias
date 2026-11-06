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
            return dialog, dialog.get_by_label(tr('statistics.enable'), exact=True)

        page.goto(local_site)
        dialog, checkbox = settings()
        pw.expect(checkbox).not_to_be_checked()
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        checkbox.check()
        first = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
        assert uuid.UUID(first['id']).version == 4
        assert first['version'] == 1
        assert checkbox.locator('..').bounding_box()['height'] >= 44
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        directory = ROOT / 'scratch/browser-statistics-review'
        directory.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(directory / f'settings-{width}-{language}-{scheme}.png'))
        page.keyboard.press('Escape')
        requests.clear()
        page.reload()
        dialog, checkbox = settings()
        pw.expect(checkbox).to_be_checked()
        assert any(headers.get('x-betterilias-browser-id') == first['id'] for _, headers in requests)
        assert all('x-betterilias-browser-id' not in headers for path, headers in requests
                   if path.startswith(('/api/auth/', '/api/diagnostics/')))
        # Replacing an ILIAS connection keeps the independently consented browser ID.
        page.evaluate("localStorage.setItem('betterilias_session_id','beta')")
        requests.clear()
        page.reload()
        dialog, checkbox = settings()
        pw.expect(checkbox).to_be_checked()
        assert any(headers.get('x-session-id') == 'beta' and headers.get('x-betterilias-browser-id') == first['id']
                   for _, headers in requests)
        checkbox.uncheck()
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        page.keyboard.press('Escape')
        requests.clear()
        page.reload()
        dialog, checkbox = settings()
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        checkbox.check()
        second = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
        assert second['id'] != first['id']
        page.evaluate('(key) => {const value=JSON.parse(localStorage.getItem(key));value.expires=Date.now()-1;localStorage.setItem(key,JSON.stringify(value));}', key)
        requests.clear()
        page.reload()
        dialog, checkbox = settings()
        pw.expect(checkbox).not_to_be_checked()
        assert page.evaluate('(key) => localStorage.getItem(key)', key) is None
        assert not any('x-betterilias-browser-id' in headers for _, headers in requests)
        browser.close()
