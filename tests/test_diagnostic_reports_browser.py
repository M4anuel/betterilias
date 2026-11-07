"""Real built UI interactions with mocked errors; Chromium viewport emulation."""
import json
import os
import time
from urllib.parse import parse_qs, urlparse

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')
SIZES = [(320, 740), (390, 844), (430, 900), (768, 900), (1280, 900), (667, 375)]


@pytest.mark.parametrize('width,height', SIZES)
@pytest.mark.parametrize('language,scheme', [('en', 'light'), ('de', 'dark')])
def test_consent_choices_preferences_and_withdrawal(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    state = {'mode': 'ask', 'capture': 0, 'fail': False, 'deleted': 0, 'materials': 0}
    decisions, errors = [], []
    def respond(route):
        request = route.request
        path = urlparse(request.url).path
        headers = {}
        status, data = 200, {}
        if path.startswith('/api/diagnostics/'):
            assert request.headers.get('x-session-id') == 'alpha'
            if path.endswith('/preference'):
                if request.method == 'PUT':
                    state['mode'] = request.post_data_json['mode']
                data = dict(mode=state['mode'], available=True, operator_name='Test maintainer', privacy_url='https://operator.test/privacy',
                            retention_days=30, policy=1, preference_days=90)
            elif path.endswith('/decision'):
                decisions.append(request.post_data_json)
                if state['fail']:
                    status = 503
                else:
                    if request.post_data_json['decision'] == 'always':
                        state['mode'] = 'always'
                    data = dict(saved=request.post_data_json['decision'] != 'decline', report_id='f' * 32)
            elif path.endswith('/reports') and request.method == 'DELETE':
                state['deleted'] += 1
                data = dict(deleted=True)
            else:
                data = {}
        elif path.endswith('/materials'):
            state['materials'] += 1
            state['capture'] += 1
            status, data = 502, dict(detail='Fixture upstream error', code='PARSING_FAILED')
            if state['mode'] == 'ask':
                headers = {'X-Diagnostic-Capture': f"{state['capture']:032x}", 'X-Diagnostic-Code': 'PARSING_FAILED'}
            elif state['mode'] == 'always':
                headers = {'X-Diagnostic-Report': 'f' * 32}
        else:
            mock_api(route)
            return
        route.fulfill(status=status, headers=headers, content_type='application/json', body=json.dumps(data))
    artifacts = ROOT / 'scratch' / 'diagnostic-report-review'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.set_default_timeout(10000)
        page.add_init_script("localStorage.setItem('betterilias_language',%s);localStorage.setItem('betterilias_session_id','alpha');" % json.dumps(language))
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42')
        dialog = page.get_by_role('dialog', name=tr('reports.prompt_title'), exact=True)
        pw.expect(dialog).to_be_visible()
        page.screenshot(path=str(artifacts / f'consent-{width}-{language}.png'), full_page=True)
        for key in ('reports.no', 'reports.once', 'reports.always'):
            pw.expect(dialog.get_by_role('button', name=tr(key), exact=True)).to_be_in_viewport()
        pw.expect(dialog.get_by_role('button', name=tr('Schliessen'), exact=True)).to_be_in_viewport()
        disclosure = dialog.get_by_role('region', name=tr('reports.details'), exact=True)
        disclosure.focus()
        disclosure.press('End')
        for key in ('reports.no', 'reports.once', 'reports.always'):
            pw.expect(dialog.get_by_role('button', name=tr(key), exact=True)).to_be_in_viewport()
        disclosure.evaluate('element => element.scrollTop = 0')
        pw.expect(dialog.get_by_role('link', name=tr('reports.privacy_notice'))).to_have_attribute('href', 'https://operator.test/privacy')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        requests_before = state['materials']
        dialog.get_by_role('button', name=tr('reports.no'), exact=True).click()
        pw.expect(dialog).to_have_count(0)
        page.wait_for_timeout(50)
        assert decisions[-1]['decision'] == 'decline'
        assert state['mode'] == 'ask'
        assert state['materials'] == requests_before
        # Retry a failed consent save without replaying the original course action.
        page.reload()
        pw.expect(dialog).to_be_visible()
        state['fail'] = True
        dialog.get_by_role('button', name=tr('reports.once'), exact=True).click()
        pw.expect(dialog.get_by_role('alert')).to_have_text(tr('reports.unavailable'))
        state['fail'] = False
        requests_before = state['materials']
        dialog.get_by_role('button', name=tr('reports.once'), exact=True).click()
        pw.expect(dialog).to_have_count(0)
        assert state['mode'] == 'ask'
        assert state['materials'] == requests_before
        # Always is explicit, and the following error is shared without a prompt.
        page.reload()
        pw.expect(dialog).to_be_visible()
        dialog.get_by_role('button', name=tr('reports.always'), exact=True).click()
        pw.expect(dialog).to_have_count(0)
        assert state['mode'] == 'always'
        page.reload()
        pw.expect(page.get_by_text(tr('reports.saved'), exact=True)).to_be_visible()
        pw.expect(dialog).to_have_count(0)
        page.get_by_role('button', name=tr('Design & Einstellungen'), exact=True).click()
        settings = page.get_by_role('dialog', name=tr('Einstellungen & Design'), exact=True)
        sharing = settings.get_by_label(tr('reports.sharing'), exact=True)
        pw.expect(sharing).to_have_value('always')
        pw.expect(sharing).to_be_enabled()
        sharing.select_option('never')
        pw.expect(sharing).to_have_value('never')
        pw.expect(settings.get_by_text(tr('reports.preference_saved'), exact=True)).to_be_visible()
        settings.get_by_role('button', name=tr('reports.details'), exact=True).click()
        page.get_by_role('button', name=tr('reports.delete_button'), exact=True).click()
        page.get_by_role('button', name=tr('reports.delete_now'), exact=True).click()
        pw.expect(page.get_by_text(tr('reports.deleted'), exact=True)).to_be_visible()
        assert state['deleted'] == 1
        page.screenshot(path=str(artifacts / f'settings-{width}-{language}.png'), full_page=True)
        assert settings.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        page.keyboard.press('Escape')
        page.reload()
        pw.expect(page.get_by_text('Fixture upstream error', exact=False)).to_be_visible()
        pw.expect(dialog).to_have_count(0)
        assert state['mode'] == 'never'
        assert not errors
        assert page.evaluate("localStorage.getItem('betterilias_session_id')") == 'alpha'
        browser.close()


@pytest.mark.parametrize('width,height', SIZES)
@pytest.mark.parametrize('language,scheme', [('de', 'light'), ('en', 'dark')])
def test_admin_report_groups_download_archive_and_reopen(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8')).__getitem__
    now = time.time()
    report = dict(id='a' * 32, seq=1, created=now, kind='parsing', code='PARSING_FAILED', fingerprint='b' * 64,
                  state='open', revision=1, resolved_at=None,
                  payload=dict(schema=1, code='PARSING_FAILED', status=502, policy=1, request_id='c' * 32, parser='submissions',
                               structure=dict(outline='<table class=ilTable>\n  <tr>\n    <td>\n      <input type=hidden name=rtoken>', nodes=4, limited=False)))
    state = {'conflict': True}
    errors, writes = [], []
    def respond(route):
        path = urlparse(route.request.url).path
        status, data = 200, {}
        if path.endswith('/session'):
            data = dict(authenticated=True, expires_at=now + 1800)
        elif path.endswith('/summary'):
            data = dict(event_catalogue={}, diagnostics=dict(worker='a' * 16, queue_depth=0, dropped=0, storage_errors=0,
                console_errors=0, last_write=now, writer_alive=True, retention_seconds=604800, retained_counts={},
                retained_request_metrics=dict(count=1, mean_ms=1, max_ms=1, server_errors=0)),
                outbound=dict(requests=1, rejected=0, queued=0, throttles=0, cooldown_until=0, queue_wait_seconds=0))
        elif path.endswith('/events'):
            data = dict(events=[], next_before=None)
        elif path.endswith('/reports'):
            query = parse_qs(urlparse(route.request.url).query)
            rows = [report] if query.get('state', ['open'])[0] in ('all', report['state']) and query.get('kind', ['parsing'])[0] == 'parsing' else []
            data = dict(reports=[{key: value for key, value in row.items() if key != 'payload'} for row in rows],
                        counts=[dict(kind='parsing', state=report['state'], count=1)], next_before=None)
        elif '/reports/' in path:
            if route.request.method == 'PATCH':
                assert route.request.headers['x-admin-request'] == '1'
                writes.append(route.request.post_data_json)
                if state['conflict']:
                    state['conflict'] = False
                    report['revision'] += 1
                    status = 409
                else:
                    assert route.request.post_data_json['revision'] == report['revision']
                    report.update(state=route.request.post_data_json['state'], revision=report['revision'] + 1, resolved_at=now)
            data = report
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    artifacts = ROOT / 'scratch' / 'diagnostic-report-review'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('betterilias_language',%s)" % json.dumps(language))
        page.route('**/api/**', respond)
        page.goto(local_site + '/admin/')
        panel = page.get_by_role('region', name=tr('reports.admin_title'), exact=True)
        pw.expect(panel.locator('.report-select')).to_have_count(1)
        panel.get_by_label(tr('reports.kind'), exact=True).select_option('upstream')
        pw.expect(panel.get_by_text(tr('reports.admin_empty'), exact=True)).to_be_visible()
        panel.get_by_label(tr('reports.kind'), exact=True).select_option('parsing')
        panel.locator('.report-select').click()
        outline = panel.get_by_role('region', name=tr('reports.structure'), exact=True)
        pw.expect(outline).to_contain_text('<table class=ilTable>')
        assert panel.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(artifacts / f'admin-report-{width}-{language}.png'), full_page=True)
        with page.expect_download() as download:
            panel.get_by_role('button', name=tr('reports.download'), exact=True).click()
        saved = download.value
        saved.save_as(str(artifacts / f'diagnostic-{width}-{language}.json'))
        assert json.loads((artifacts / f'diagnostic-{width}-{language}.json').read_text())['payload']['structure']['nodes'] == 4
        panel.get_by_role('button', name=tr('reports.resolve'), exact=True).click()
        pw.expect(panel.get_by_role('alert')).to_contain_text(tr('reports.changed'))
        panel.get_by_role('button', name=tr('admin.retry'), exact=True).click()
        pw.expect(panel.get_by_role('alert')).to_have_count(0)
        panel.get_by_role('button', name=tr('reports.resolve'), exact=True).click()
        pw.expect(panel.locator('.report-select')).to_have_count(0)
        panel.get_by_label(tr('reports.state'), exact=True).select_option('resolved')
        pw.expect(panel.locator('.report-select')).to_have_count(1)
        panel.locator('.report-select').click()
        panel.get_by_role('button', name=tr('reports.reopen'), exact=True).click()
        pw.expect(panel.locator('.report-select')).to_have_count(0)
        panel.get_by_label(tr('reports.state'), exact=True).select_option('open')
        pw.expect(panel.locator('.report-select')).to_have_count(1)
        assert len(writes) == 3
        assert not errors
        browser.close()
