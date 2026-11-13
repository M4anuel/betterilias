"""Safari popup UI in Chromium/WebKit with mocked extension APIs, not native Safari."""
import json
import os
from pathlib import Path
import pytest
from tests.test_localisation_browser import local_site

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in popup browser regressions')


@pytest.fixture(scope='module', params=['chromium', 'webkit'])
def safari_browser(request):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = getattr(p, request.param).launch(headless=True)
        yield browser
        browser.close()


def setup(page, local_site, code, scheme):
    page.emulate_media(color_scheme=scheme)
    page.add_init_script('''code => {
      window.safariWrites=[];window.permissionRequests=[];
      window.safariModel={status:'login',autoSyncEnabled:false,language:code,userName:'',serverUrl:'https://betterilias.ch'};
      window.browser={runtime:{sendMessage:async message=>{
        safariWrites.push(message);
        if(message.type==='SAFARI_GET_STATUS')return {...safariModel};
        if(message.type==='SAFARI_SYNC'||message.type==='SAFARI_CHECK'){
          if(window.stallSync)await new Promise(resolve=>window.finishSafariSync=resolve);
          safariModel.status=window.failSync?'error':'connected';safariModel.userName='Test Student';
        }
        if(message.type==='SAFARI_PREFERENCES')Object.assign(safariModel,message);
        if(message.type==='SAFARI_LOGIN')safariModel.status='login';
        return {...safariModel};
      }},permissions:{request:async values=>{permissionRequests.push(values);return !window.denyPermission;}}};
    }'''.replace('code => {', f'(() => {{ const code={json.dumps(code)};') + ')();')
    page.goto(local_site+'/extensions/safari/popup.html')
    return json.loads((ROOT/'locales'/f'{code}.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('de','dark'),('de','light'),('en','dark'),('en','light')])
def test_safari_popup_manual_sync_preferences_and_resize(safari_browser,local_site,width,height,code,scheme):
    page=safari_browser.new_page(viewport={'width':width,'height':height})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    tr=setup(page,local_site,code,scheme)
    page.get_by_text(tr['safari.status.login'],exact=True).wait_for()
    assert page.evaluate("safariWrites.filter(m=>m.type==='SAFARI_CHECK').length") == 0
    page.get_by_role('button',name=tr['safari.sync'],exact=True).click()
    page.get_by_text(tr['safari.status.connected'],exact=True).wait_for()
    page.get_by_label(tr['safari.automatic'],exact=True).check()
    page.set_viewport_size({'width':430 if width==320 else 320,'height':740})
    assert page.get_by_label(tr['safari.automatic'],exact=True).is_checked()
    page.set_viewport_size({'width':width,'height':height})
    page.get_by_role('button',name=tr['safari.save'],exact=True).click()
    page.get_by_text(tr['safari.saved'],exact=True).wait_for()
    assert page.evaluate("safariWrites.some(m=>m.type==='SAFARI_PREFERENCES'&&m.autoSyncEnabled)")
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    folder=ROOT/'scratch/safari-native-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'{safari_browser.browser_type.name}-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    assert not errors
    assert 'PHPSESSID' not in page.locator('body').inner_text()
    page.close()


def test_safari_permission_retry_and_pending_actions(safari_browser,local_site):
    page=safari_browser.new_page(viewport={'width':320,'height':740});tr=setup(page,local_site,'en','light')
    page.get_by_text(tr['safari.status.login'],exact=True).wait_for()
    page.locator('summary').click();page.evaluate('window.denyPermission=true')
    page.get_by_role('button',name=tr['safari.grant'],exact=True).click()
    page.get_by_text(tr['safari.status.permission'],exact=True).wait_for()
    assert page.evaluate("permissionRequests[0].origins.join(',')") == 'https://ilias.unibe.ch/*,https://betterilias.ch/*'
    page.evaluate('window.denyPermission=false;window.stallSync=true')
    page.get_by_role('button',name=tr['safari.sync'],exact=True).click()
    page.get_by_text(tr['safari.status.checking'],exact=True).wait_for()
    assert page.get_by_role('button',name=tr['safari.open'],exact=True).is_disabled()
    page.evaluate('window.failSync=true;finishSafariSync()')
    page.get_by_text(tr['safari.status.error'],exact=True).wait_for()
    assert page.get_by_role('button',name=tr['safari.sync'],exact=True).is_enabled()
    page.evaluate('window.stallSync=false;window.failSync=false;safariModel.pageConnectionFailed=true')
    page.get_by_role('button',name=tr['safari.sync'],exact=True).click()
    page.get_by_text(tr['safari.page_retry'],exact=True).wait_for()
    page.get_by_role('button',name=tr['safari.open'],exact=True).click()
    page.wait_for_function("safariWrites.some(m=>m.type==='SAFARI_OPEN_APP')")
    page.close()


def test_safari_language_selection_is_saved(safari_browser,local_site):
    page=safari_browser.new_page(viewport={'width':390,'height':844});setup(page,local_site,'en','light')
    page.locator('#sync:enabled').wait_for()
    page.locator('#language').select_option('de')
    tr=json.loads((ROOT/'locales/de.json').read_text(encoding='utf-8'))
    page.get_by_role('button',name=tr['safari.sync'],exact=True).wait_for()
    page.get_by_role('button',name=tr['safari.save'],exact=True).click()
    page.get_by_text(tr['safari.saved'],exact=True).wait_for()
    assert page.evaluate("safariWrites.some(m=>m.type==='SAFARI_PREFERENCES'&&m.language==='de')")
    assert page.locator('html').get_attribute('lang') == 'de'
    page.close()
