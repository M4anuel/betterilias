"""Actual app API logout and privacy dialog, Chromium emulation, synthetic requests."""
import json
import os
import pytest
from tests.test_state_machine_browser import ROOT,workflow_site,workflow_browser,workflow_page

pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in browser checks')


@pytest.mark.parametrize('source',['legacy','unisport'])
def test_app_logout_ends_both_connections_and_blocks_stale_sync(workflow_page,source):
    result=workflow_page.evaluate('''async source=>{
      const {cache}=await import('/src/lib/cache.ts');const {api}=await import('/src/lib/api.ts');
      cache.setSessionId('owner');
      if(source==='unisport')localStorage.setItem('betterilias_ilias_source','unisport');
      localStorage.setItem('betterilias_unisport_session','c'.repeat(43));
      sessionStorage.setItem('betterilias_unisport_private_v1:synthetic','private-list');
      const calls=[];window.fetch=async(url,init)=>{
        calls.push({url,method:init.method,headers:Object.fromEntries(new Headers(init.headers))});
        return new Response(JSON.stringify({success:true,ilias_logout_confirmed:true}));
      };
      await api.logout();const status=await api.getAuthStatus();
      return {calls,authenticated:status.authenticated,provider:localStorage.getItem('betterilias_unisport_session'),
        paused:localStorage.getItem('betterilias_logout_paused'),private:sessionStorage.getItem('betterilias_unisport_private_v1:synthetic'),
        accepted:cache.acceptSessionSync('cached-old-session'),session:cache.getSessionId()};
    }''',source)
    assert result['authenticated'] is False and result['provider'] is None and result['private'] is None
    assert result['paused']=='1' and result['accepted'] is False and result['session']=='owner'
    assert [(row['url'],row['method']) for row in result['calls']]==[('/api/auth/logout','POST'),('/api/auth/unibe/connection','DELETE')]
    assert result['calls'][0]['headers']['x-ilias-logout']=='1'


@pytest.mark.parametrize('code,scheme',[('de','dark'),('en','light')])
@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,900),(1280,900),(844,390)])
def test_named_usage_disclosure_in_app_privacy_dialog(workflow_page,code,scheme,width,height):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});page.emulate_media(color_scheme=scheme)
    page.evaluate("dark=>document.documentElement.classList.toggle('dark',dark)",scheme=='dark')
    tr=json.loads((ROOT/'locales'/f'{code}.json').read_text(encoding='utf-8'))
    page.evaluate('''async code=>{
      const {setLanguage}=await import('/src/lib/i18n.ts');setLanguage(code);
      const {LegalModal}=await import('/src/components/LegalModal.tsx');mountAudit(LegalModal,{isOpen:true,onClose:()=>{},initialTab:'privacy'});
    }''',code)
    notice=page.get_by_text(tr['legal.privacy_account_usage'],exact=True);notice.scroll_into_view_if_needed()
    assert notice.is_visible()
    folder=ROOT/'scratch/companion-followup-review';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'privacy-{width}-{height}-{code}-{scheme}.png'))
