"""Safari background API simulation, not native Safari/device validation."""
import shutil
import subprocess
from pathlib import Path

import pytest


def test_safari_autosync_without_cookie_events_and_with_suspended_workers():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the extension harness')
    script = r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8').split('// Run initial check on load')[0];
const state={frontendUrl:'https://app.example.test',serverUrl:'https://app.example.test'};
let now=100000,postCount=0,fail=false,hasCookie=true,valid=true,lockHeld=false,release;
let cookieValue='fresh',responseSession='verified-session';
const notices=[],events={},created=[];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function worker(withAlarms=true,withLocks=true) {
  const api={storage:{local:{get:async()=>({...state}),set:async v=>Object.assign(state,v)}},
    cookies:{getAll:async()=>hasCookie?[{name:'PHPSESSID',value:cookieValue},
      {name:'ilClientId',value:'client'},{name:'preferences',value:'never-forward'},
      {name:'il_bad[0]',value:'never-forward'}]:[]},
    tabs:{query:async()=>[{id:1,url:'https://app.example.test/course'},
      {id:2,url:'https://app.example.test.evil.test/'}],
      sendMessage:async(id,message)=>notices.push({id,message}),
      get:async()=>({url:'https://ilias.unibe.ch/'}),
      onUpdated:{addListener:fn=>events.updated=fn},onActivated:{addListener:fn=>events.activated=fn}},
    runtime:{id:'test-safari',onMessage:{addListener:fn=>events.message=fn},
      onInstalled:{addListener:fn=>events.installed=fn},onStartup:{addListener:fn=>events.startup=fn}}};
  if(withAlarms)api.alarms={get:async()=>({name:'betterilias_periodic_sync'}),
    create:async(...args)=>created.push(args),onAlarm:{addListener:fn=>events.alarm=fn}};
  const navigator={userAgent:'Test Safari'};
  if(withLocks)navigator.locks={request:async(name,options,fn)=>{
    assert.equal(options.ifAvailable,true);
    if(lockHeld)return fn(null);
    lockHeld=true;try{return await fn({name});}finally{lockHeld=false;}
  }};
  const context=vm.createContext({browser:api,navigator,URL,Date:{now:()=>now},console,
    BetterIliasI18n:{setLanguage:()=>{}},BetterIliasToolbar:{setStatus:async status=>{state.badge=status;}},
    BetterIliasRequest:async(url,options)=>{
      postCount++;const payload=JSON.parse(options.body);
      assert.equal(url,'https://app.example.test/api/auth/sync');
      assert.equal(payload.source,'safari_extension');
      assert(['fresh','fresher'].includes(payload.cookies.PHPSESSID));
      assert.equal(payload.cookies.preferences,undefined);assert.equal(payload.cookies['il_bad[0]'],undefined);
      if(release)await new Promise(resolve=>{release=resolve;});
      if(fail)throw Error('offline');
      return {response:{ok:valid,status:valid?200:401},data:valid?
        {success:true,authenticated:true,session_id:responseSession}:{authenticated:false}};
    }});
  vm.runInContext(source,context);
  return {check:force=>vm.runInContext(`checkAndAutoSync(${force})`,context),api};
}
(async()=>{
  let w=worker();await flush();assert.equal(created.length,0); // Never postpone an existing alarm.
  assert.equal((await w.check(false)).status,'synced');
  assert.equal(state.sessionId,'verified-session');assert.equal(notices.length,1);assert.equal(notices[0].id,1);
  assert.equal(state.badge,'synced');assert.equal(state.syncLeaseUntil,0);
  w=worker();await flush();assert.equal((await w.check(false)).status,'cooldown');assert.equal(postCount,1);
  now+=16000;assert.equal((await w.check(false)).status,'cached');assert.equal(postCount,1);
  now+=6*60*1000;events.updated(1,{status:'complete'},{url:'https://unrelated.test/'});
  await flush();assert.equal(postCount,1);
  events.updated(1,{status:'complete'},{url:'https://ilias.unibe.ch/'});await flush();
  assert.equal(postCount,2);
  now+=6*60*1000;await events.activated({tabId:1});assert.equal(postCount,3);
  now+=6*60*1000;events.alarm({name:'betterilias_periodic_sync'});await flush();assert.equal(postCount,4);
  state.autoSyncEnabled=false;now+=6*60*1000;events.startup();await flush();
  assert.equal(postCount,4);assert.equal(state.badge,'disabled');
  assert.equal((await w.check(true)).status,'synced');assert.equal(postCount,5); // Explicit manual request.
  state.autoSyncEnabled=true;fail=true;
  assert.equal((await w.check(true)).status,'error');assert.equal(state.sessionId,'verified-session');
  assert.equal(state.lastSyncSignature,null);assert.equal(state.syncLeaseUntil,0);
  fail=false;valid=false;assert.equal((await w.check(true)).status,'unauthenticated');
  assert.equal(state.sessionId,'verified-session');valid=true;
  const before=postCount;hasCookie=false;assert.equal((await w.check(true)).status,'unauthenticated');
  assert.equal(postCount,before);hasCookie=true;
  // Missing alarm APIs do not prevent activity-triggered or manual synchronization.
  w=worker(false,false);state.syncLeaseUntil=now+30000;
  assert.equal((await w.check(true)).status,'in_progress');now+=31000;
  assert.equal((await w.check(true)).status,'synced');
  // Concurrent wake-ups use Web Locks instead of duplicate backend writes.
  w=worker();release=true;const pending=w.check(true);await flush();const count=postCount;
  assert.equal((await w.check(true)).status,'in_progress');assert.equal(postCount,count);
  release();release=null;await pending;
  // Disabling automatic work while verification is pending must discard its result.
  now+=6*60*1000;release=true;responseSession='do-not-save';
  const disabling=w.check(false);await flush();state.autoSyncEnabled=false;
  release();release=null;await disabling;
  assert.equal(state.sessionId,'verified-session');assert.equal(state.badge,'disabled');
  // A login change during verification drains into a fresh check instead of saving the stale reply.
  state.autoSyncEnabled=true;now+=6*60*1000;release=true;responseSession='next-session';
  const changing=w.check(false);await flush();cookieValue='fresher';
  const beforeChanged=postCount;release();release=null;await changing;
  assert.equal(postCount,beforeChanged+1);assert.equal(state.lastSyncSignature,'fresher:');
  assert.equal(state.sessionId,'next-session');
  // Foreign extension messages cannot trigger a forced sync.
  assert.equal(events.message({type:'CHECK_AND_AUTO_SYNC',force:true},{id:'foreign'},()=>{}),false);
  let result;events.message({type:'CHECK_AND_AUTO_SYNC',force:true},{id:'test-safari'},reply=>result=reply);
  await flush();assert.equal(result.status,'synced');
})().catch(error=>{console.error(error);process.exitCode=1});
'''
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', script, str(root/'extensions/safari/background.js')],
                            capture_output=True, text=True, encoding='utf8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
