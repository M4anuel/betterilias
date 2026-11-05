"""Built admin entry, mocked diagnostics; Chromium emulation, not live ILIAS."""
import json
import os
import time
from urllib.parse import parse_qs, urlparse

import pytest

from backend.observability import EVENTS
from tests.test_localisation_browser import ROOT, local_site

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')
KEY = 'browser-only-administrator-secret-' + 'x' * 43


@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 900), (1280, 900), (667, 375)])
@pytest.mark.parametrize('language,scheme', [('en', 'light'), ('de', 'dark')])
def test_admin_login_metrics_filters_pagination_and_expiry(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    state = {'authenticated': False, 'expired': False, 'fail': False, 'hold': False}
    requests, errors, held = [], [], []
    now = time.time()
    events = [
        dict(id=103, timestamp=now, code='outbound.origin_not_allowed', category='security', level='WARNING', request_id='a' * 32, worker='b' * 16),
        dict(id=102, timestamp=now - 5, code='request.completed', category='request', level='INFO', method='GET', status=200, duration_ms=123.4),
    ]
    older = dict(id=99, timestamp=now - 10, code='write.finished', category='audit', level='WARNING', operation='grade', outcome='uncertain', operation_id='c' * 32)
    def respond(route):
        request = route.request
        path = urlparse(request.url).path
        requests.append((path, request.headers, request.post_data))
        assert 'x-session-id' not in request.headers
        status, data = 200, {}
        if path.endswith('/session'):
            if request.method == 'POST':
                assert request.headers['x-admin-request'] == '1'
                if request.post_data_json['key'] == KEY:
                    state.update(authenticated=True, expired=False)
                else:
                    status = 401
            elif request.method == 'DELETE':
                assert request.headers['x-admin-request'] == '1'
                state['authenticated'] = False
            data = dict(authenticated=state['authenticated'], expires_at=now + 1800 if state['authenticated'] else None)
        elif state['expired']:
            status = 404
        elif path.endswith('/summary'):
            if state['fail']:
                status = 503
            data = dict(event_catalogue=EVENTS, diagnostics=dict(worker='b' * 16, queue_depth=2, dropped=0, storage_errors=0,
                console_errors=0, last_write=now, writer_alive=True, retention_seconds=604800,
                retained_counts={'request.completed': 1200, 'outbound.origin_not_allowed': 3},
                retained_request_metrics=dict(count=1200, mean_ms=123.4, max_ms=900, server_errors=2)),
                outbound=dict(requests=900, rejected=0, queue_wait_seconds=10, throttles=1, cooldown_until=0, queued=2))
        elif path.endswith('/reports'):
            data = dict(reports=[], counts=[], next_before=None)
        elif path.endswith('/events'):
            query = parse_qs(urlparse(request.url).query)
            if state['hold'] and query.get('category') == ['security']:
                held.append(route)
                return
            result = [older] if 'before' in query else events
            if query.get('category') == ['audit']:
                result = [older]
            if query.get('category'):
                result = [event for event in result if event['category'] == query['category'][0]]
            if query.get('code'):
                result = [event for event in result if event['code'] == query['code'][0]]
            data = dict(events=result, next_before=100 if result == events else None)
        else:
            pytest.fail('Admin entry requested student endpoint: ' + path)
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    artifacts = ROOT / 'scratch' / 'admin-dashboard-review'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('betterilias_language',%s); localStorage.setItem('betterilias_session_id','student-credential');" % json.dumps(language))
        page.route('**/api/**', respond)
        page.goto(local_site + '/admin/')
        password = page.get_by_label(tr('admin.key'), exact=True)
        pw.expect(password).to_be_focused()
        password.fill('draft')
        page.set_viewport_size(dict(width=430, height=450))
        pw.expect(password).to_have_value('draft')
        page.set_viewport_size(dict(width=width, height=height))
        password.press('Enter')
        pw.expect(page.get_by_role('alert')).to_contain_text(tr('admin.login_failed'))
        pw.expect(password).to_have_value('')
        pw.expect(password).to_be_focused()
        page.screenshot(path=str(artifacts / f'login-{width}-{language}-{scheme}.png'), full_page=True)
        password.fill(KEY)
        password.press('Enter')
        pw.expect(page.get_by_role('heading', name=tr('admin.overview'), exact=True)).to_be_visible()
        pw.expect(page.locator('.admin-event')).to_have_count(2)
        page.locator('.admin-event summary').first.click()
        pw.expect(page.get_by_text('a' * 32, exact=True)).to_be_visible()
        category = page.get_by_label(tr('admin.category'), exact=True)
        code = page.get_by_label(tr('admin.event_code'), exact=True)
        category.select_option('security')
        pw.expect(page.locator('.admin-event')).to_have_count(1)
        code.select_option('outbound.origin_not_allowed')
        pw.expect(page.locator('.admin-event')).to_have_count(1)
        category.select_option('compatibility')
        pw.expect(page.get_by_text(tr('admin.empty'), exact=True)).to_be_visible()
        category.select_option('')
        pw.expect(page.locator('.admin-event')).to_have_count(2)
        page.get_by_role('button', name=tr('admin.load_more'), exact=True).click()
        pw.expect(page.locator('.admin-event')).to_have_count(3)
        page.locator('.admin-event summary').last.click()
        pw.expect(page.get_by_text(tr('admin.outcome.uncertain'), exact=True)).to_be_visible()
        # A failed refresh retains the existing data and reports its staleness.
        state['fail'] = True
        page.locator('.admin-heading').get_by_role('button', name=tr('admin.refresh'), exact=True).click()
        pw.expect(page.get_by_role('alert')).to_contain_text(tr('admin.refresh_failed'))
        pw.expect(page.locator('.admin-event')).to_have_count(3)
        state['fail'] = False
        page.get_by_role('button', name=tr('admin.retry'), exact=True).click()
        pw.expect(page.get_by_role('alert')).to_have_count(0)
        pw.expect(page.locator('.admin-event')).to_have_count(2)
        if width == 1280 and language == 'en':
            # An aborted, delayed filter response cannot replace the newer list.
            state['hold'] = True
            category.select_option('security')
            with page.expect_request('**/api/admin/events?*category=audit'):
                category.select_option('audit')
            pw.expect(page.get_by_text(tr('admin.event.write.finished'), exact=True)).to_be_visible()
            assert held
            for route in held:
                try:
                    route.fulfill(content_type='application/json', body=json.dumps(dict(events=events, next_before=None)))
                except pw.Error:
                    pass  # The browser may already have cancelled the request.
            pw.expect(page.locator('.admin-event')).to_have_count(1)
            state['hold'] = False
            category.select_option('')
            pw.expect(page.locator('.admin-event')).to_have_count(2)
            page.clock.install()
            page.get_by_label(tr('admin.auto'), exact=True).check()
            with page.expect_request('**/api/admin/summary'):
                page.clock.fast_forward(30001)
            pw.expect(page.locator('.admin-heading').get_by_role('button', name=tr('admin.refresh'), exact=True)).to_be_enabled()
            page.get_by_label(tr('admin.auto'), exact=True).uncheck()
            de = json.loads((ROOT / 'locales/de.json').read_text(encoding='utf-8')).__getitem__
            page.get_by_label(tr('admin.language'), exact=True).select_option('de')
            pw.expect(page.get_by_role('heading', name=de('admin.overview'), exact=True)).to_be_visible()
            page.get_by_role('button', name=de('admin.dark'), exact=True).click()
            pw.expect(page.locator('html')).to_have_class('dark')
            page.get_by_role('button', name=de('admin.light'), exact=True).click()
            page.get_by_label(de('admin.language'), exact=True).select_option('en')
            pw.expect(page.get_by_role('heading', name=tr('admin.overview'), exact=True)).to_be_visible()
            pw.expect(page.locator('.admin-event')).to_have_count(2)
        page.evaluate('scrollTo(0, 0)')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert KEY not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.evaluate("localStorage.getItem('betterilias_session_id')") == 'student-credential'
        assert all('/api/admin/' in path for path, _, _ in requests)
        assert not errors
        page.screenshot(path=str(artifacts / f'dashboard-{width}-{language}-{scheme}.png'), full_page=True)
        page.get_by_role('button', name=tr('admin.logout'), exact=True).click()
        pw.expect(password).to_be_visible()
        password.fill(KEY)
        password.press('Enter')
        pw.expect(page.locator('.admin-event')).to_have_count(2)
        state['expired'] = True
        page.locator('.admin-heading').get_by_role('button', name=tr('admin.refresh'), exact=True).click()
        pw.expect(password).to_be_focused()
        pw.expect(page.get_by_role('alert')).to_contain_text(tr('admin.expired'))
        pw.expect(page.locator('.admin-event')).to_have_count(0)
        browser.close()


@pytest.mark.parametrize('language,scheme', [('de', 'light'), ('en', 'dark')])
@pytest.mark.parametrize('mode', ['disabled', 'unavailable', 'loading', 'logout-failure'])
def test_admin_loading_disabled_and_error_states(local_site, language, scheme, mode):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    pending = []
    def respond(route):
        path = urlparse(route.request.url).path
        status, data = 200, {}
        if path.endswith('/session'):
            if mode == 'loading':
                pending.append(route)
                return
            if mode in ('disabled', 'unavailable') or route.request.method == 'DELETE':
                status = 404 if mode == 'disabled' else 503
            data = dict(authenticated=mode == 'logout-failure', expires_at=time.time() + 1800)
        elif path.endswith('/summary'):
            data = dict(event_catalogue=EVENTS, diagnostics=dict(worker='a' * 16, queue_depth=0, dropped=2,
                storage_errors=1, console_errors=1, last_write=None, writer_alive=False,
                retention_seconds=604800, retained_counts={},
                retained_request_metrics=dict(count=0, mean_ms=None, max_ms=None, server_errors=0)),
                outbound=dict(requests=0, rejected=0, queued=0, throttles=0, cooldown_until=0, queue_wait_seconds=0))
        elif path.endswith('/reports'):
            data = dict(reports=[], counts=[], next_before=None)
        elif path.endswith('/events'):
            data = dict(events=[], next_before=None)
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=390, height=844), color_scheme=scheme)
        page.add_init_script("localStorage.setItem('betterilias_language', %s)" % json.dumps(language))
        page.route('**/api/**', respond)
        page.goto(local_site + '/admin/')
        if mode == 'disabled':
            pw.expect(page.get_by_text(tr('admin.disabled'), exact=True)).to_be_visible()
            pw.expect(page.get_by_label(tr('admin.key'), exact=True)).to_have_count(0)
        elif mode == 'loading':
            pw.expect(page.get_by_role('status')).to_contain_text(tr('admin.checking'))
        elif mode == 'unavailable':
            pw.expect(page.get_by_role('alert')).to_contain_text(tr('admin.unavailable'))
        else:
            pw.expect(page.get_by_text(tr('admin.attention'), exact=True)).to_be_visible()
            page.get_by_role('button', name=tr('admin.logout'), exact=True).click()
            pw.expect(page.get_by_role('alert')).to_contain_text(tr('admin.logout_failed'))
            pw.expect(page.get_by_role('heading', name=tr('admin.overview'), exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        directory = ROOT / 'scratch' / 'admin-dashboard-review'
        directory.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(directory / f'{mode}-{language}-{scheme}.png'), full_page=True)
        if mode == 'loading':
            for route in pending:
                route.fulfill(content_type='application/json', body='{"authenticated":false,"expires_at":null}')
            pw.expect(page.get_by_label(tr('admin.key'), exact=True)).to_be_focused()
        browser.close()
