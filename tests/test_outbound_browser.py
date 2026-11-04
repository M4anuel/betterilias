"""Busy ILIAS responses preserve the signed-in session and permit manual retry."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900),
                                         (768, 900), (1280, 900), (667, 375)])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
def test_busy_submissions_keep_session_and_retry(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    failing, requests = [True], []
    def respond(route):
        if urlparse(route.request.url).path.endswith('/submissions'):
            requests.append(route.request)
            assert route.request.headers.get('x-session-id') == 'synthetic-browser-user'
            if failing[0]:
                route.fulfill(status=503, content_type='application/json',
                    headers={'Retry-After': '1'}, body=json.dumps({'detail': tr('outbound.busy'), 'code': 'ILIAS_BUSY'}))
                return
        mock_api(route)
    artifacts = ROOT / 'scratch' / 'outbound-browser'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport={'width': width, 'height': height},
                                color_scheme=scheme, is_mobile=width < 768, has_touch=width < 768)
        page.add_init_script(f"""
            localStorage.setItem('betterilias_language', '{language}');
            localStorage.setItem('betterilias_session_id', 'synthetic-browser-user');
            window.authEvents = [];
            window.addEventListener('ilias-session', event => authEvents.push(event.detail));
        """)
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        alert = page.get_by_role('alert').filter(has_text=tr('outbound.busy'))
        pw.expect(alert).to_be_visible()
        alert.scroll_into_view_if_needed()
        retry = alert.get_by_role('button', name=tr('Erneut versuchen'), exact=True)
        pw.expect(retry).to_be_in_viewport()
        assert_no_overflow(page)
        assert False not in page.evaluate('authEvents')
        page.screenshot(path=str(artifacts / f'busy-{width}-{language}.png'))
        failing[0] = False
        retry.focus()
        page.keyboard.press('Enter')
        pw.expect(page.locator('.submission-card')).to_have_count(1)
        pw.expect(alert).to_have_count(0)
        assert page.evaluate("localStorage.getItem('betterilias_session_id')") == 'synthetic-browser-user'
        assert False not in page.evaluate('authEvents')
        assert len(requests) >= 2 and all(request.method == 'GET' for request in requests)
        assert_no_overflow(page)
        browser.close()
