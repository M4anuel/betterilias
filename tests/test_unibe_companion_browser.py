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
              if(window.holdStatus)await new Promise(resolve=>window.releaseStatus=resolve);
              if(window.failStatus)return {success:false,code:'connection'};
              return {success:true,data:structuredClone(mockState)};
            }
            if(message.type==='UNIBE_AFFILIATION'){mockState.affiliation=message.affiliation;return {success:true,data:structuredClone(mockState)};}
            if(message.type==='UNIBE_CONNECT')return {success:true,data:{confirmation:needsConfirmation,user_name:mockState.user_name}};
            if(message.type==='UNIBE_ACTIVATE'){activations++;return {success:true,data:{connected:true}};}
            if(message.type==='UNIBE_DISCONNECT'){mockState={phase:'disconnected'};return {success:true,data:mockState};}
            if(message.type==='UNIBE_LOGOUT'){mockState={phase:'disconnected',native_logout_confirmed:true};return {success:true,data:mockState};}
            if(message.type==='UNIBE_LOGIN')return window.failLogin?{success:false,code:'rejected',status:400}:{success:true,data:{phase:'pending'}};
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
    assert select.input_value()=='private-member@unibe.ch'
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


def test_failed_retry_keeps_warning_and_login_card_stable_until_verified(workflow_page,workflow_site):
    page=workflow_page;mount(page,workflow_site,phase='disconnected')
    page.set_viewport_size({'width':390,'height':740})
    page.evaluate("failStatus=true;dispatchEvent(new Event('focus'))")
    warning=page.locator('#backend-warning');warning.wait_for(state='visible')
    retry_box=page.locator('#retry-btn').bounding_box();warning_box=warning.bounding_box()
    assert retry_box['x']+retry_box['width']<=warning_box['x']+warning_box['width']-8
    assert retry_box['x']>warning_box['x']+warning_box['width']/2
    folder=ROOT/'scratch/companion-followup-review';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/'offline-retry.png'))
    assert page.locator('#login-btn').is_visible() and page.locator('#login-btn').is_disabled()
    page.evaluate('holdStatus=true')
    page.locator('#retry-btn').click()
    page.wait_for_function("typeof releaseStatus==='function'")
    assert warning.is_visible() and page.locator('#login-btn').is_visible()
    page.evaluate('releaseStatus()')
    page.wait_for_function("!document.getElementById('retry-btn').disabled")
    assert warning.is_visible() and page.locator('#login-btn').is_disabled()
    page.evaluate('holdStatus=false;failStatus=false')
    page.locator('#retry-btn').click()
    warning.wait_for(state='hidden')
    assert page.locator('#login-btn').is_visible() and page.locator('#login-btn').is_enabled()


def test_rejected_login_does_not_claim_backend_is_offline(workflow_page,workflow_site):
    page=workflow_page;tr=mount(page,workflow_site,phase='disconnected')
    page.evaluate('failLogin=true');page.locator('#login-btn').click()
    page.get_by_text(tr['unisport.login_failed'],exact=True).wait_for()
    assert page.locator('#backend-warning').is_hidden()
    assert page.locator('#login-btn').is_visible() and page.locator('#login-btn').is_enabled()


@pytest.mark.parametrize('code,scheme',[('en','light'),('de','dark')])
def test_settings_presets_dirty_save_feedback_and_legacy_card(workflow_page,workflow_site,code,scheme):
    page=workflow_page;tr=mount(page,workflow_site,code,scheme,phase='disconnected')
    page.set_viewport_size({'width':320,'height':740})
    assert page.locator('.title-area > span').inner_text()==tr['companion.tagline']
    assert page.locator('.status-card #login-btn').is_visible()
    assert page.locator('#account-description').count()==0
    page.locator('summary').click()
    page.locator('#preset-online').click()
    assert page.locator('#server-url').input_value()=='https://betterilias.ch'
    assert page.locator('#frontend-url').input_value()=='https://betterilias.ch'
    assert 'dirty' in page.locator('#save-settings').get_attribute('class')
    page.locator('#save-settings').click()
    page.wait_for_function("document.querySelector('#save-settings').classList.contains('saved')")
    assert page.locator('#save-icon').is_visible()
    page.wait_for_function("!document.querySelector('#save-settings').classList.contains('saved')")
    page.locator('#preset-local').click()
    assert page.locator('#server-url').input_value()=='http://localhost:8000'
    assert page.locator('#frontend-url').input_value()=='http://localhost:5173'
    page.evaluate("BetterIliasLegacy.check=async()=>({phase:'disconnected',cookiePresent:false})")
    page.locator('#legacy-mode').check()
    page.locator('#legacy-action').wait_for(state='visible')
    assert page.locator('#login-btn').is_hidden()
    assert page.locator('#account-heading').inner_text()==tr['companion.legacy_title']
    assert page.locator('#legacy-action').inner_text()==tr['Bei ILIAS anmelden']
    page.evaluate("BetterIliasLegacy.check=async()=>({phase:'connected',cookiePresent:true,user_name:'Synthetic Student'})")
    page.locator('#save-settings').click()
    page.wait_for_function("document.querySelector('#account-state').textContent==="+json.dumps(tr['companion.signed_in']))
    assert page.locator('#account-name').inner_text()==''
    assert page.locator('#auto-sync-info').is_visible()
    assert page.locator('#legacy-action').inner_text()==tr['Sitzung mit BetterIlias synchronisieren']
    page.locator('#disconnect-btn').click()
    page.wait_for_function("document.querySelector('#legacy-action').textContent==="+json.dumps(tr['Bei ILIAS anmelden']))
    assert page.evaluate("calls.some(row=>row.type==='UNIBE_LOGOUT' && row.authMethod==='legacy')")
    page.locator('#legacy-mode').uncheck()
    page.locator('#login-btn').wait_for(state='visible')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    folder=ROOT/'scratch/companion-redesign-review';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'settings-{code}-{scheme}.png'),full_page=True)
    assert page.locator('#account-name').inner_text()==''
    page.evaluate("failStatus=true;dispatchEvent(new Event('focus'))")
    page.locator('#retry-btn').wait_for(state='visible')
    assert page.locator('#login-btn').is_visible()
    assert page.locator('#login-btn').is_disabled()
    page.evaluate("failStatus=false;mockState={phase:'disconnected'}")
    page.locator('#retry-btn').click()
    page.locator('#login-btn').wait_for(state='visible')
