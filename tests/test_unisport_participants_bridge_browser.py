"""Actual Chrome/Firefox sources, isolated profiles and synthetic website cookies."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from tests.test_unisport_bridge_browser import make_extension

ROOT=Path(__file__).resolve().parents[1]
MESSAGE={'scope':'a'*64,'affiliation':'student'}
RPC='''const message=arguments[0];return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();const timer=setTimeout(()=>reject(Error('bridge timeout')),8000);
  const listen=e=>{if(e.source===window&&e.data?.type==='UNISPORT_REPLY'&&e.data.requestId===requestId){clearTimeout(timer);removeEventListener('message',listen);resolve(e.data)}};
  addEventListener('message',listen);postMessage({...message,requestId},location.origin);
});'''


@pytest.fixture
def website():
    reads=[];control={'mode':'ok'}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith('/usp/'):
                reads.append({'path':self.path,'cookie':self.headers.get('Cookie'),'authorization':self.headers.get('Authorization')})
                if control['mode']=='redirect':
                    self.send_response(302);self.send_header('Location','/login');self.end_headers();return
                if control['mode']=='large':body=b'x'*2_000_001
                else:body=b'<table><tr><th>Nachname</th><th>Vorname</th><th>Angebot</th></tr><tr><td>Example</td><td>Ada</td><td>Archery</td></tr></table>'
            else:body=b'<!doctype html><title>Synthetic site</title><p>Browser bridge test</p>'
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers()
            try:self.wfile.write(body)
            except (BrokenPipeError,ConnectionResetError):pass
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    yield f'http://127.0.0.1:{server.server_port}',reads,control
    server.shutdown();server.server_close()


def extension(tmp_path,origin,firefox=False):
    directory=make_extension(tmp_path,origin,firefox)
    manifest=json.loads((directory/'manifest.json').read_text());manifest['permissions'].append('cookies')
    if firefox:manifest['background']['scripts'].append('unisport-participants.js')
    else:
        manifest['background']['service_worker']='worker.js'
        (directory/'worker.js').write_text("importScripts('unisport.js','unisport-participants.js');")
    (directory/'manifest.json').write_text(json.dumps(manifest))
    source=(ROOT/'extensions'/('firefox' if firefox else 'chrome')/'unisport-participants.js').read_text(encoding='utf8')
    (directory/'unisport-participants.js').write_text(source.replace('https://www.zssw.unibe.ch',origin).replace("'zssw.unibe.ch'","'127.0.0.1'"),encoding='utf8')
    return directory


@pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in installed Chromium extension')
def test_chromium_participants_cookie_session_fetch_bounds_and_trusted_sender(tmp_path,website):
    pw=pytest.importorskip('playwright.sync_api');origin,reads,control=website
    directory=extension(tmp_path,origin)
    with pw.sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
            args=[f'--disable-extensions-except={directory}',f'--load-extension={directory}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            await_setup=context.new_page();await_setup.goto('chrome-extension://'+worker.url.split('/')[2]+'/setup.html')
            await_setup.wait_for_function('()=>document.body.dataset.ready==="1"')
            context.add_cookies([{'url':origin,'name':'PHPSESSID','value':'synthetic-account-A','httpOnly':True,'sameSite':'Lax'}])
            owner=context.new_page();owner.goto(origin+'/owner')
            owner.wait_for_timeout(150)
            invoke=lambda data:owner.evaluate('(message)=>{'+RPC.replace('const message=arguments[0];','')+'}',data)
            first=invoke({'type':'UNISPORT_PARTICIPANTS_CONTEXT',**MESSAGE})
            assert first['success'] and len(first['data']['context'])==64
            result=invoke({'type':'UNISPORT_PARTICIPANTS_READ',**MESSAGE,'course':'3003','context':first['data']['context'],'url':'https://untrusted.invalid/'})
            assert result['success'] and 'Example' in result['data']['html']
            assert 'synthetic-account-A' not in json.dumps(result)
            assert reads==[{'path':'/usp/zms/aii/anmeldeliste/3003/index_ger.html','cookie':'PHPSESSID=synthetic-account-A','authorization':None}]
            denied=await_setup.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':'UNISPORT_PARTICIPANTS_CONTEXT',**MESSAGE})
            assert not denied['success'] and len(reads)==1
            # A website session may also live below / rather than at the root.
            context.add_cookies([{'url':origin+'/usp/zms/aii/anmeldeliste/3003/','name':'scoped-session','value':'synthetic-scoped','sameSite':'Lax'}])
            scoped=invoke({'type':'UNISPORT_PARTICIPANTS_CONTEXT',**MESSAGE})
            assert scoped['data']['context']!=first['data']['context']
            context.add_cookies([{'url':origin,'name':'PHPSESSID','value':'synthetic-account-B','httpOnly':True,'sameSite':'Lax'}])
            second=invoke({'type':'UNISPORT_PARTICIPANTS_CONTEXT',**MESSAGE})
            assert second['data']['context']!=first['data']['context']
            stale=invoke({'type':'UNISPORT_PARTICIPANTS_READ',**MESSAGE,'course':'3003','context':first['data']['context']})
            assert not stale['success'] and len(reads)==1
            for mode in ['redirect','large']:
                control['mode']=mode
                result=invoke({'type':'UNISPORT_PARTICIPANTS_READ',**MESSAGE,'course':'3003','context':second['data']['context']})
                assert not result['success'] and 'html' not in (result.get('data') or {})
            assert worker.evaluate('chrome.storage.session.get(null)')=={}
            owner.evaluate("localStorage.setItem('betterilias_ilias_source','unisport');localStorage.setItem('betterilias_session_id','synthetic-token-session')")
            worker.evaluate("chrome.storage.local.set({sessionId:'synthetic-browser-session'})")
            owner.reload();owner.wait_for_timeout(100)
            assert owner.evaluate("localStorage.getItem('betterilias_session_id')")=='synthetic-token-session'
            tab_id=worker.evaluate('(url)=>chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===url).id)',owner.url)
            worker.evaluate('(tab)=>chrome.tabs.sendMessage(tab,{type:"BETTERILIAS_SESSION_SYNCED",sessionId:"synthetic-automatic-session"})',tab_id)
            assert owner.evaluate("localStorage.getItem('betterilias_session_id')")=='synthetic-token-session'
            worker.evaluate('(tab)=>chrome.tabs.sendMessage(tab,{type:"BETTERILIAS_SESSION_SYNCED",sessionId:"synthetic-manual-session",manual:true})',tab_id)
            assert owner.evaluate("localStorage.getItem('betterilias_session_id')")=='synthetic-manual-session'
            assert owner.evaluate("localStorage.getItem('betterilias_ilias_source')") is None
            # Website login is a real top-level SAML navigation, not a fetch of
            # the identity chooser or an API affiliation pretending to log in.
            control['mode']='redirect'
            owner.evaluate("window.loginResults=[];addEventListener('message',e=>{if(e.data?.type==='UNISPORT_PARTICIPANTS_LOGIN_FINISHED')loginResults.push(e.data)})")
            assert not invoke({'type':'UNISPORT_PARTICIPANTS_LOGIN',**MESSAGE,'course':'../login'})['success']
            assert invoke({'type':'UNISPORT_PARTICIPANTS_LOGIN',**MESSAGE,'course':'3003','url':'https://untrusted.invalid/'})['success']
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                login=next((tab for tab in context.pages if tab.url==origin+'/login'),None)
                if login:break
                owner.wait_for_timeout(50)
            assert login and owner.evaluate('loginResults')==[]
            saved=worker.evaluate('chrome.storage.session.get(null)')
            assert len(saved)==1 and 'credential' not in next(iter(saved.values()))
            # Returning to an unrelated page must not finish the transaction.
            login.goto(origin+'/unrelated');owner.wait_for_timeout(100)
            assert owner.evaluate('loginResults')==[]
            control['mode']='ok'
            with login.expect_event('close'):
                login.goto(origin+'/usp/zms/aii/anmeldeliste/3003/index_ger.html',wait_until='commit')
            owner.wait_for_function('()=>loginResults.length===1')
            assert owner.evaluate('loginResults[0]')=={'type':'UNISPORT_PARTICIPANTS_LOGIN_FINISHED',**MESSAGE,'success':True}
            assert worker.evaluate('chrome.storage.session.get(null)')=={}
            # Closing the login tab reports cancellation; it never authenticates.
            control['mode']='redirect'
            assert invoke({'type':'UNISPORT_PARTICIPANTS_LOGIN',**MESSAGE,'course':'3003'})['success']
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                login=next((tab for tab in context.pages if tab.url==origin+'/login'),None)
                if login:break
                owner.wait_for_timeout(50)
            assert login
            login.close();owner.wait_for_function('()=>loginResults.length===2')
            assert owner.evaluate('loginResults[1].success') is False
        finally:context.close()


@pytest.mark.skipif(os.environ.get('BETTERILIAS_FIREFOX_TESTS')!='1',reason='Opt-in native Firefox extension')
def test_firefox_participants_use_owned_browser_cookie_store_and_page_bridge(tmp_path,website):
    Marionette=pytest.importorskip('marionette_driver.marionette').Marionette
    Addons=pytest.importorskip('marionette_driver.addons').Addons
    binary=os.environ.get('BETTERILIAS_FIREFOX_BINARY') or shutil.which('firefox') or 'C:/Program Files/Mozilla Firefox/firefox.exe'
    if not Path(binary).exists():pytest.skip('Native Firefox not installed')
    origin,reads,control=website;directory=extension(tmp_path,origin,True);package=tmp_path/'extension.xpi'
    with zipfile.ZipFile(package,'w') as archive:
        for file in directory.iterdir():archive.write(file,file.name)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    profile=tmp_path/'profile';profile.mkdir();uuid='579fe125-99db-485e-b398-c2fa87aeb341'
    prefs={'marionette.port':port,'browser.shell.checkDefaultBrowser':False,'browser.startup.homepage_override.mstone':'ignore',
        'browser.startup.page':0,'extensions.webextensions.uuids':json.dumps({'unisport-test@betterilias.ch':uuid})}
    (profile/'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+','+json.dumps(v)+');' for k,v in prefs.items()))
    process=subprocess.Popen([binary,'-headless','-no-remote','-profile',str(profile),'-marionette'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        env={**os.environ,'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS':'1'},creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    client=None
    try:
        client=Marionette(host='127.0.0.1',port=port);client.start_session(timeout=30);Addons(client).install(str(package),temp=True)
        setup='moz-extension://'+uuid+'/setup.html'
        with client.using_context('chrome'):
            client.execute_script('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});',script_args=[setup])
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if client.execute_script('return location.href===arguments[0]&&document.body?.dataset.ready==="1"',script_args=[setup]):break
            time.sleep(.1)
        client.navigate(origin+'/owner');client.add_cookie({'name':'PHPSESSID','value':'synthetic-firefox-account','path':'/','httpOnly':True})
        time.sleep(.15)
        def invoke(data):
            script=RPC.replace('return new Promise','new Promise').strip().removesuffix(';')
            return client.execute_async_script('const done=arguments[arguments.length-1];'+script+'.then(done,()=>done({success:false,timeout:true}));',script_args=[data])
        first=invoke({'type':'UNISPORT_PARTICIPANTS_CONTEXT',**MESSAGE})
        assert first['success'],first
        result=invoke({'type':'UNISPORT_PARTICIPANTS_READ',**MESSAGE,'course':'3003','context':first['data']['context']})
        assert result['success'] and 'Example' in result['data']['html'],result
        assert reads==[{'path':'/usp/zms/aii/anmeldeliste/3003/index_ger.html','cookie':'PHPSESSID=synthetic-firefox-account','authorization':None}]
        assert 'synthetic-firefox-account' not in json.dumps(result)
    finally:
        if client:
            try:client.delete_session()
            except Exception:pass
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait()
