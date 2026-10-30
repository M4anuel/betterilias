"""Opt-in integration checks against the production build and packaged popups."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Requires a frontend build and Chromium')
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def local_site():
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if path.startswith(('/extension/', '/extension-firefox/')):
                return str(ROOT / path.lstrip('/'))
            return super().translate_path(path)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'frontend/dist')))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()


def test_language_switch_is_live_persisted_and_sent_to_backend(local_site):
    playwright = pytest.importorskip('playwright.sync_api')
    headers = []
    def respond(route):
        headers.append(route.request.headers.get('accept-language'))
        path = urlparse(route.request.url).path
        if path.endswith('/status'):
            data = dict(authenticated=True, cookies_present=True, user_name='Test User')
        elif path.endswith('/semesters'):
            course = dict(ref_id='42', title='Meine deutsche Vorlesung', url='https://ilias.unibe.ch/goto.php?target=crs_42', item_type='crs', semester='HS2026')
            data = dict(active_semester='HS2026', available_semesters=[], courses=[course], grouped_by_category={})
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB')
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site)
        page.get_by_role('button', name='Appearance & settings', exact=True).click()
        page.get_by_label('Language', exact=True).select_option('de')
        playwright.expect(page.locator('html')).to_have_attribute('lang', 'de')
        playwright.expect(page.get_by_label('Sprache', exact=True)).to_have_value('de')
        playwright.expect(page.get_by_role('heading', name='Vorlesungsübersicht', exact=True)).to_be_visible()
        assert page.evaluate("localStorage.getItem('betterilias_language')") == 'de'
        assert 'Meine deutsche Vorlesung' in page.locator('body').inner_text()
        page.reload()
        page.get_by_role('button', name='Design & Einstellungen', exact=True).click()
        playwright.expect(page.get_by_label('Sprache', exact=True)).to_have_value('de')
        page.get_by_label('Sprache', exact=True).select_option('en')
        playwright.expect(page.get_by_role('heading', name='Course overview', exact=True)).to_be_visible()
        assert 'Meine deutsche Vorlesung' in page.locator('body').inner_text()
        assert {'en', 'de'}.issubset(set(headers))
        assert errors == []
        browser.close()


@pytest.mark.parametrize('directory', ['extension', 'extension-firefox'])
def test_extension_language_selection_and_safe_sync_feedback(local_site, directory):
    playwright = pytest.importorskip('playwright.sync_api')
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB')
        page.set_default_timeout(10000)
        page.add_init_script('''
            globalThis.chrome = {
              storage: { local: {
                get: async () => JSON.parse(localStorage.getItem('mock-extension') || '{}'),
                set: async values => localStorage.setItem('mock-extension', JSON.stringify({ ...JSON.parse(localStorage.getItem('mock-extension') || '{}'), ...values })),
              } },
              cookies: { getAll: async () => [{ name: 'PHPSESSID', value: 'test' }, { name: '_shibsession_test', value: 'test' }] },
              tabs: { query: async () => [], create: () => {}, sendMessage: async () => {} },
            };
        ''')
        request_languages = []
        def sync(route):
            request_languages.append(route.request.headers.get('accept-language'))
            route.fulfill(status=200, content_type='application/json', body=json.dumps(dict(success=True, authenticated=True, session_id='test-key', user_name='<b>Anna</b>')))
        page.route('**/api/auth/sync', sync)
        page.goto(f'{local_site}/{directory}/popup.html')
        playwright.expect(page.locator('#sync-btn')).to_have_text('Sync session with BetterIlias')
        page.get_by_label('Language', exact=True).select_option('de')
        playwright.expect(page.locator('#sync-btn')).to_have_text('Sitzung mit BetterIlias synchronisieren')
        page.reload()
        playwright.expect(page.get_by_label('Sprache', exact=True)).to_have_value('de')
        page.locator('#sync-btn').click()
        playwright.expect(page.locator('#feedback-box')).to_contain_text('<b>Anna</b>')
        assert page.locator('#feedback-box b').count() == 0
        assert request_languages == ['en', 'de', 'de']
        browser.close()


@pytest.mark.parametrize('directory', ['extension', 'extension-firefox'])
@pytest.mark.parametrize('language,scheme', [('de','dark'), ('de','light'), ('en','dark'), ('en','light')])
def test_extension_checking_invalid_recovery_and_unavailable(local_site, directory, language, scheme):
    pw=pytest.importorskip('playwright.sync_api')
    tr=json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=320 if language=='de' else 430,height=740),color_scheme=scheme)
        page.add_init_script('''
          globalThis.mockCookies=[{name:'PHPSESSID',value:'stale'},{name:'_shibsession_test',value:'stale'}];
          globalThis.badge={text:'✓',color:'#0AACA5'};
          globalThis.chrome={
            storage:{local:{get:async()=>JSON.parse(localStorage.getItem('mock-extension')||'{}'),
              set:async value=>localStorage.setItem('mock-extension',JSON.stringify({...JSON.parse(localStorage.getItem('mock-extension')||'{}'),...value}))}},
            cookies:{getAll:async()=>mockCookies},
            action:{setBadgeText:value=>badge.text=value.text,setIcon:value=>{
              badge.images=value.imageData;
              badge.color=Array.from(value.imageData[16].data.slice((13*16+13)*4,(13*16+13)*4+4));
            }},
            tabs:{query:async()=>[],sendMessage:async()=>{},create:()=>{}}
          };
        ''' + f"localStorage.setItem('mock-extension',JSON.stringify({{language:'{language}',autoSyncEnabled:false}}));" + ("globalThis.browser=chrome;" if directory=='extension-firefox' else ''))
        held=[]
        mode=['held']
        def respond(route):
            if mode[0]=='held':held.append(route)
            elif mode[0]=='valid':route.fulfill(content_type='application/json',body=json.dumps(dict(success=True,authenticated=True,session_id='fresh-session',user_name='Anna')))
            else:route.fulfill(status=503,content_type='application/json',body='{}')
        page.route('**/api/auth/sync',respond)
        page.goto(f'{local_site}/{directory}/popup.html')
        badge=page.locator('#ilias-status-badge')
        pw.expect(badge).to_have_text(tr('Prüfe...'))
        pw.expect(badge).to_have_class('status-badge badge-warning')
        pw.expect(page.locator('#auto-sync-badge')).to_have_text(tr('Disabled'))
        pw.expect(page.locator('#auto-sync-badge')).to_have_class('status-badge badge-neutral')
        page.wait_for_function("badge.text==='' && badge.color?.join(',')==='217,119,6,255'")
        page.get_by_label(tr('Language'),exact=True).select_option('en' if language=='de' else 'de')
        pw.expect(badge).to_have_class('status-badge badge-warning')
        page.locator('#language').select_option(language)
        assert held
        held.pop().fulfill(content_type='application/json',body=json.dumps(dict(success=True,authenticated=False,message='Expired')))
        pw.expect(badge).to_have_class('status-badge badge-danger')
        pw.expect(badge).to_have_text(tr('Nicht angemeldet'))
        page.wait_for_function("badge.text==='' && badge.color?.join(',')==='220,38,38,255'")
        login=page.get_by_role('link',name=tr('Bei ILIAS anmelden'),exact=True)
        pw.expect(login).to_be_visible()
        assert login.bounding_box()['height']>=48 and login.bounding_box()['width']>=260
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=f'.pytest_cache/{directory}-expired-{language}-{scheme}.png')
        page.context.route('https://ilias.unibe.ch/**',lambda route:route.fulfill(content_type='text/html',body='<h1>Mock ILIAS sign in</h1>'))
        with page.expect_popup() as opened:login.click()
        assert opened.value.url.startswith('https://ilias.unibe.ch/')
        opened.value.close()
        mode[0]='valid'
        page.locator('#sync-btn').click()
        pw.expect(badge).to_have_class('status-badge badge-success')
        pw.expect(login).to_be_hidden()
        page.wait_for_function("badge.text==='' && badge.color?.join(',')==='10,172,165,255'")
        mode[0]='error'
        page.locator('#sync-btn').click()
        pw.expect(badge).to_have_class('status-badge badge-warning')
        page.wait_for_function("badge.text==='' && badge.color?.join(',')==='217,119,6,255'")
        pw.expect(login).to_be_hidden()
        page.evaluate('mockCookies=[]')
        page.locator('#sync-btn').click()
        pw.expect(badge).to_have_class('status-badge badge-danger')
        pw.expect(login).to_be_visible()
        pw.expect(page.locator('#sync-btn')).to_be_disabled()
        browser.close()
