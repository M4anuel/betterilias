"""Installed Chrome Companion: popup -> synthetic SWITCH -> affiliation -> app.

Only the fixed SWITCH origin is substituted in an isolated extension copy.
Backend crypto/token checks are covered separately; no live credentials are used.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import time
import socket
import subprocess
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest

ROOT=Path(__file__).resolve().parents[1]
CALLBACK='ch.unibe.campusapp://campusapp.unibe.ch'
pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in installed Companion workflow')


@pytest.mark.parametrize('engine',['chrome','firefox'])
def test_installed_companion_performs_shared_login_and_preserves_app_selection(tmp_path,engine):
    if engine=='firefox' and os.environ.get('BETTERILIAS_FIREFOX_TESTS')!='1':pytest.skip('Opt-in native Firefox')
    calls=[];connections={}
    class Handler(BaseHTTPRequestHandler):
        def reply(self,value):
            body=json.dumps(value).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
        def do_GET(self):
            path=urlsplit(self.path).path
            if path.endswith('/availability'):self.reply({'enabled':True});return
            if path.endswith('/connection'):
                self.reply(connections.get(self.headers.get('X-Unisport-Session'),{'phase':'disconnected'}));return
            if path=='/idp/profile/oidc/authorize':
                state=parse_qs(urlsplit(self.path).query)['state'][0]
                body=(f'<form method="post" action="{CALLBACK}"><input type="hidden" name="state" value="{state}">'
                    '<input type="hidden" name="code" value="synthetic-code"></form><script>document.forms[0].submit()</script>').encode()
            else:
                body=b'''<!doctype html><title>App</title><script>
                window.activations=[];localStorage.setItem('betterilias_session_id','p'.repeat(43));
                localStorage.setItem('betterilias_cache_owner','p'.repeat(43));localStorage.setItem('ilias_materials_cache_example','retained');
                document.addEventListener('BETTERILIAS_SESSION_SYNCED',e=>activations.push(e.detail));</script>'''
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)
        def do_POST(self):
            credential=self.headers.get('X-Unisport-Session');calls.append((self.path,credential))
            if self.path.endswith('/start'):
                state=secrets.token_urlsafe(32);connections[credential]={'phase':'pending'}
                self.reply({'state':state,'authorization_url':origin+'/idp/profile/oidc/authorize?'+urlencode(dict(
                    client_id='unibe-campusapp',redirect_uri=CALLBACK,response_type='code',response_mode='form_post',
                    code_challenge_method='S256',code_challenge=secrets.token_urlsafe(32),state=state))});return
            if self.path.endswith('/complete'):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert body['callback'].startswith(CALLBACK+'?')
                connections[credential]={'phase':'connected','scope':'a'*64,'user_name':'Synthetic Student',
                    'affiliation':None,'affiliations':['private-member@unibe.ch'],'expires_at':time.time()+600}
                self.reply({'connected':True});return
            if self.path.endswith('/ilias-connection'):
                assert self.headers['X-Session-Id']=='p'*43
                assert self.headers['X-Unisport-Affiliation']=='private-member@unibe.ch'
                self.reply({'authenticated':True,'session_id':'p'*43,'user_name':'Synthetic Student','renewed':True});return
            self.send_error(404)
        def do_PUT(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert body['affiliation']=='private-member@unibe.ch'
            connections[self.headers['X-Unisport-Session']]['affiliation']=body['affiliation'];self.reply(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    origin=f'http://127.0.0.1:{server.server_port}'
    Thread(target=server.serve_forever,daemon=True).start()
    extension=tmp_path/'extension';shutil.copytree(ROOT/'extensions'/engine,extension)
    manifest=json.loads((extension/'manifest.json').read_text(encoding='utf-8'))
    for script in manifest['content_scripts']:
        if 'unisport-callback.js' in script['js']:script['matches']=['http://127.0.0.1/*']
    (extension/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    for name in ('unisport.js','unisport-callback.js'):
        p=extension/name;p.write_text(p.read_text(encoding='utf-8').replace('https://login.eduid.ch',origin),encoding='utf-8')
    pw=pytest.importorskip('playwright.sync_api')
    try:
        if engine=='firefox':
            native_firefox(extension,tmp_path,origin,connections,calls)
            return
        with pw.sync_playwright() as p:
            context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
                args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            try:
                worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
                await_settings=worker.evaluate('''async origin=>{
                  await chrome.storage.local.set({serverUrl:origin,frontendUrl:origin,language:'en'});
                  return chrome.runtime.getURL('popup.html');
                }''',origin)
                app=context.new_page();app.goto(origin+'/app')
                popup=context.new_page();popup.goto(await_settings)
                popup.locator('#login-btn').wait_for(state='visible')
                with context.expect_page() as opened:popup.locator('#login-btn').click()
                login=opened.value
                try:login.locator('#account-name').filter(has_text='Synthetic Student').wait_for(timeout=15000)
                except Exception:
                    pytest.fail(json.dumps({'calls':[path for path,_ in calls],'body':login.locator('body').inner_text(),'pages':[page.url for page in context.pages]}))
                assert login.locator('#login-btn').is_hidden()
                tr=json.loads((ROOT/'locales/en.json').read_text(encoding='utf-8'))
                assert login.locator('#affiliation option').all_text_contents()==[tr['unisport.choose_affiliation'],'unibe.ch']
                login.locator('#affiliation').select_option('private-member@unibe.ch')
                login.locator('#connect-btn').click()
                login.get_by_text('ILIAS and UniSport are connected.',exact=True).wait_for()
                app.wait_for_function('activations.some(e=>e.source==="unisport")')
                assert app.evaluate("localStorage.getItem('betterilias_session_id')")=='p'*43
                assert app.evaluate("localStorage.getItem('ilias_materials_cache_example')")=='retained'
                credential=app.evaluate("localStorage.getItem('betterilias_unisport_session')")
                assert len(credential)==43 and connections[credential]['phase']=='connected'
                assert [path for path,_ in calls]==['/api/auth/unibe/start','/api/auth/unibe/complete','/api/auth/unibe/ilias-connection']
                assert all(cap==credential for _,cap in calls)
            finally:context.close()
    finally:server.shutdown();server.server_close()


def native_firefox(extension,tmp_path,origin,connections,calls):
    Marionette=pytest.importorskip('marionette_driver.marionette').Marionette
    Addons=pytest.importorskip('marionette_driver.addons').Addons
    binary=os.environ.get('BETTERILIAS_FIREFOX_BINARY') or 'C:/Program Files/Mozilla Firefox/firefox.exe'
    if not Path(binary).exists():pytest.skip('Native Firefox is not installed')
    (extension/'setup.html').write_text('<!doctype html><script src="setup.js"></script>')
    (extension/'setup.js').write_text('(async()=>{await browser.storage.local.set({serverUrl:'+json.dumps(origin)+',frontendUrl:'+json.dumps(origin)+',language:"en"});document.documentElement.dataset.ready="1";})();')
    package=tmp_path/'companion.xpi'
    with zipfile.ZipFile(package,'w') as archive:
        for path in extension.rglob('*'):
            if path.is_file():archive.write(path,path.relative_to(extension))
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    profile=tmp_path/'firefox-profile';profile.mkdir()
    uuid='7c3a976b-3140-4edb-a0a1-14399d751e38'
    prefs={'marionette.port':port,'browser.shell.checkDefaultBrowser':False,
        'extensions.webextensions.uuids':json.dumps({'betterilias-companion@betterilias.ch':uuid})}
    (profile/'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+','+json.dumps(v)+');' for k,v in prefs.items()))
    process=subprocess.Popen([binary,'-headless','-no-remote','-profile',str(profile),'-marionette'],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={**os.environ,'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS':'1'})
    client=None
    try:
        client=Marionette(port=port,startup_timeout=30);client.raise_for_port(timeout=30);client.start_session()
        Addons(client).install(str(package),temp=True)
        def wait(script,timeout=20):
            deadline=time.monotonic()+timeout
            while time.monotonic()<deadline:
                if client.execute_script(script):return
                time.sleep(.1)
            pytest.fail('Firefox shared-login condition timed out: '+script+'; calls='+repr([path for path,_ in calls]))
        def navigate(url):
            with client.using_context('chrome'):
                client.execute_script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',script_args=[url])
            wait('return location.href==='+json.dumps(url)+' && document.readyState==="complete";')
        navigate(f'moz-extension://{uuid}/setup.html');wait('return document.documentElement.dataset.ready==="1";')
        app=client.open(type='tab',focus=True)['handle'];client.switch_to_window(app);navigate(origin+'/app')
        login=client.open(type='tab',focus=True)['handle'];client.switch_to_window(login);navigate(f'moz-extension://{uuid}/popup.html?login=1')
        wait('return document.getElementById("account-name")?.textContent==="Synthetic Student";')
        client.execute_script('const field=document.getElementById("affiliation");field.value="private-member@unibe.ch";field.dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("connect-btn").click();')
        wait('return document.getElementById("feedback-box")?.textContent==="ILIAS and UniSport are connected.";')
        client.switch_to_window(app)
        wait('return window.wrappedJSObject.activations.some(e=>e.source==="unisport");')
        assert client.execute_script('return localStorage.getItem("betterilias_session_id");')=='p'*43
        assert client.execute_script('return localStorage.getItem("ilias_materials_cache_example");')=='retained'
        credential=client.execute_script('return localStorage.getItem("betterilias_unisport_session");')
        assert connections[credential]['phase']=='connected'
        assert [path for path,_ in calls]==['/api/auth/unibe/start','/api/auth/unibe/complete','/api/auth/unibe/ilias-connection']
    finally:
        if client:
            try:client.quit()
            except Exception:pass
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait()
