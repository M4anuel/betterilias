"""Shared connection recovery with the built frontend and mocked API responses."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('language,scheme', [('en', 'light'), ('de', 'dark'), ('en', 'dark'), ('de', 'light')])
@pytest.mark.parametrize('width,height', [(320, 740), (390, 740), (430, 740), (768, 840), (1280, 840), (844, 390)])
def test_shared_feedback_and_recovery(local_site, language, scheme, width, height):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8'))
    state = {'failure': 401}
    calls = []

    def respond(route):
        path = urlparse(route.request.url).path
        calls.append((route.request.method, path))
        if path.endswith('/auth/status'):
            body = dict(authenticated=state['failure'] != 401, cookies_present=state['failure'] != 401)
        elif state['failure']:
            if state['failure'] == 'network':
                route.abort('failed')
                return
            route.fulfill(status=state['failure'], content_type='text/html', body='Private upstream detail')
            return
        elif path.endswith('/memberships'):
            body = dict(courses=[dict(ref_id='42', title='Recovered course', item_type='crs', semester='HS2026')])
        elif '/repository/' in path:
            body = dict(container_ref_id='1', title='Repository', items=[], breadcrumbs=[])
        elif '/calendar' in path:
            body = dict(semester='HS2026', semester_start_date='2026-09-14', semester_end_date='2026-12-31',
                        semester_mid_date='2026-11-01', courses=[], rules=[], events=[])
        else:
            body = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
        route.fulfill(content_type='application/json', body=json.dumps(body))

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        page.route('**/api/**', respond)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        artifacts = ROOT / 'scratch' / 'connection-feedback'
        artifacts.mkdir(parents=True, exist_ok=True)
        for query in ['?view=my-courses', '?repository=1', '?view=calendar', '?semester=HS2026']:
            page.goto(local_site + '/' + query)
            notice = page.locator('[data-connection-notice]')
            pw.expect(notice).to_contain_text(tr['connection.signed_out.title'])
            pw.expect(page.locator('main [role=alert]')).to_have_count(0)
            assert 'Private upstream detail' not in page.locator('body').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            button = notice.get_by_role('button', name=tr['connection.connect'])
            assert button.bounding_box()['height'] >= 44
        button.click()
        dialog = page.get_by_role('dialog', name=tr['BetterIlias Companion'], exact=True)
        pw.expect(dialog).to_be_visible()
        pw.expect(dialog.get_by_role('link', name=tr['extension.store.open']).first).to_have_attribute('href',
            'https://chromewebstore.google.com/detail/betterilias-companion/jpofcbijmjcndakhbbcnmedcdcfefiea')
        page.screenshot(path=str(artifacts / f'setup-{language}-{scheme}-{width}.png'))
        page.keyboard.press('Escape')
        pw.expect(button).to_be_focused()

        for failure in [503, 'network', 500]:
            state['failure'] = failure
            page.goto(local_site + '/?view=my-courses')
            if failure == 500:
                pw.expect(page.locator('main [role=alert]')).to_contain_text(tr['errors.load_failed'])
                retry = page.locator('main').get_by_role('button', name=tr['Erneut versuchen'], exact=True)
            else:
                pw.expect(notice).to_contain_text(tr['connection.unavailable.title'])
                retry = notice.get_by_role('button', name=tr['Erneut versuchen'], exact=True)
            page.locator('main input[type=search], main input').first.fill('Recovered')
            page.screenshot(path=str(artifacts / f'{failure}-{language}-{scheme}-{width}.png'))
            state['failure'] = 0
            writes_before = [call for call in calls if call[0] != 'GET' and '/diagnostics/' not in call[1]]
            retry.click()
            pw.expect(page.get_by_text('Recovered course', exact=True).first).to_be_visible()
            pw.expect(notice).to_have_count(0)
            pw.expect(page.locator('main input').first).to_have_value('Recovered')
            assert writes_before == [call for call in calls if call[0] != 'GET' and '/diagnostics/' not in call[1]]
        # A first visit treats sign-in as onboarding and starts with compact navigation.
        state['failure'] = 401
        page.goto(local_site + '/?view=about')
        pw.expect(page.locator('main').get_by_role('button', name=tr['connection.connect'], exact=True)).to_be_visible()
        pw.expect(notice).to_have_count(0)
        if width >= 1024:
            assert page.locator('aside').bounding_box()['width'] < 100
        page.screenshot(path=str(artifacts / f'landing-{language}-{scheme}-{width}.png'))
        assert errors == []
        browser.close()


@pytest.mark.parametrize('failure,credential,key', [
    (401, True, 'connection.expired.title'),
    (401, False, 'connection.signed_out.title'),
    (403, True, 'errors.forbidden'),
    (404, True, 'errors.not_found'),
    (429, True, 'errors.rate_limited'),
    ('offline', True, 'connection.offline.title'),
])
def test_auth_permissions_and_offline_are_distinct(local_site, failure, credential, key):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales/en.json').read_text(encoding='utf8'))

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/auth/status'):
            route.fulfill(content_type='application/json', body=json.dumps(dict(
                authenticated=failure != 401, cookies_present=credential)))
        elif '/diagnostics/' in path:
            route.fulfill(content_type='application/json', body='{}')
        elif failure == 'offline':
            route.abort('internetdisconnected')
        else:
            route.fulfill(status=failure, content_type='text/html', body='Private upstream detail')

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=390, height=740))
        if credential:
            page.add_init_script("localStorage.setItem('betterilias_session_id', 'existing-session');")
        if failure == 'offline':
            page.add_init_script("Object.defineProperty(navigator, 'onLine', {get: () => false});")
        page.route('**/api/**', respond)
        page.goto(local_site + '/?view=my-courses')
        feedback = page.locator('main [role=alert]') if failure in [403, 404, 429] else page.locator('[data-connection-notice]')
        pw.expect(feedback.get_by_text(tr[key], exact=True)).to_be_visible()
        if failure in [403, 404, 429]:
            pw.expect(page.locator('[data-connection-notice]')).to_have_count(0)
        else:
            pw.expect(page.locator('main [role=alert]')).to_have_count(0)
        assert 'Private upstream detail' not in page.locator('body').inner_text()
        browser.close()


def test_silent_backend_timeout_can_be_retried(local_site):
    pw = pytest.importorskip('playwright.sync_api')
    ready = [False]

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/memberships'):
            if not ready[0]:
                return  # Keep the request open until the application's deadline.
            body = dict(courses=[dict(ref_id='42', title='Recovered course', item_type='crs')])
        elif path.endswith('/auth/status'):
            body = dict(authenticated=True, cookies_present=True)
        else:
            body = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
        route.fulfill(content_type='application/json', body=json.dumps(body))

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=390, height=740))
        page.add_init_script("""
          const nativeTimeout = window.setTimeout.bind(window);
          window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 25000 ? 100 : delay, ...args);
        """)
        page.route('**/api/**', respond)
        page.goto(local_site + '/?view=my-courses')
        notice = page.locator('[data-connection-notice]')
        pw.expect(notice).to_contain_text('Service connection interrupted')
        ready[0] = True
        notice.get_by_role('button', name='Try again', exact=True).click()
        pw.expect(page.get_by_text('Recovered course', exact=True).first).to_be_visible()
        pw.expect(notice).to_have_count(0)
        browser.close()
