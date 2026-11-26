import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

function harness(directory) {
  const stored={serverUrl:'http://localhost:8000',frontendUrl:'http://localhost:5173'},listeners=[],calls=[],tabs=[],notified=[];
  let connected={phase:'connected',scope:'a'.repeat(64),affiliation:'private@unibe.ch',affiliations:['private@unibe.ch'],user_name:'Synthetic Student',expires_at:9999999999};
  const api={storage:{local:{get:async keys=>typeof keys==='string'?{[keys]:stored[keys]}:Object.fromEntries(keys.map(k=>[k,stored[k]])),set:async values=>Object.assign(stored,values)}},
    runtime:{getURL:path=>'chrome-extension://synthetic/'+path,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async()=>{}},
    tabs:{query:async()=>tabs,create:async options=>notified.push(options),sendMessage:async(id,message)=>{
      if(message.type==='UNIBE_CONTEXT')return {sessionId:'p'.repeat(43),credential:'c'.repeat(43)};
      notified.push({id,message});return {};
    }}};
  const context=vm.createContext({chrome:api,crypto:webcrypto,TextEncoder,URL,AbortSignal,btoa,
    BetterIliasUnisportPage:async sender=>sender.frameId===0&&sender.url?.startsWith('http://localhost:5173/')?'http://localhost:8000':null,
    BetterIliasUnisportStart:async(...args)=>calls.push({bridge:args}),
    fetch:async(url,init)=>{
      calls.push({url,init});
      let data=url.endsWith('/availability')?{enabled:true}:url.endsWith('/connection')?connected:
        url.endsWith('/ilias-connection')?{authenticated:true,session_id:'n'.repeat(43),user_name:'Synthetic Student'}:{};
      return {ok:true,json:async()=>structuredClone(data)};
    }});
  vm.runInContext('globalThis.BetterIliasRequest=async(url,init)=>{const response=await fetch(url,init);return {response,data:await response.json()};};',context);
  vm.runInContext(fs.readFileSync(`extensions/${directory}/unibe.js`,'utf8'),context);
  return {stored,calls,tabs,notified,setConnected:value=>{connected=value;},
    message:(message,sender={url:api.runtime.getURL('popup.html'),tab:{id:99}})=>new Promise(resolve=>{
      if(!listeners[0](message,sender,resolve))resolve(undefined);
    })};
}

for(const directory of ['chrome','firefox']) {
  test(`${directory}: shared login preserves full affiliation and requires account-switch activation`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.user_name,'Synthetic Student');
    await h.message({type:'UNIBE_AFFILIATION',affiliation:'private@unibe.ch',scope:'a'.repeat(64)});
    const affiliation=h.calls.find(c=>c.url?.endsWith('/affiliation'));
    assert.equal(JSON.parse(affiliation.init.body).affiliation,'private@unibe.ch');
    const result=await h.message({type:'UNIBE_CONNECT',scope:'a'.repeat(64),affiliation:'private@unibe.ch'});
    assert.equal(result.data.confirmation,true);assert.equal(h.notified.length,0);
    const exchange=h.calls.find(c=>c.url?.endsWith('/ilias-connection'));
    assert.equal(exchange.init.headers['X-Session-Id'],'p'.repeat(43));
    assert.equal(exchange.init.headers['X-Unisport-Session'],'c'.repeat(43));
    assert.equal((await h.message({type:'UNIBE_ACTIVATE'})).success,true);
    assert.equal(h.stored.authMethod,'unibe');
    assert.equal(h.notified[0].message.type,'UNIBE_SELECTED');
    assert.equal(h.notified[0].message.sessionId,'n'.repeat(43));
    const record=Object.entries(h.stored).find(([key])=>key.startsWith('unibe.connection.'))[1];
    assert.equal(record.active,true);assert.ok(!('token' in record));
  });
  test(`${directory}: a replaced or expired login cannot activate an earlier exchange`,async()=>{
    const h=harness(directory);await h.message({type:'UNIBE_CONNECT',scope:'a'.repeat(64),affiliation:'private@unibe.ch'});
    h.setConnected({phase:'disconnected'});
    const result=await h.message({type:'UNIBE_ACTIVATE'});
    assert.equal(result.success,false);assert.equal(result.code,'context');assert.equal(h.notified.length,0);
  });
  test(`${directory}: privileged login controls reject web senders and isolate instances`,async()=>{
    const h=harness(directory);
    assert.equal((await h.message({type:'UNIBE_LOGIN'},{url:'http://localhost:5173/',tab:{id:1},frameId:0})).success,false);
    assert.equal(h.calls.length,0);
    await h.message({type:'UNIBE_STATUS'});
    const first=Object.keys(h.stored).find(k=>k.startsWith('unibe.connection.'));
    const credential=h.stored[first].credential;
    h.stored.serverUrl='http://localhost:8001';await h.message({type:'UNIBE_STATUS'});
    const keys=Object.keys(h.stored).filter(k=>k.startsWith('unibe.connection.'));
    assert.equal(keys.length,2);assert.notEqual(h.stored[keys.find(k=>k!==first)].credential,credential);
    assert.equal((await h.message({type:'UNIBE_PAGE_CONNECTION'},{url:'http://other.invalid/',frameId:0,tab:{id:2}})).data.sessionId,undefined);
  });
  test(`${directory}: a new login scope never inherits the previous account's name`,async()=>{
    const h=harness(directory);
    await h.message({type:'UNIBE_CONNECT',scope:'a'.repeat(64),affiliation:'private@unibe.ch'});
    await h.message({type:'UNIBE_ACTIVATE'});
    h.setConnected({phase:'connected',scope:'b'.repeat(64),user_name:null,affiliation:'private@unibe.ch',affiliations:['private@unibe.ch']});
    const result=await h.message({type:'UNIBE_STATUS'});
    assert.equal(result.data.user_name,null);assert.equal(result.data.ilias_connected,false);
    assert.equal((await h.message({type:'UNIBE_CONNECT',scope:'a'.repeat(64),affiliation:'private@unibe.ch'})).code,'context');
  });
  test(`${directory}: only a configured app page may open the shared-login controls`,async()=>{
    const h=harness(directory);
    assert.equal((await h.message({type:'UNIBE_OPEN_FROM_PAGE'},{url:'https://other.invalid/',frameId:0,tab:{id:1}})).success,false);
    assert.equal(h.notified.length,0);
    assert.equal((await h.message({type:'UNIBE_OPEN_FROM_PAGE'},{url:'http://localhost:5173/',frameId:0,tab:{id:1}})).success,true);
    assert.equal(h.notified[0].url,'chrome-extension://synthetic/popup.html?login=1');
  });
}
