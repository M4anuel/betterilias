import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

function harness(directory) {
  const stored={serverUrl:'http://localhost:8000',frontendUrl:'http://localhost:5173'},listeners=[],calls=[],tabs=[],notified=[];
  let connected={phase:'connected',scope:'a'.repeat(64),affiliation:'private@unibe.ch',affiliations:['private@unibe.ch'],user_name:'Synthetic Student',expires_at:9999999999};
  let iliasResult={authenticated:true,session_id:'n'.repeat(43),user_name:'Synthetic Student',renewed:false};
  let iliasStatus=200;
  const api={storage:{local:{get:async keys=>typeof keys==='string'?{[keys]:stored[keys]}:Object.fromEntries(keys.map(k=>[k,stored[k]])),set:async values=>Object.assign(stored,values)}},
    runtime:{getURL:path=>'chrome-extension://synthetic/'+path,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async msg=>notified.push({runtimeMessage:msg})},
    action:{openPopup:async()=>notified.push({popup:true})},
    tabs:{query:async()=>tabs,create:async options=>notified.push(options),sendMessage:async(id,message)=>{
      if(message.type==='UNIBE_CONTEXT')return tabs.find(t=>t.id===id)?.context || {sessionId:'p'.repeat(43),credential:'c'.repeat(43)};
      notified.push({id,message});return {};
    }}};
  const context=vm.createContext({chrome:api,crypto:webcrypto,TextEncoder,URL,AbortSignal,btoa,
    BetterIliasUnisportPage:async sender=>sender.frameId===0&&sender.url?.startsWith('http://localhost:5173/')?'http://localhost:8000':null,
    BetterIliasUnisportStart:async(...args)=>calls.push({bridge:args}),
    BetterIliasClearIliasCookies:async()=>calls.push({clearCookies:true}),
    BetterIliasClearAppCookies:async()=>calls.push({clearApp:true}),
    fetch:async(url,init)=>{
      calls.push({url,init});
      if(url.endsWith('/connection') && init.method==='DELETE')connected={phase:'disconnected'};
      if(url.endsWith('/affiliation') && init.method==='PUT') {
        const body=JSON.parse(init.body);
        connected={...connected,affiliation:body.affiliation};
      }
      if(url.endsWith('/start') && init.method==='POST') {
        return {ok:true,status:200,json:async()=>({state:'s'.repeat(43),authorization_url:'https://login.eduid.ch/idp/profile/oidc/authorize'})};
      }
      if(url.endsWith('/ilias-connection') && iliasStatus!==200) {
        return {ok:false,status:iliasStatus,json:async()=>({authenticated:false,detail:'Failed'})};
      }
      let data=url.endsWith('/availability')?{enabled:true}:url.endsWith('/connection')?connected:
        url.endsWith('/ilias-connection')?iliasResult:{};
      return {ok:true,status:200,json:async()=>structuredClone(data)};
    }});
  vm.runInContext('globalThis.BetterIliasRequest=async(url,init)=>{const response=await fetch(url,init);return {response,data:await response.json()};};',context);
  vm.runInContext(fs.readFileSync(`extensions/${directory}/unibe.js`,'utf8'),context);
  return {stored,calls,tabs,notified,context,setConnected:value=>{connected=value;},setIliasResult:(value,status=200)=>{iliasResult=value;iliasStatus=status;},
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
  test(`${directory}: auto-selects and activates unibe.ch affiliation on login completion even without open popup`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    h.setIliasResult({authenticated:true,session_id:'p'.repeat(43),user_name:'Synthetic Student',renewed:true});
    await h.message({type:'UNIBE_LOGIN'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['other@example.edu','member@UniBE.ch'],user_name:'Synthetic Student',expires_at:9999999999});
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    const affiliation=h.calls.find(c=>c.url?.endsWith('/affiliation') && c.init.method==='PUT');
    assert.ok(affiliation);
    assert.equal(JSON.parse(affiliation.init.body).affiliation,'member@UniBE.ch');
    assert.ok(h.calls.some(c=>c.url?.endsWith('/ilias-connection')));
    assert.ok(h.notified.some(n=>n.message?.type==='UNIBE_SELECTED' && n.message.sessionId==='p'.repeat(43)));
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.affiliation,'member@UniBE.ch');
    assert.equal(status.data.ilias_connected,true);
    assert.equal(status.data.confirmation,false);
    // Duplicate completion or subsequent status poll must not re-run auto-connect
    const callCount=h.calls.filter(c=>c.url?.endsWith('/ilias-connection')).length;
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    await h.message({type:'UNIBE_STATUS'});
    assert.equal(h.calls.filter(c=>c.url?.endsWith('/ilias-connection')).length,callCount);
  });
  test(`${directory}: auto-connect with different unverified account leaves confirmation pending without auto-activating`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    h.setIliasResult({authenticated:true,session_id:'n'.repeat(43),user_name:'Different Student',renewed:false});
    await h.message({type:'UNIBE_LOGIN'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['member@unibe.ch'],user_name:'Different Student',expires_at:9999999999});
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    assert.ok(!h.notified.some(n=>n.message?.type==='UNIBE_SELECTED'));
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.affiliation,'member@unibe.ch');
    assert.equal(status.data.confirmation,true);
    assert.equal(status.data.ilias_connected,false);
    // Cancelling candidate clears confirmation
    await h.message({type:'UNIBE_CANCEL_CANDIDATE'});
    const afterCancel=await h.message({type:'UNIBE_STATUS'});
    assert.equal(afterCancel.data.confirmation,false);
  });
  test(`${directory}: no unibe.ch affiliation leaves manual selection and does not invent an affiliation`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    await h.message({type:'UNIBE_LOGIN'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['member@other.edu'],user_name:'Synthetic Student',expires_at:9999999999});
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    assert.ok(!h.calls.some(c=>c.url?.endsWith('/affiliation')));
    assert.ok(!h.calls.some(c=>c.url?.endsWith('/ilias-connection')));
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.affiliation,null);
  });
  test(`${directory}: explicit manual affiliation switch to another organisation is preserved and not overridden back to unibe.ch`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    h.setIliasResult({authenticated:true,session_id:'p'.repeat(43),user_name:'Synthetic Student',renewed:true});
    await h.message({type:'UNIBE_LOGIN'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['member@unibe.ch','member@other.edu'],user_name:'Synthetic Student',expires_at:9999999999});
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    // User manually switches to member@other.edu on the same verified account (even without open app tab)
    h.tabs.length=0;
    await h.message({type:'UNIBE_AFFILIATION',affiliation:'member@other.edu',scope:'a'.repeat(64)});
    const connect=await h.message({type:'UNIBE_CONNECT',scope:'a'.repeat(64),affiliation:'member@other.edu'});
    assert.equal(connect.data.confirmation,false);
    const lastExchange=h.calls.filter(c=>c.url?.endsWith('/ilias-connection')).at(-1);
    assert.equal(lastExchange.init.headers['X-Session-Id'],'p'.repeat(43));
    await h.message({type:'UNIBE_ACTIVATE'});
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.affiliation,'member@other.edu');
    assert.equal(status.data.ilias_connected,true);
  });
  test(`${directory}: failed automatic ILIAS verification sets auto_error without retrying and preserves manual retry`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    h.setIliasResult({authenticated:false},422);
    await h.message({type:'UNIBE_LOGIN'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['member@unibe.ch'],user_name:'Synthetic Student',expires_at:9999999999});
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    const attempts=h.calls.filter(c=>c.url?.endsWith('/ilias-connection')).length;
    assert.equal(attempts,1);
    const status=await h.message({type:'UNIBE_STATUS'});
    assert.equal(status.data.affiliation,'member@unibe.ch');
    assert.equal(status.data.auto_error,true);
    assert.equal(status.data.ilias_connected,false);
    assert.equal(h.calls.filter(c=>c.url?.endsWith('/ilias-connection')).length,1);
  });
  test(`${directory}: logout mid-login prevents late completion from auto-connecting`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    await h.message({type:'UNIBE_LOGIN'});
    await h.message({type:'UNIBE_LOGOUT'});
    h.setConnected({phase:'connected',scope:'a'.repeat(64),affiliation:null,affiliations:['member@unibe.ch'],user_name:'Synthetic Student',expires_at:9999999999});
    const before=h.calls.length;
    await h.context.BetterIliasUnibe.completed({backend:'http://localhost:8000',credential:'c'.repeat(43),state:'s'.repeat(43)},true);
    assert.equal(h.calls.length,before);
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
    assert.equal(h.notified[0].popup,true);
  });
  test(`${directory}: action popup login starts the provider without opening a Companion tab`,async()=>{
    const h=harness(directory);h.tabs.push({id:5,url:'http://localhost:5173/'});
    const reply=await h.message({type:'UNIBE_LOGIN'},{url:'chrome-extension://synthetic/popup.html'});
    assert.equal(reply.success,true);assert.equal(reply.data.phase,'pending');
    const bridge=h.calls.find(call=>call.bridge).bridge;
    assert.equal(bridge[2],5);assert.equal(bridge[3],'unibe');
    assert.equal(h.notified.length,0);
  });
  test(`${directory}: logout revokes paired credentials, clears browser cookies and cannot restore cached selection`,async()=>{
    const h=harness(directory);h.tabs.push({id:1,url:'http://localhost:5173/'});
    assert.equal((await h.message({type:'UNIBE_LOGOUT'},{url:'https://other.invalid/',tab:{id:2},frameId:0})).success,false);
    const result=await h.message({type:'UNIBE_LOGOUT'});
    assert.equal(result.success,true);assert.equal(result.data.phase,'disconnected');
    assert.ok(h.calls.some(call=>call.url?.endsWith('/auth/logout') && call.init.headers['X-Session-Id']==='p'.repeat(43)));
    assert.ok(h.calls.some(call=>call.url?.endsWith('/connection') && call.init.method==='DELETE'));
    assert.ok(h.calls.some(call=>call.clearCookies));assert.ok(h.calls.some(call=>call.clearApp));
    assert.equal(h.stored.autoSyncEnabled,false);assert.equal(h.stored.logoutPaused,true);
    assert.ok(h.notified.some(row=>row.message?.type==='BETTERILIAS_LOGGED_OUT'));
    await h.message({type:'UNIBE_STATUS'});
    const record=Object.entries(h.stored).find(([key])=>key.startsWith('unibe.connection.'))[1];
    assert.equal(record.loggedOut,true);assert.equal(record.previousSession,undefined);assert.equal(record.active,false);
    assert.equal((await h.message({type:'UNIBE_PAGE_CONNECTION'},{url:'http://localhost:5173/',tab:{id:1},frameId:0})).data.sessionId,undefined);
  });
  test(`${directory}: cookie-mode logout targets the verified cookie connection for this server`,async()=>{
    const h=harness(directory);h.stored.sessionId='legacy-verified';h.stored.legacyServer='http://localhost:8000';
    const reply=await h.message({type:'UNIBE_LOGOUT',authMethod:'legacy'});
    assert.equal(reply.success,true);
    assert.equal(h.calls.find(row=>row.url?.endsWith('/auth/logout')).init.headers['X-Session-Id'],'legacy-verified');
  });
}
