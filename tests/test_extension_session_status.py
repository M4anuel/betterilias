"""Toolbar status transitions for both packaged background scripts."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('directory', ['extension', 'extension-firefox'])
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
const context = vm.createContext({chrome:api,console:{warn:()=>{}},AbortSignal,
  setTimeout:()=>1,clearTimeout:()=>{},fetch:async()=>{
    assert.equal(badge.text,'…'); assert.equal(badge.color,'#d97706');
    if(hold) await hold;
    if(fail) throw Error('offline');
    return {ok:status===200,status,json:async()=>response};
  }});
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
