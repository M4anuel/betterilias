"""Real companion sources with an isolated synthetic provider and backend.

Only the pinned provider origin is substituted in a temporary extension copy.
No SWITCH login, passwords, tokens or personal profile is used by these tests.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
CALLBACK = 'ch.unibe.campusapp://campusapp.unibe.ch'


@pytest.fixture
def bridge_site():
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            query = parse_qs(url.query)
            state = query.get('state', [''])[0]
            flow = query.get('flow', ['pending'])[0]
            callback = CALLBACK + '?' + urlencode(dict(code='synthetic-code', state=state))
            if flow == 'redirect':
                self.send_response(302); self.send_header('Location', callback); self.end_headers(); return
            if flow == 'form':
                body = (f'<form method="post" action="{CALLBACK}"><input type="hidden" name="code" value="synthetic-code">'
                    f'<input type="hidden" name="state" value="{state}"></form><script>document.forms[0].submit()</script>').encode()
            elif url.path == '/owner.js':
                body = b'''window.replies=[];addEventListener('message',e=>{replies.push({...e.data,sourceSame:e.source===window,eventOrigin:e.origin});document.querySelector('output').textContent=JSON.stringify(replies)});
                  document.querySelector('button').onclick=()=>postMessage(JSON.parse(new URL(location.href).searchParams.get('message')),location.origin);'''
            else:
                body = b'<!doctype html><title>Synthetic UniSport bridge</title><button id="start">Start</button><output></output><script src="/owner.js"></script>'
            self.send_response(200); self.send_header('Content-Type', 'text/javascript' if url.path.endswith('.js') else 'text/html'); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(dict(path=self.path, credential=self.headers.get('X-Unisport-Session'), body=body))
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b'{"connected":true}')
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{server.server_port}', calls
    server.shutdown(); server.server_close()


def make_extension(tmp_path, origin, firefox=False):
    root = tmp_path / 'extension'; root.mkdir()
    manifest = dict(manifest_version=3, name='Synthetic UniSport companion regression', version='0.0.1',
        permissions=['storage', 'tabs', 'webRequest'], host_permissions=['http://127.0.0.1/*'],
        background={'scripts': ['unisport.js']} if firefox else {'service_worker': 'unisport.js'},
        content_scripts=[dict(matches=['http://127.0.0.1/*'], js=['content.js', 'unisport-callback.js'], run_at='document_start')])
    if firefox: manifest['browser_specific_settings'] = {'gecko': {'id': 'unisport-test@betterilias.ch'}}
    (root / 'manifest.json').write_text(json.dumps(manifest))
    for name in ('unisport.js', 'unisport-callback.js', 'content.js'):
        source = (ROOT / 'extensions' / ('firefox' if firefox else 'chrome') / name).read_text(encoding='utf-8')
        (root / name).write_text(source.replace('https://login.eduid.ch', origin), encoding='utf-8')
    # Extension page sets configuration before the web bridge is used.
    (root / 'setup.html').write_text('<!doctype html><title>Setup</title><body><script src="setup.js"></script>')
    (root / 'setup.js').write_text('(async()=>{const api=typeof browser!=="undefined"?browser:chrome;'
        'await api.storage.local.set({serverUrl:' + json.dumps(origin) + ',frontendUrl:' + json.dumps(origin) + '});document.body.dataset.ready="1";})();')
    return root


def transaction(origin, flow):
    state = secrets.token_urlsafe(32)
    return dict(type='UNISPORT_START', requestId='synthetic-start', credential=secrets.token_urlsafe(32), state=state,
        authorization_url=origin + '/idp/profile/oidc/authorize?' + urlencode(dict(flow=flow, state=state,
        client_id='unibe-campusapp', redirect_uri=CALLBACK, response_type='code', response_mode='form_post', code_challenge_method='S256',
        code_challenge=secrets.token_urlsafe(32), nonce=secrets.token_urlsafe(32))))


@pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in installed Chromium extension')
@pytest.mark.parametrize('flow', ['redirect', 'form'])
@pytest.mark.parametrize('restart', [False, True])
def test_actual_chromium_bridge(tmp_path, bridge_site, flow, restart):
    pw = pytest.importorskip('playwright.sync_api')
    origin, calls = bridge_site
    extension = make_extension(tmp_path, origin)
    with pw.sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(tmp_path / 'profile'), channel='chromium', headless=True,
            args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            owner = context.new_page()
            owner.goto('chrome-extension://' + worker.url.split('/')[2] + '/setup.html')
            owner.evaluate('(origin)=>chrome.storage.local.set({serverUrl:origin,frontendUrl:origin})', origin)
            message = transaction(origin, 'pending' if restart else flow)
            owner.goto(origin + '/owner')
            owner.evaluate('window.replies=[];addEventListener("message",e=>replies.push(e.data))')
            owner.wait_for_timeout(200)
            owner.evaluate('(message)=>postMessage(message,location.origin)', message)
            owner.wait_for_function('replies.some(r=>r.type==="UNISPORT_REPLY"&&r.success)')
            if restart:
                setup = context.new_page(); setup.goto('chrome-extension://' + worker.url.split('/')[2] + '/setup.html')
                pending = setup.evaluate("chrome.storage.session.get(null).then(r=>Object.values(r)[0])")
                assert pending
                cdp = context.new_cdp_session(setup)
                target = next(t for t in cdp.send('Target.getTargets')['targetInfos'] if t['type'] == 'service_worker' and t['url'] == worker.url)
                cdp.send('Target.closeTarget', {'targetId': target['targetId']}); cdp.detach()
                setup.evaluate('(url)=>chrome.tabs.update(' + str(pending['tab']) + ',{url})', origin + '/login?flow=' + flow + '&state=' + message['state'])
            owner.wait_for_function('replies.some(r=>r.type==="UNISPORT_FINISHED"&&r.success)')
            assert len(calls) == 1 and calls[0]['path'] == '/api/unisport/auth/complete'
            assert calls[0]['credential'] == message['credential']
            assert parse_qs(urlsplit(calls[0]['body']['callback']).query) == {'state': [message['state']], 'code': ['synthetic-code']}
            assert 'code=' not in owner.url
        finally: context.close()


@pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in installed Chromium extension')
@pytest.mark.parametrize('source', ['wrong-state', 'other-tab'])
def test_actual_bridge_rejects_unrelated_callback_and_cancels(tmp_path, bridge_site, source):
    pw=pytest.importorskip('playwright.sync_api'); origin,calls=bridge_site
    extension=make_extension(tmp_path,origin)
    with pw.sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
            args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            setup=context.new_page(); setup.goto('chrome-extension://'+worker.url.split('/')[2]+'/setup.html')
            setup.wait_for_function('document.body.dataset.ready==="1"')
            owner=context.new_page(); owner.goto(origin+'/owner'); owner.wait_for_timeout(200)
            message=transaction(origin,'pending')
            owner.evaluate('(message)=>postMessage(message,location.origin)',message)
            owner.wait_for_function('replies.some(r=>r.type==="UNISPORT_REPLY"&&r.success)')
            pending=setup.evaluate('chrome.storage.session.get(null).then(r=>Object.values(r)[0])')
            callback=origin+'/login?flow=form&state='+('unrelated' if source=='wrong-state' else message['state'])
            if source=='wrong-state': setup.evaluate('(url)=>chrome.tabs.update('+str(pending['tab'])+',{url})',callback)
            else: context.new_page().goto(callback, wait_until='commit')
            owner.wait_for_timeout(600)
            assert calls==[]
            assert setup.evaluate('chrome.storage.session.get(null).then(r=>Object.values(r).length)')==1
            owner.evaluate('postMessage({type:"UNISPORT_CANCEL",requestId:"cancel"},location.origin)')
            owner.wait_for_function('replies.some(r=>r.requestId==="cancel"&&r.success)')
            assert setup.evaluate('chrome.storage.session.get(null).then(r=>Object.values(r).length)')==0
            assert calls==[]
        finally: context.close()


@pytest.mark.skipif(os.environ.get('BETTERILIAS_FIREFOX_TESTS') != '1', reason='Opt-in native Firefox extension')
@pytest.mark.parametrize('flow', ['form'])
def test_actual_firefox_bridge(tmp_path, bridge_site, flow):
    Marionette = pytest.importorskip('marionette_driver.marionette').Marionette
    Addons = pytest.importorskip('marionette_driver.addons').Addons
    binary = os.environ.get('BETTERILIAS_FIREFOX_BINARY') or shutil.which('firefox') or 'C:/Program Files/Mozilla Firefox/firefox.exe'
    if not Path(binary).exists(): pytest.skip('Native Firefox not installed')
    origin, calls = bridge_site
    extension = make_extension(tmp_path, origin, firefox=True)
    package = tmp_path / 'extension.xpi'
    with zipfile.ZipFile(package, 'w') as archive:
        for file in extension.iterdir(): archive.write(file, file.name)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    profile = tmp_path / 'profile'; profile.mkdir()
    uuid = '579fe125-99db-485e-b398-c2fa87aeb341'
    prefs = {'marionette.port': port, 'browser.shell.checkDefaultBrowser': False,
        'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0,
        'extensions.webextensions.uuids': json.dumps({'unisport-test@betterilias.ch': uuid})}
    (profile / 'user.js').write_text('\n'.join('user_pref(' + json.dumps(k) + ',' + json.dumps(v) + ');' for k,v in prefs.items()))
    process = subprocess.Popen([binary, '-headless', '-no-remote', '-profile', str(profile), '-marionette'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1'})
    client = None
    try:
        client = Marionette(host='127.0.0.1', port=port)
        client.start_session(timeout=30)
        Addons(client).install(str(package), temp=True)
        setup = 'moz-extension://' + uuid + '/setup.html'
        with client.using_context('chrome'):
            client.execute_script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});', script_args=[setup])
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if client.execute_script('return location.href===arguments[0] && document.body?.dataset.ready==="1"', script_args=[setup]): break
            time.sleep(.1)
        message = transaction(origin, flow)
        client.navigate(origin + '/owner?' + urlencode({'message':json.dumps(message)}))
        time.sleep(0.2)
        client.find_element('id', 'start').click()
        deadline = time.monotonic() + 20
        while not calls and time.monotonic() < deadline: time.sleep(0.1)
        assert len(calls) == 1 and calls[0]['credential'] == message['credential'], client.execute_script('return document.body.textContent')
        assert calls[0]['path'] == '/api/unisport/auth/complete'
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            results = client.execute_script('return document.querySelector("output").textContent')
            replies = json.loads(results or '[]')
            if any(r.get('type') == 'UNISPORT_FINISHED' for r in replies): break
            time.sleep(.1)
        assert any(r.get('type') == 'UNISPORT_FINISHED' and r.get('success') and r.get('sourceSame') and r.get('eventOrigin') == origin for r in replies), replies
    finally:
        if client:
            try: client.delete_session()
            except Exception: pass
        process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
