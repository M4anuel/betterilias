"""Actual popup HTML/controller in Chromium emulation with a synthetic runtime."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page

ROOT=Path(__file__).resolve().parents[1]
pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in Companion UI regressions')


def mount(page,site,code='en',scheme='light',phase='connected'):
    page.emulate_media(color_scheme=scheme)
    page.add_init_script('''({code,phase})=>{
      window.calls=[];window.activations=0;window.needsConfirmation=true;
      window.mockState={phase,scope:'a'.repeat(64),user_name:'Synthetic Student',affiliation:null,
        affiliations:['private-member@unibe.ch','private-member@other.edu'],expires_at:Date.now()/1000+600};
      window.chrome={storage:{local:{get:async()=>({language:code}),set:async()=>{}}},
        runtime:{getURL:path=>'chrome-extension://synthetic/'+path,onMessage:{addListener:()=>{}},
          sendMessage:async message=>{
            calls.push(message);
            if(message.type==='UNIBE_STATUS'){
              if(window.failStatus)return {success:false,code:'connection'};
              return {success:true,data:structuredClone(mockState)};
            }
            if(message.type==='UNIBE_AFFILIATION'){mockState.affiliation=message.affiliation;return {success:true,data:structuredClone(mockState)};}
            if(message.type==='UNIBE_CONNECT')return {success:true,data:{confirmation:needsConfirmation,user_name:mockState.user_name}};
            if(message.type==='UNIBE_ACTIVATE'){activations++;return {success:true,data:{connected:true}};}
            if(message.type==='UNIBE_DISCONNECT'){mockState={phase:'disconnected'};return {success:true,data:mockState};}
            if(message.type==='UNIBE_LOGIN')return {success:true,data:{phase:'pending'}};
            return {success:true,data:{opened:true}};
          }},tabs:{create:async()=>{}}};
    }'''.replace('({code,phase})=>{','(()=>{const code='+json.dumps(code)+',phase='+json.dumps(phase)+';')+')();')
    def asset(route):
        path=ROOT/'extensions/chrome'/Path(urlsplit(route.request.url).path).name
        route.fulfill(path=str(path))
    page.route('**/companion/*',asset)
    page.goto(site+'/companion/popup.html'+('?login=1' if phase=='connected' else ''))
    page.wait_for_function("document.querySelector('#account-name').textContent || !document.querySelector('#login-btn').hidden")
    return json.loads((ROOT/'locales'/(code+'.json')).read_text(encoding='utf-8'))


@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_name_domains_explicit_selection_confirmation_and_resize(workflow_page,workflow_site,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=mount(page,workflow_site,code,scheme)
    assert page.locator('#login-btn').is_hidden()
    assert page.locator('#account-name').inner_text()=='Synthetic Student'
    select=page.get_by_label(tr['unisport.affiliation'],exact=True)
    assert select.locator('option').all_text_contents()==[tr['unisport.choose_affiliation'],'unibe.ch','other.edu']
    select.select_option('private-member@other.edu')
    assert page.evaluate("calls.filter(c=>c.type==='UNIBE_AFFILIATION').length")==0
    page.set_viewport_size({'width':390 if width>=768 else 1280,'height':844})
    assert select.input_value()=='private-member@other.edu'
    page.set_viewport_size({'width':width,'height':height})
    folder=ROOT/'scratch/unibe-companion-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'connected-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    select.focus();page.keyboard.press('Tab');page.keyboard.press('Enter')
    page.locator('#confirm-switch').wait_for(state='visible')
    assert page.evaluate('activations')==0
    assert page.evaluate("calls.find(c=>c.type==='UNIBE_AFFILIATION').affiliation")=='private-member@other.edu'
    folder=ROOT/'scratch/unibe-companion-checks';folder.mkdir(parents=True,exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(folder/f'confirmation-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    page.get_by_role('button',name=tr['Abbrechen'],exact=True).click()
    assert select.input_value()=='private-member@other.edu'
    page.get_by_role('button',name=tr['unibe.connect'],exact=True).click()
    page.locator('#confirm-btn').click()
    page.get_by_text(tr['unibe.connected_success'],exact=True).wait_for()
    assert page.evaluate('activations')==1


def test_expired_token_shows_login_but_network_error_offers_retry(workflow_page,workflow_site):
    page=workflow_page;mount(page,workflow_site)
    page.evaluate("mockState.expires_at=Date.now()/1000+.1;dispatchEvent(new Event('focus'))")
    page.locator('#login-btn').wait_for(state='visible')
    assert page.locator('#account-name').inner_text()==''
    page.evaluate("failStatus=true;dispatchEvent(new Event('focus'))")
    page.locator('#retry-btn').wait_for(state='visible')
    assert page.locator('#login-btn').is_hidden()
    page.evaluate("failStatus=false;mockState={phase:'disconnected'}")
    page.locator('#retry-btn').click()
    page.locator('#login-btn').wait_for(state='visible')
