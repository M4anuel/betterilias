"""Build frontend and set BETTERILIAS_BROWSER_TESTS=1. QR decoding also needs Pillow and zxing-cpp."""
import io
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')


def test_desktop_qr_transfers_session_to_mobile_without_extension():
    playwright = pytest.importorskip('playwright.sync_api')
    decoder = pytest.importorskip('zxingcpp')
    image = pytest.importorskip('PIL.Image')
    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(dist)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    phone_base = f'http://betterilias.test:{server.server_port}'
    key = 'qr-test-session-key_0123456789abcdefghijk'
    mobile_requests = []
    revoked = set()

    def api_response(route):
        request = route.request
        current_key = request.headers.get('x-session-id')
        expired = current_key == 'expired-test-key' or current_key in revoked
        path = urlparse(request.url).path
        if path == '/api/auth/logout':
            revoked.add(current_key)
            body = dict(success=True)
        elif path == '/api/auth/mobile-session':
            assert request.method == 'POST'
            body = {'session_id': key}
        elif path == '/api/auth/status':
            body = dict(authenticated=not expired, cookies_present=not expired, user_name='Test user' if not expired else None)
        elif expired:
            route.fulfill(status=401, content_type='application/json', body='{"detail":"Session expired"}')
            return
        else:
            body = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
            desktop = browser.new_page(locale='de-CH')
            errors = []
            desktop.on('pageerror', lambda err: errors.append(str(err)))
            desktop.route('**/api/**', api_response)
            desktop.add_init_script("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedMobileLink = text; } } })")
            desktop.goto(base + '/?semester=HS2026')
            desktop.get_by_role('button', name='Design & Einstellungen', exact=True).click()
            desktop.get_by_role('button', name='QR-Code anzeigen', exact=True).click()
            field = desktop.get_by_label('BetterIlias-Adresse für das Handy', exact=True)
            qr = desktop.get_by_role('img', name='QR-Code zum Verbinden mit BetterIlias', exact=True)
            playwright.expect(field).to_have_attribute('aria-invalid', 'true')
            playwright.expect(qr).to_have_count(0)
            field.fill('javascript:alert(1)')
            playwright.expect(qr).to_have_count(0)
            field.fill('http://[::1]:5173')
            playwright.expect(qr).to_have_count(0)
            field.fill(phone_base)
            playwright.expect(qr).to_be_visible()
            decoded = decoder.read_barcode(image.open(io.BytesIO(qr.screenshot())))
            assert decoded is not None
            share_url = decoded.text
            assert share_url == phone_base + '/#session_id=' + key
            assert 'session_id' not in urlparse(share_url).query
            assert desktop.evaluate("localStorage.getItem('betterilias_session_id')") == key
            desktop.get_by_role('button', name='Verbindungslink kopieren', exact=True).click()
            assert desktop.evaluate('window.copiedMobileLink') == share_url
            assert desktop.evaluate("localStorage.getItem('betterilias_mobile_app_address')") == phone_base + '/'
            desktop.get_by_role('button', name='Design & Einstellungen', exact=True).click()
            playwright.expect(qr).to_have_count(0)

            mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='de-CH')
            phone = mobile.new_page()
            phone.on('pageerror', lambda err: errors.append(str(err)))
            phone.add_init_script("""if (!localStorage.getItem('seeded')) {
              localStorage.setItem('seeded', 'yes');
              localStorage.setItem('betterilias_session_id', 'previous-account');
              localStorage.setItem('ilias_last_opened_course', '99');
              localStorage.setItem('ilias_materials_cache_99', JSON.stringify({container_ref_id:'99',title:'Old account',breadcrumbs:[],items:[]}));
              localStorage.setItem('unrelated-preference', 'keep');
            }""")

            def mobile_route(route):
                request = route.request
                parsed = urlparse(request.url)
                mobile_requests.append(request)
                if parsed.path.startswith('/api/'):
                    api_response(route)
                else:
                    # Map the simulated LAN hostname to the local test server, without any external requests.
                    response = route.fetch(url=base + parsed.path + ('?' + parsed.query if parsed.query else ''))
                    route.fulfill(response=response)

            phone.route('**/*', mobile_route)
            phone.goto(share_url)
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung aktiv', exact=True)).to_be_visible()
            assert phone.evaluate('window.location.hash') == ''
            assert phone.evaluate("localStorage.getItem('betterilias_session_id')") == key
            assert phone.evaluate("localStorage.getItem('ilias_materials_cache_99')") is None
            assert phone.evaluate("localStorage.getItem('unrelated-preference')") == 'keep'
            phone.reload()
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung aktiv', exact=True)).to_be_visible()
            protected = [r for r in mobile_requests if urlparse(r.url).path.startswith('/api/')]
            assert protected and all(r.headers.get('x-session-id') == key for r in protected)
            assert all(key not in r.url and key not in r.headers.get('referer', '') for r in mobile_requests)
            assert not any('/courses/99/' in r.url for r in mobile_requests)
            phone.get_by_role('button', name='Design & Einstellungen', exact=True).click()
            panel = phone.get_by_text('Einstellungen & Design', exact=True).locator('xpath=../..').locator('xpath=..')
            bounds = panel.bounding_box()
            assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 390
            assert bounds['y'] + bounds['height'] <= 844

            # Existing extension links in the query remain compatible and are scrubbed before API calls.
            phone.goto(phone_base + '/?session_id=legacy-test-key&semester=HS2026')
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung aktiv', exact=True)).to_be_visible()
            assert phone.evaluate("localStorage.getItem('betterilias_session_id')") == 'legacy-test-key'
            assert 'session_id' not in phone.url

            phone.goto(phone_base + '/#session_id=expired-test-key')
            playwright.expect(phone.get_by_text('Sitzung nicht aktiv:', exact=True)).to_be_visible()
            phone.get_by_role('button', name='Design & Einstellungen', exact=True).click()
            playwright.expect(phone.get_by_role('button', name='QR-Code anzeigen', exact=True)).to_have_count(0)
            playwright.expect(phone.get_by_text('Synchronisiere zuerst deine ILIAS-Sitzung am Desktop.', exact=True)).to_be_visible()
            # Logging out revokes the shared key and must not fall back to a default desktop session.
            phone.goto(share_url)
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung aktiv', exact=True)).to_be_visible()
            phone.get_by_role('button', name='Design & Einstellungen', exact=True).click()
            phone.get_by_role('button', name='Abmelden', exact=True).click()
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung inaktiv', exact=True)).to_be_visible()
            assert phone.evaluate("localStorage.getItem('betterilias_session_id')") == key
            phone.reload()
            playwright.expect(phone.get_by_role('status', name='ILIAS-Sitzung inaktiv', exact=True)).to_be_visible()
            desktop.reload()
            playwright.expect(desktop.get_by_role('status', name='ILIAS-Sitzung inaktiv', exact=True)).to_be_visible()
            assert not errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
