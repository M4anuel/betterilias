"""Opt-in native Firefox checks with an isolated profile and synthetic cookies.

Requires marionette_driver and BETTERILIAS_FIREFOX_TESTS=1. Uses the installed
Firefox binary (or BETTERILIAS_FIREFOX_BINARY); never opens a user's profile.
"""
import json
import os
import shutil
import socket
import subprocess
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from urllib.parse import urlsplit, unquote

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_FIREFOX_TESTS') != '1', reason='Opt-in installed Firefox checks')


@pytest.mark.parametrize('language', ['de', 'en'])
def test_native_firefox_sync_errors_timeout_retry_and_handoff(tmp_path, language):
    Marionette = pytest.importorskip('marionette_driver.marionette').Marionette
    Addons = pytest.importorskip('marionette_driver.addons').Addons
    binary = os.environ.get('BETTERILIAS_FIREFOX_BINARY') or shutil.which('firefox') or 'C:/Program Files/Mozilla Firefox/firefox.exe'
    if not Path(binary).is_file():
        pytest.skip('Firefox binary unavailable')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    mode = ['valid']
    requests = []
    session_id = ['isolated-firefox-session']
    course_credentials = []
    build = ROOT / 'frontend/dist'
    if not (build / 'index.html').is_file():
        pytest.skip('Build the frontend before running the native Firefox app check')
    release = Event()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(payload)
            current = mode[0]
            if current == 'stalled':
                release.wait(30)
            status = 401 if current == 'expired' else 503 if current == 'unavailable' else 200
            body = json.dumps(dict(success=True, authenticated=True, session_id=session_id[0], user_name='Test User') if status == 200 else {}).encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # The popup correctly aborts a stalled request.

        def do_GET(self):
            path = urlsplit(self.path).path
            status, content_type = 200, 'application/json'
            authenticated = self.headers.get('X-Session-Id') == session_id[0]
            if path == '/bridge-test.js':
                # Exercise the custom DOM event independently of postMessage,
                # whose source differs across Firefox versions/privilege contexts.
                content_type = 'text/javascript'
                body = (f"localStorage.setItem('betterilias_language', {json.dumps(language)});"
                    f"localStorage.setItem('betterilias_theme_mode', {json.dumps('dark' if language == 'de' else 'light')});"
                    "window.addEventListener('message', event => { if (event.data?.type === 'BETTERILIAS_SESSION_SYNCED') event.stopImmediatePropagation(); });").encode()
            elif path == '/api/auth/status':
                body = json.dumps(dict(authenticated=authenticated, cookies_present=authenticated)).encode()
            elif path == '/api/dashboard/semesters':
                course_credentials.append(self.headers.get('X-Session-Id'))
                status = 200 if authenticated else 401
                body = json.dumps(dict(active_semester='HS2026', available_semesters=['HS2026'],
                    courses=[dict(ref_id='42', title='Firefox live sync course', url='https://ilias.unibe.ch/goto.php?target=crs_42', item_type='crs', semester='HS2026')],
                    grouped_by_category={}) if authenticated else dict(detail='Unauthenticated')).encode()
            elif path.startswith('/api/'):
                body = b'{}'
            else:
                asset = (build / unquote(path).lstrip('/')).resolve()
                if not asset.is_relative_to(build.resolve()):
                    self.send_error(404)
                    return
                if not asset.is_file():
                    asset = build / 'index.html'
                body = asset.read_bytes()
                content_type = {'.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml'}.get(asset.suffix, 'text/html')
                if asset.name == 'index.html':
                    body = body.replace(b'<head>', b'<head><script src="/bridge-test.js"></script>')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    unrelated_server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=unrelated_server.serve_forever, daemon=True).start()
    server_url = f'http://127.0.0.1:{server.server_port}'
    uuid = 'ce8cd159-6dc0-4239-9d56-78280234a412'
    profile = tmp_path / 'profile'
    profile.mkdir()
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    prefs = {'marionette.port': port, 'browser.shell.checkDefaultBrowser': False,
             'browser.startup.page': 0, 'browser.startup.homepage_override.mstone': 'ignore',
             'extensions.webextensions.uuids': json.dumps({'betterilias-companion@m4anuel.ch': uuid})}
    (profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k, v in prefs.items()))
    package = tmp_path / 'companion.xpi'
    with zipfile.ZipFile(package, 'w') as archive:
        for path in (ROOT / 'extensions/firefox').rglob('*'):
            if path.is_file():
                archive.write(path, path.relative_to(ROOT / 'extensions/firefox'))
        # Keep the production manifest/permissions intact. Only seed isolated
        # extension settings and a synthetic cookie before opening its popup.
        archive.writestr('harness.html', '<!doctype html><script src="harness.js"></script>')
        archive.writestr('harness.js', '''(async () => {
          await browser.storage.local.set({language: %s, autoSyncEnabled: false, serverUrl: %s, frontendUrl: %s});
          await browser.cookies.set({url:'https://ilias.unibe.ch/', name:'PHPSESSID', value:'synthetic-firefox-cookie', secure:true});
          location.href='popup.html';
        })().catch(error => { document.body.textContent=error.message; });''' % (json.dumps(language), json.dumps(server_url), json.dumps(server_url)))

    client = None
    with (tmp_path / 'firefox.log').open('w') as log:
        process = subprocess.Popen([binary, '--headless', '--no-remote', '--profile', str(profile), '--marionette'],
                                   stdout=log, stderr=log, env={**os.environ, 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1'})
        try:
            client = Marionette(port=port, startup_timeout=30)
            client.raise_for_port(timeout=30)
            client.start_session()
            Addons(client).install(str(package), temp=True)

            def navigate(url):
                with client.using_context('chrome'):
                    client.execute_script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});', script_args=[url])
                if not url.endswith('/harness.html'):
                    wait_for('return location.href.split(/[?#]/)[0] === ' + json.dumps(url) + ' && document.readyState === "complete";')

            def wait_for(script, timeout=10):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    try:
                        if client.execute_script(script):
                            return
                    except Exception as error:
                        if 'SecurityError' not in str(error):
                            raise
                    time.sleep(.1)
                pytest.fail('Firefox condition timed out: ' + script)

            def expect_status(status, timeout=10):
                wait_for('return document.getElementById("ilias-status-badge")?.textContent === ' + json.dumps(tr[status]) + ';', timeout)

            def retry():
                wait_for('return document.getElementById("sync-btn")?.disabled === false;')
                client.execute_script('document.getElementById("sync-btn").click();')

            navigate(f'moz-extension://{uuid}/harness.html')
            expect_status('Synchronisiert')
            assert requests and requests[-1]['source'] == 'firefox_extension'
            assert requests[-1]['cookies']['PHPSESSID'] == 'synthetic-firefox-cookie'
            mode[0] = 'expired'
            retry()
            expect_status('Nicht angemeldet')
            mode[0] = 'unavailable'
            retry()
            expect_status('Nicht verifiziert')
            mode[0] = 'stalled'
            retry()
            expect_status('Prüfe...')
            expect_status('Nicht verifiziert', timeout=25)
            release.set()
            mode[0] = 'valid'
            retry()
            expect_status('Synchronisiert')
            # Actual content script, Firefox Xray boundaries and native storage.
            navigate(server_url + '/')
            wait_for('return localStorage.getItem("betterilias_session_id") === "isolated-firefox-session";')
            wait_for('return document.body.innerText.includes("Firefox live sync course");')
            app_handle = client.current_window_handle
            popup_handle = client.open(type='tab', focus=True)['handle']
            client.switch_to_window(popup_handle)
            session_id[0] = 'rotated-firefox-session'
            navigate(f'moz-extension://{uuid}/popup.html')
            expect_status('Synchronisiert')
            client.switch_to_window(app_handle)
            wait_for('return localStorage.getItem("betterilias_session_id") === "rotated-firefox-session";')
            wait_for('return localStorage.getItem("betterilias_cache_owner") === "rotated-firefox-session";')
            wait_for('return document.body.innerText.includes("Firefox live sync course");')
            assert 'rotated-firefox-session' in course_credentials
            assert tr['Sitzung nicht aktiv:'] not in client.execute_script('return document.body.innerText;')
            assert client.execute_script('return document.documentElement.lang;') == language
            (tmp_path / 'live-sync-app.png').write_bytes(client.screenshot(format='binary'))
            navigate(f'http://127.0.0.1:{unrelated_server.server_port}/')
            time.sleep(.5)
            assert client.execute_script('return localStorage.getItem("betterilias_session_id");') is None
        finally:
            release.set()
            if client:
                try:
                    client.quit()
                except Exception:
                    pass
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=15)
            server.shutdown()
            server.server_close()
            unrelated_server.shutdown()
            unrelated_server.server_close()
