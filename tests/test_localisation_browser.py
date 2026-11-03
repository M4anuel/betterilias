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


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
def test_popup_recovers_tabs_without_content_scripts(local_site, directory, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    artifacts = ROOT / 'scratch' / 'extension-handoff-checks'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=320, height=740), color_scheme=scheme)
        page.add_init_script('''
          window.updatedTabs = [];
          window.reloadedTabs = [];
          window.chrome = {
            storage: {local: {get: async () => ({language: %s}), set: async () => {}}},
            cookies: {getAll: async () => [{name:'PHPSESSID',value:'synthetic-cookie'}]},
            tabs: {
              query: async () => [
                {id:1,url:'http://localhost:5173/?semester=HS2026&course=42'},
                {id:2,url:'http://localhost:5173/?semester=FS2026'},
                {id:3,url:'http://localhost:51730/'}
              ],
              sendMessage: async () => {throw Error('No receiver');},
              update: async (id, options) => updatedTabs.push({id, url:options.url}),
              reload: async id => reloadedTabs.push(id)
            }
          };
        ''' % json.dumps(language))
        if directory.endswith('firefox'):
            page.add_init_script('window.browser = window.chrome;')
        issued = []
        fail = [False]
        page.route('**/api/auth/sync', lambda route: route.fulfill(content_type='application/json', body=json.dumps(
            dict(success=True, authenticated=True, session_id='private-session-key', user_name='Test User'))))
        def issue(route):
            assert route.request.headers['x-session-id'] == 'private-session-key'
            if fail[0]:
                route.fulfill(status=503, content_type='application/json', body='{}')
                return
            token = f'single-use-test-code-{len(issued):032d}'
            issued.append(token)
            route.fulfill(content_type='application/json', body=json.dumps(dict(handoff_token=token, expires_in=60)))
        page.route('**/api/auth/mobile-session', issue)
        page.goto(f'{local_site}/{directory}/popup.html')
        pw.expect(page.locator('#feedback-box')).to_have_text(tr['extension.page_connection_needed'])
        assert not issued  # Opening a popup must not navigate app tabs automatically.
        page.locator('#sync-btn').click()
        page.wait_for_function('updatedTabs.length === 2')
        updates = page.evaluate('updatedTabs')
        assert [update['id'] for update in updates] == [1, 2]
        assert page.evaluate('reloadedTabs') == [1, 2]
        assert len(set(issued)) == 2
        assert 'semester=HS2026&course=42' in updates[0]['url']
        assert 'semester=FS2026' in updates[1]['url']
        for update, token in zip(updates, issued):
            assert f'#connect={token}' in update['url']
            assert 'private-session-key' not in update['url']
        fail[0] = True
        page.locator('#sync-btn').click()
        pw.expect(page.locator('#feedback-box')).to_have_text(tr['extension.page_connection_failed'])
        pw.expect(page.locator('#ilias-status-badge')).to_have_text(tr['Synchronisiert'])
        assert len(page.evaluate('updatedTabs')) == 2
        for width, height in [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (844, 390)]:
            page.set_viewport_size(dict(width=width, height=height))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('#sync-btn').bounding_box()['height'] >= 44
            assert page.locator('#open-app-btn').bounding_box()['height'] >= 44
            page.screenshot(path=str(artifacts / f'{directory.split("/")[-1]}-{language}-{scheme}-{width}.png'))
        browser.close()


@pytest.fixture
def local_site():
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if path.startswith(('/extensions/chrome/', '/extensions/firefox/')):
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


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
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
        opened = []
        page.evaluate('() => { chrome.tabs.create = ({url}) => { window.openedAppUrl = url; }; }')
        def handoff(route):
            assert route.request.method == 'POST'
            assert route.request.headers['x-session-id'] == 'test-key'
            route.fulfill(content_type='application/json', body=json.dumps({
                'handoff_token': 'short-lived-connect-code_0123456789', 'expires_in': 60}))
        page.route('**/api/auth/mobile-session', handoff)
        page.locator('#open-app-btn').click()
        page.wait_for_function('window.openedAppUrl')
        opened.append(page.evaluate('window.openedAppUrl'))
        assert '#connect=short-lived-connect-code_0123456789' in opened[0]
        assert 'test-key' not in opened[0] and 'session_id' not in opened[0]
        browser.close()


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_connection_panel_resizes_without_losing_address(local_site, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    artifacts = ROOT / 'scratch' / 'session-browser-checks'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme=scheme)
        page.add_init_script('localStorage.setItem("betterilias_language", ' + json.dumps(language) + ');'
            'localStorage.setItem("betterilias_theme_mode", ' + json.dumps(scheme) + ');'
            'localStorage.setItem("betterilias_session_id", "responsive-session");')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def respond(route):
            path = urlparse(route.request.url).path
            if path.endswith('/status'):
                data = dict(authenticated=True, cookies_present=True, session_id='responsive-session')
            elif path.endswith('/mobile-session'):
                data = dict(handoff_token='responsive-one-use-code_0123456789', expires_in=60)
            else:
                data = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
            route.fulfill(content_type='application/json', body=json.dumps(data))
        page.route('**/api/**', respond)
        page.goto(local_site)
        page.get_by_role('button', name=tr['Design & Einstellungen'], exact=True).click()
        page.get_by_role('button', name=tr['QR-Code anzeigen'], exact=True).click()
        field = page.get_by_label(tr['BetterIlias-Adresse für das Handy'], exact=True)
        field.fill('https://betterilias.test/')
        panel = page.locator('dialog[open]')
        for width, height in [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (844, 390)]:
            page.set_viewport_size(dict(width=width, height=height))
            pw.expect(field).to_have_value('https://betterilias.test/')
            pw.expect(page.get_by_text(tr['auth.handoff_hint'], exact=True)).to_be_visible()
            field.scroll_into_view_if_needed()
            page.wait_for_function('''() => {
                const r = document.querySelector('dialog[open]').getBoundingClientRect();
                return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
            }''')
            bounds = panel.bounding_box()
            assert bounds and bounds['x'] >= 0 and bounds['y'] >= 0
            assert bounds['x'] + bounds['width'] <= width + 1
            assert bounds['y'] + bounds['height'] <= height + 1
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(artifacts / f'{language}-{scheme}-{width}-{height}.png'))
        # Removing manual login leaves extension instructions as the sole login UI.
        page.get_by_text(tr['Browser-Erweiterung'], exact=True).click()
        pw.expect(page.get_by_role('heading', name=tr['BetterIlias Companion'], exact=True)).to_be_visible()
        assert page.locator('.app-overlay').filter(has=page.get_by_role('heading', name=tr['BetterIlias Companion'], exact=True)).locator('input').count() == 0
        assert 'PHPSESSID' not in page.locator('body').inner_text()
        assert errors == []
        browser.close()


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
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
        ''' + f"localStorage.setItem('mock-extension',JSON.stringify({{language:'{language}',autoSyncEnabled:false}}));" + ("globalThis.browser=chrome;" if directory=='extensions/firefox' else ''))
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


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_extension_setup_addresses_copy_and_fit_viewports(local_site, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    artifacts = ROOT / 'scratch' / 'extension-setup-checks'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme=scheme)
        page.add_init_script('localStorage.setItem("betterilias_language", ' + json.dumps(language) + ');'
            'localStorage.setItem("betterilias_theme_mode", ' + json.dumps(scheme) + ');'
            'Object.defineProperty(navigator, "clipboard", {value: {writeText: async text => {'
            'if (window.rejectCopy) throw Error("denied"); window.copiedAddress = text;}}});')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def respond(route):
            if urlparse(route.request.url).path.endswith('/auth/status'):
                route.fulfill(content_type='application/json', body='{"authenticated":false,"cookies_present":false}')
            else:
                route.fulfill(status=401, content_type='application/json', body='{"detail":"Unauthenticated"}')
        page.route('**/api/**', respond)
        page.goto(local_site)
        trigger = page.get_by_role('button', name=tr['Browser-Erweiterung'], exact=True)
        trigger.click()
        panel = page.get_by_role('dialog', name=tr['BetterIlias Companion'])
        for width, height in [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (844, 390)]:
            page.set_viewport_size(dict(width=width, height=height))
            for browser_name, addresses in [('Chrome / Edge / Brave', ['chrome://extensions', 'edge://extensions']),
                                             ('Mozilla Firefox', ['about:debugging#/runtime/this-firefox'])]:
                panel.get_by_role('button', name=tr[browser_name], exact=True).click()
                for address in addresses:
                    label = tr['extension.setup.copy_address'].replace('{address}', address)
                    control = panel.get_by_role('button', name=label, exact=True)
                    control.click()
                    assert page.evaluate('window.copiedAddress') == address
                    pw.expect(panel.get_by_role('status')).to_have_text(tr['Kopiert!'])
                    bounds = control.bounding_box()
                    assert bounds and bounds['height'] >= 44 and bounds['x'] >= 0
                    assert bounds['x'] + bounds['width'] <= width
                expected = 'firefox' if browser_name == 'Mozilla Firefox' else 'chrome'
                assert panel.locator(f'a[href="https://github.com/M4anuel/betterilias/tree/main/extensions/{expected}"]').count() == 2
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                close = panel.get_by_role('button', name=tr['Schliessen'], exact=True).first
                pw.expect(close).to_be_in_viewport()
                page.screenshot(path=str(artifacts / f'{language}-{scheme}-{width}-{height}-{expected}.png'))
        page.evaluate('window.rejectCopy = true')
        panel.get_by_role('button', name=tr['extension.setup.copy_address'].replace('{address}', 'about:debugging#/runtime/this-firefox'), exact=True).click()
        pw.expect(panel.get_by_role('status')).to_have_text(tr['extension.setup.copy_failed'])
        page.keyboard.press('Escape')
        pw.expect(panel).to_have_count(0)
        pw.expect(trigger).to_be_focused()
        assert errors == []
        browser.close()
