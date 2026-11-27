import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const directory of ['chrome','firefox']) {
  test(`${directory}: legacy login only verifies present cookies, syncs configured tabs and preserves credentials on failure`,async()=>{
    let cookies=[],offline=false;const calls=[],saved={sessionId:'existing'},navigations=[];
    const api={cookies:{getAll:async()=>cookies},storage:{local:{get:async()=>saved,set:async data=>Object.assign(saved,data)}},
      tabs:{query:async()=>[{id:1,url:'http://localhost:5173/'},{id:2,url:'https://unrelated.example/'}],
        sendMessage:async()=>{throw Error('No content script');},update:async(id,data)=>navigations.push({id,...data}),reload:async()=>{}}};
    const context=vm.createContext({chrome:api,URL,URLSearchParams,navigator:{userAgent:'synthetic'},
      BetterIliasRequest:async(url,options)=>{
        if(offline)throw Error('offline');calls.push({url,options});
        return {response:{ok:true},data:url.endsWith('/mobile-session')?{handoff_token:'single-use-code'}:{success:true,authenticated:true,session_id:'verified',user_name:'Synthetic Student'}};
      }});
    vm.runInContext(fs.readFileSync(`extensions/${directory}/legacy-login.js`,'utf8'),context);
    const check=()=>context.BetterIliasLegacy.check('http://localhost:8000/','http://localhost:5173','en',true);
    assert.equal((await check()).phase,'disconnected');assert.equal(calls.length,0);
    cookies=[{name:'PHPSESSID',value:'synthetic-cookie'}];
    assert.equal((await check()).phase,'connected');assert.equal(saved.sessionId,'verified');
    assert.equal(calls[0].url,'http://localhost:8000/api/auth/sync');
    assert.equal(navigations.length,1);assert.equal(navigations[0].id,1);
    assert.ok(!navigations[0].url.includes('verified'));assert.ok(navigations[0].url.includes('single-use-code'));
    offline=true;await assert.rejects(check,/offline/);assert.equal(saved.sessionId,'verified');
  });
}
