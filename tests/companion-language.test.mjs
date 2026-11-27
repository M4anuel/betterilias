import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const directory of ['chrome','firefox']) {
  test(`${directory}: first-use app preference, ongoing two-way sync, unsupported values and trusted origins`, async () => {
    const stored={}, listeners=[], broadcasts=[];
    const api={storage:{local:{get:async()=>({...stored}),set:async row=>Object.assign(stored,row)}},
      runtime:{getURL:p=>'extension://test/'+p,onMessage:{addListener:fn=>listeners.push(fn)}},
      tabs:{query:async()=>[{id:1,url:'http://localhost:5173/'},{id:2,url:'https://unrelated.example/'}],sendMessage:async(id,m)=>{
        assert.equal(id,1);
        if(m.type==='COMPANION_LANGUAGE_GET')return {language:'de'};
        broadcasts.push(m);return {success:true};
      }}};
    const popup={url:'extension://test/popup.html'},page={url:'http://localhost:5173/',tab:{id:1},frameId:0};
    const context=vm.createContext({chrome:api,URL,BetterIliasI18n:{languages:{en:{},de:{}},getLanguage:()=> 'en',setLanguage(){}},
      BetterIliasUnisportPage:async sender=>sender===page});
    vm.runInContext(fs.readFileSync(`extensions/${directory}/language.js`,'utf8'),context);
    const send=(message,sender=popup)=>new Promise(resolve=>listeners[0](message,sender,resolve));
    assert.equal((await send({type:'COMPANION_LANGUAGE_INIT'})).language,'de');
    assert.equal(stored.language,'de');
    assert.equal((await send({type:'COMPANION_LANGUAGE_SET',language:'en'})).language,'en');
    assert.equal(broadcasts.at(-1).language,'en');
    assert.equal((await send({type:'COMPANION_LANGUAGE_SET',language:'de'},page)).language,'de');
    const count=broadcasts.length;
    await send({type:'COMPANION_LANGUAGE_SET',language:'de'},page);
    await send({type:'COMPANION_LANGUAGE_SET',language:'fr'},page);
    assert.equal(broadcasts.length,count);assert.equal(stored.language,'de');
    assert.equal((await send({type:'COMPANION_LANGUAGE_SET',language:'en'},{url:'https://unrelated.example/'})).error,true);
    assert.equal(stored.language,'de');
    assert.equal((await send({type:'COMPANION_LANGUAGE_ATTACH',language:'en'},page)).language,'de');
  });
}
