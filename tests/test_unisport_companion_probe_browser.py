"""Installed-MV3 feasibility probe, synthetic loopback provider only.

Does not load a real account, visit SWITCH, exchange tokens or alter production
extensions. Passing establishes callback observation, not production login support.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlsplit

import pytest

pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in installed extension probe')
CALLBACK='ch.unibe.campusapp://campusapp.unibe.ch'


@pytest.fixture
def provider():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed=urlsplit(self.path);state=parse_qs(parsed.query).get('state',[''])[0]
            callback=CALLBACK+'?code=synthetic-code&state='+state
            if parsed.path=='/pending':
                self.send_response(200);self.end_headers();self.wfile.write(b'Waiting for synthetic login');return
            if parsed.path=='/redirect':
                self.send_response(302);self.send_header('Location',callback);self.end_headers();return
            body=('''<!doctype html><form method="post" action="'''+CALLBACK+'''">
              <input type="hidden" name="code" value="synthetic-code">
              <input type="hidden" name="state" value="'''+state+'''">
              </form><script>document.forms[0].submit()</script>''').encode()
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
    yield f'http://127.0.0.1:{server.server_port}'
    server.shutdown();server.server_close()


@pytest.fixture
def probe_extension(tmp_path):
    root=tmp_path/'probe';root.mkdir()
    (root/'manifest.json').write_text(json.dumps(dict(manifest_version=3,name='Unisport native callback probe',version='0.0.1',
      permissions=['webRequest','storage','tabs'],host_permissions=['http://127.0.0.1/*'],background=dict(service_worker='background.js'),
      content_scripts=[dict(matches=['http://127.0.0.1/*'],js=['callback.js'],run_at='document_start')])),encoding='utf8')
    (root/'owner.html').write_text('<!doctype html><button id="start" type="button">Start synthetic login</button><script src="owner.js"></script>',encoding='utf8')
    (root/'owner.js').write_text('''document.getElementById('start').addEventListener('click',async()=>{
      const tab=await chrome.tabs.getCurrent();await chrome.runtime.sendMessage({type:'START',owner:tab.id,...window.probe});
    });''',encoding='utf8')
    (root/'background.js').write_text('''const CALLBACK='ch.unibe.campusapp://campusapp.unibe.ch';
      async function pending(){return (await chrome.storage.session.get('pending')).pending;}
      async function capture(url,tab,via){
        const context=await pending();if(!context||context.tab!==tab||context.expires<Date.now())return;
        const parsed=new URL(url);if(parsed.origin!=='null'||parsed.protocol!=='ch.unibe.campusapp:'||parsed.hostname!=='campusapp.unibe.ch'||parsed.pathname||parsed.hash)return;
        if(parsed.searchParams.getAll('state').length!==1||parsed.searchParams.get('state')!==context.state||parsed.searchParams.getAll('code').length!==1)return;
        await chrome.storage.session.remove('pending');
        await chrome.storage.session.set({result:{via,code:parsed.searchParams.get('code'),state:context.state,owner:context.owner}});
        try{await chrome.tabs.remove(tab);}catch{}
      }
      chrome.webRequest.onHeadersReceived.addListener(details=>{
        if(![301,302,303,307,308].includes(details.statusCode))return;
        const headers=(details.responseHeaders||[]).filter(h=>h.name.toLowerCase()==='location');
        if(headers.length===1&&headers[0].value.startsWith(CALLBACK+'?'))void capture(headers[0].value,details.tabId,'response-header');
      },{urls:['http://127.0.0.1/*'],types:['main_frame']},['responseHeaders']);
      chrome.runtime.onMessage.addListener((message,sender,respond)=>{
        (async()=>{
          if(message.type==='START'&&sender.url===chrome.runtime.getURL('owner.html')){
            const target=new URL(message.url);if(target.hostname!=='127.0.0.1'||target.protocol!=='http:')throw new Error('Synthetic provider only');
            const tab=await chrome.tabs.create({url:'about:blank',active:true});
            await chrome.storage.session.set({pending:{tab:tab.id,owner:message.owner,state:message.state,expires:Date.now()+60000}});
            await chrome.tabs.update(tab.id,{url:message.url});respond({ok:true});
          }else if(message.type==='CONTEXT'){
            const context=await pending();respond(context?.tab===sender.tab?.id?{state:context.state}:null);
          }else if(message.type==='CALLBACK'&&sender.url?.startsWith('http://127.0.0.1:')){
            await capture(message.url,sender.tab.id,'form-post');respond({ok:true});
          }else respond(null);
        })().catch(()=>respond({ok:false}));return true;
      });''',encoding='utf8')
    (root/'callback.js').write_text('''(async()=>{
      const context=await chrome.runtime.sendMessage({type:'CONTEXT'});if(!context)return;
      const read=()=>{
        for(const form of document.forms){
          if(form.action!=='ch.unibe.campusapp://campusapp.unibe.ch'||form.method.toLowerCase()!=='post')continue;
          const controls=[...form.elements].filter(e=>['code','state'].includes(e.name));
          if(controls.length!==2||controls.some(e=>e.type!=='hidden'))continue;
          const params=new URLSearchParams();controls.forEach(e=>params.append(e.name,e.value));
          if(params.get('state')===context.state)void chrome.runtime.sendMessage({type:'CALLBACK',url:form.action+'?'+params});
        }
      };
      new MutationObserver(read).observe(document,{subtree:true,childList:true});
      document.addEventListener('DOMContentLoaded',read);read();
    })();''',encoding='utf8')
    return root


@pytest.mark.parametrize('flow',['redirect','form'])
@pytest.mark.parametrize('restart_worker',[False,True])
def test_installed_chromium_observes_own_native_callback(tmp_path,provider,probe_extension,flow,restart_worker):
    pw=pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
          args=[f'--disable-extensions-except={probe_extension}',f'--load-extension={probe_extension}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            extension_id=worker.url.split('/')[2]
            owner=context.new_page();owner.goto(f'chrome-extension://{extension_id}/owner.html')
            owner.evaluate('(url)=>window.probe={url,state:"own-transaction"}',provider+('/pending' if restart_worker else '/'+flow)+'?state=own-transaction')
            owner.locator('#start').click()
            if restart_worker:
                for _ in range(100):
                    pending=owner.evaluate("chrome.storage.session.get('pending').then(r=>r.pending)")
                    if pending:break
                    owner.wait_for_timeout(50)
                assert pending
                cdp=context.new_cdp_session(owner)
                targets=cdp.send('Target.getTargets')['targetInfos']
                target=next(t for t in targets if t['type']=='service_worker' and t['url']==worker.url)
                cdp.send('Target.closeTarget',{'targetId':target['targetId']});cdp.detach()
                owner.wait_for_timeout(100)
                owner.evaluate('(url)=>chrome.tabs.update('+str(pending['tab'])+',{url})',provider+'/'+flow+'?state=own-transaction')
            result=None
            for _ in range(200):
                result=owner.evaluate("chrome.storage.session.get('result').then(r=>r.result)")
                if result:break
                owner.wait_for_timeout(50)
            assert result is not None, 'Native callback was not observed'
            assert result['code']=='synthetic-code' and result['state']=='own-transaction'
            assert result['via']==('response-header' if flow=='redirect' else 'form-post')
            assert not owner.is_closed()
        finally:context.close()


@pytest.mark.parametrize('source',['wrong-state','other-tab'])
def test_callback_probe_rejects_unrelated_callback(tmp_path,provider,probe_extension,source):
    pw=pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
          args=[f'--disable-extensions-except={probe_extension}',f'--load-extension={probe_extension}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            owner=context.new_page();owner.goto('chrome-extension://'+worker.url.split('/')[2]+'/owner.html')
            path='/redirect?state=unrelated' if source=='wrong-state' else '/pending?state=own-transaction'
            owner.evaluate('(url)=>window.probe={url,state:"own-transaction"}',provider+path);owner.locator('#start').click()
            if source=='other-tab':
                unrelated=context.new_page()
                try:unrelated.goto(provider+'/redirect?state=own-transaction')
                except pw.Error:pass  # No operating-system handler is installed for this synthetic navigation.
            owner.wait_for_timeout(600)
            assert owner.evaluate("chrome.storage.session.get('result').then(r=>r.result)") is None
            assert owner.evaluate("chrome.storage.session.get('pending').then(r=>Boolean(r.pending))")
        finally:context.close()
