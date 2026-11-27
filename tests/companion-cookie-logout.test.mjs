import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const directory of ['chrome','firefox'])test(`${directory}: logout removes ILIAS/app cookies without touching SSO or preferences`,async()=>{
  const removed=[];
  const api={cookies:{getAll:async query=>query.domain?[
    {domain:'.ilias.unibe.ch',name:'PHPSESSID',path:'/',storeId:'0'},
    {domain:'ilias.unibe.ch',name:'_shibsession_synthetic',path:'/',storeId:'0',partitionKey:{topLevelSite:'https://ilias.unibe.ch'}},
    {domain:'login.eduid.ch',name:'PHPSESSID',path:'/'},
    {domain:'ilias.unibe.ch',name:'language',path:'/'}]:[
    {domain:'localhost',name:'betterilias_session',path:'/api',storeId:'0'},
    {domain:'localhost',name:'preference',path:'/'},
    {domain:'other.example',name:'betterilias_session',path:'/'}],remove:async data=>{removed.push(data);return {name:data.name};}}};
  const context=vm.createContext({chrome:api,URL,...(directory==='firefox'?{browser:api}:{})});
  vm.runInContext(fs.readFileSync(`extensions/${directory}/logout.js`,'utf8'),context);
  await context.BetterIliasClearIliasCookies();await context.BetterIliasClearAppCookies('http://localhost:8000');
  assert.deepEqual(removed.map(row=>row.name),['PHPSESSID','_shibsession_synthetic','betterilias_session']);
  assert.ok(removed.every(row=>!row.url.includes('eduid.ch')));
  assert.equal(removed[1].partitionKey.topLevelSite,'https://ilias.unibe.ch');
});
