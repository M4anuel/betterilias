"""Toolbar status transitions for both packaged background scripts."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
def test_live_handoff_uses_page_readable_events_while_background_is_pending(directory):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the content-script harness')
    script = r'''
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const writes=[], events=[];
let storageListener, runtimeListener, cloned=0;
const page={location:{origin:'http://localhost:5173'},localStorage:{setItem:(_,value)=>writes.push(value)},postMessage:()=>{}};
const api={storage:{local:{get:async keys=>keys.includes('sessionId')?{sessionId:'initial'}:{}},
  onChanged:{addListener:fn=>storageListener=fn}},
  runtime:{sendMessage:async()=>new Promise(()=>{}),onMessage:{addListener:fn=>runtimeListener=fn}}};
const context=vm.createContext({browser:api,URL,console,window:page,
  cloneInto:(data,target)=>{assert.equal(target,page);cloned++;return {...data,pageReadable:true};},
  document:{dispatchEvent:event=>events.push(event)},
  CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes[0],'initial');
  storageListener({sessionId:{newValue:'other-area'}},'sync');
  assert.equal(writes.length,1);
  storageListener({sessionId:{newValue:'live-session'}},'local');
  assert.equal(writes.at(-1),'live-session');
  assert.equal(events.at(-1).detail.sessionId,'live-session');
  assert.equal(events.at(-1).detail.pageReadable,true);
  let acknowledged=false;
  runtimeListener({type:'BETTERILIAS_SESSION_SYNCED',sessionId:'runtime-session'},null,reply=>acknowledged=reply.success);
  assert.equal(writes.at(-1),'runtime-session');assert.equal(acknowledged,true);
  assert.equal(cloned,3);
})().catch(error=>{console.error(error);process.exitCode=1});
'''
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', script, str(root / directory / 'content.js')], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
def test_request_deadline_covers_stalled_headers_and_body(directory):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the request harness')
    script = r'''
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
(async()=>{
  for(const stage of ['headers','body','success','network-error']) {
    let expire, signal, cleared=false;
    const context=vm.createContext({AbortController,
      setTimeout:callback=>{expire=callback;return 1;},clearTimeout:()=>{cleared=true;},
      fetch:async(_,options)=>{
        signal=options.signal;
        if(stage==='headers')return new Promise(()=>{}); // Even an abort-ignoring fetch must settle.
        if(stage==='network-error')throw Error('offline');
        return {json:async()=>stage==='body'?new Promise(()=>{}):{authenticated:true}};
      }});
    vm.runInContext(source,context);
    const pending=context.BetterIliasRequest('http://localhost:8000/api/auth/sync',{},'deadline');
    pending.catch(()=>{}); // Attach a handler before yielding on an immediate network failure.
    await new Promise(resolve=>setImmediate(resolve));
    if(stage==='headers'||stage==='body') {
      expire(); await assert.rejects(pending,/deadline/); assert.equal(signal.aborted,true);
    } else if(stage==='success') {
      assert.equal((await pending).data.authenticated,true); assert.equal(signal.aborted,false);
    } else {
      await assert.rejects(pending,/offline/);
    }
    assert.equal(cleared,true);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
'''
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', script, str(root / directory / 'request.js')], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
def test_content_handoff_only_reaches_expected_origins(directory):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the content-script harness')
    script = r'''
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
(async()=>{
  for(const [origin,allowed] of [
    ['http://localhost:5173',true], ['http://127.0.0.1:8000',true],
    ['http://localhost:9123',true], ['http://127.0.0.1:9124',true],
    ['http://localhost:9999',false], ['http://127.0.0.1:9999',false],
    ['http://localhost:51730',false], ['https://localhost:5173',false],
    ['https://localhost.evil.test:5173',false],
  ]) {
    const writes=[], messages=[], listeners=[];
    let sessionReads=0;
    const api={storage:{local:{get:async keys=>{
      if(keys.includes('sessionId')){sessionReads++;return {sessionId:'test-session'};}
      return {frontendUrl:'http://localhost:9123/app',serverUrl:'http://127.0.0.1:9124/'};
    }}},runtime:{sendMessage:(_,callback)=>callback({}),onMessage:{addListener:fn=>listeners.push(fn)}}};
    const context=vm.createContext({chrome:api,URL,console,
      window:{location:{origin},localStorage:{setItem:(...args)=>writes.push(args)},postMessage:data=>messages.push(data)},
      document:{dispatchEvent:()=>{}},CustomEvent:class {}});
    await vm.runInContext(source,context);
    assert.equal(sessionReads,allowed?1:0,origin);
    assert.equal(writes.length,allowed?1:0,origin);
    assert.equal(listeners.length,allowed?1:0,origin);
    assert.equal(messages.length,allowed?2:0,origin);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
'''
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', script, str(root / directory / 'content.js')], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize('directory', ['extensions/chrome', 'extensions/firefox'])
def test_background_verification_controls_toolbar_status(directory):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the extension background harness')
    script = r'''
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const state = {}, badge = {}, events = {};
let cookies = [{name:'PHPSESSID',value:'stale'}, {name:'_shibsession_test',value:'stale'}];
let response = {success:true,authenticated:true,session_id:'test-session'}, status = 200, fail = false, hold;
const api = {
  storage:{local:{get:async()=>({...state}),set:async value=>Object.assign(state,value)}},
  cookies:{getAll:async()=>cookies,onChanged:{addListener:fn=>events.cookie=fn}},
  action:{setBadgeText:value=>badge.text=value.text,setBadgeBackgroundColor:value=>badge.color=value.color},
  tabs:{query:async()=>[],sendMessage:async()=>{}},runtime:{onMessage:{addListener:()=>{}}}
};
const context = vm.createContext({chrome:api,console:{warn:()=>{}},AbortSignal,AbortController,
  BetterIliasI18n:{setLanguage:()=>{}},
  BetterIliasToolbar:{setStatus:status=>{
    badge.text=({synced:'✓',unauthenticated:'!',checking:'…',error:'?'})[status]||'';
    badge.color=status==='synced'?'#0AACA5':status==='unauthenticated'?'#dc2626':'#d97706';
  }},
  setTimeout:()=>1,clearTimeout:()=>{},fetch:async()=>{
    assert.equal(badge.text,'…'); assert.equal(badge.color,'#d97706');
    if(hold) await hold;
    if(fail) throw Error('offline');
    return {ok:status===200,status,json:async()=>response};
  }});
vm.runInContext(fs.readFileSync(require('node:path').join(require('node:path').dirname(process.argv[1]),'request.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(process.argv[1],'utf8').split('// Run initial check on load')[0],context);
const check = ()=>vm.runInContext('checkAndAutoSync(true)',context);
(async()=>{
  await check(); assert.equal(badge.text,'✓');
  let release; hold=new Promise(resolve=>release=resolve);
  const pending=check();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(badge.text,'…'); assert.equal(badge.color,'#d97706');
  response={success:true,authenticated:false}; release(); await pending; hold=null;
  assert.equal(badge.text,'!'); assert.equal(badge.color,'#dc2626');
  assert.equal(state.lastSyncTime,0); assert.equal(state.lastSyncSignature,null);
  response={success:true,authenticated:true,session_id:'test-session'};
  await check(); assert.equal(badge.text,'✓');
  status=401; response={detail:'Expired'}; await check(); assert.equal(badge.text,'!');
  status=500; await check(); assert.equal(badge.text,'?'); assert.equal(badge.color,'#d97706');
  fail=true; await check(); assert.equal(badge.text,'?'); assert.equal(state.lastSyncTime,0);
  fail=false; status=200; cookies=[]; await check(); assert.equal(badge.text,'!');
  // A valid PHP session is verified even without an accompanying Shibboleth cookie.
  cookies=[{name:'PHPSESSID',value:'fresh'}]; response={success:true,authenticated:true,session_id:'fresh'};
  await check(); assert.equal(badge.text,'✓');
  events.cookie({cookie:{name:'PHPSESSID'}}); assert.equal(badge.text,'…');
  assert.equal(state.lastSyncTime,0);
})().catch(error=>{console.error(error);process.exitCode=1});
'''
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', script, str(root / directory / 'background.js')], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr
