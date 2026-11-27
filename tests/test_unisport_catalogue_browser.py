"""Chromium emulation with synthetic public and account-owned UniSport data."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit

import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language

ROOT=Path(__file__).resolve().parents[1]
pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in Chromium emulation')


def offer(identifier=1):
    return dict(id=identifier,title='Volleyball' if identifier==1 else 'Yoga '+str(identifier),sport='Ball sports' if identifier==1 else 'Yoga',
        begin='2026-12-01T18:00:00+01:00',end='2026-12-01T19:30:00+01:00',opens='2026-11-30T18:00:00+01:00',closes='',
        level='All levels',location='University Sports Hall',address='Bern',status='Registration opens tomorrow',free_places='8 places',
        cancelled=False,url='https://www.sport.unibe.ch/offer',infos=[{'title':'Equipment','content':'Shoes and water. <script>window.unisportInjected=true</script>'}])


def mock(page):
    calls=[];control={'fail':False,'deferred':None,'delay_saved':False}
    def handle(route):
        request=route.request;path=urlsplit(request.url).path;calls.append(path)
        assert request.method=='GET' and 'x-session-id' not in request.headers and 'cookie' not in request.headers
        if control['fail']:
            route.fulfill(status=502,content_type='application/json',body=json.dumps({'detail':'Synthetic refresh unavailable'}));return
        if path.endswith('/catalogue'):data={'items':[offer(i) for i in range(1,26)],'sports':['Ball sports','Yoga'],'fetched_at':time.time(),'stale':False}
        elif '/offers/' in path:data={'offer':offer(int(path.rsplit('/',1)[-1])),'fetched_at':time.time(),'stale':False}
        else:
            assert request.headers['x-unisport-scope']=='a'*64
            if control['delay_saved']:control['deferred']=route;return
            data={'items':[{'id':1,'title':'OLD PERSONAL TITLE'}]}
        route.fulfill(content_type='application/json',body=json.dumps(data))
    page.route('**/api/unisport/**',handle)
    return calls,control


def mount(page,scope='a'*64):
    page.evaluate('''async scope=>{
      const {UnisportCatalogue}=await import('/src/components/UnisportCatalogue.tsx');
      window.catalogueComponent=UnisportCatalogue;
      window.catalogueProps={credential:'x'.repeat(43),scope,affiliation:scope?'student':null};
      mountAudit(UnisportCatalogue,catalogueProps);
    }''',scope)


def shot(page,name):
    folder=ROOT/'scratch/unisport-catalogue-checks';folder.mkdir(parents=True,exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(folder/(name+'.png')),full_page=True)


@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_cached_catalogue_filter_details_focus_and_bookmarks(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme)
    calls,control=mock(page);mount(page)
    yoga = page.get_by_role('button', name='Yoga', exact=True)
    ball = page.get_by_role('button', name='Ball sports', exact=True)
    ball.wait_for()
    assert calls == ['/api/unisport/catalogue']
    query = page.get_by_label(tr['unisport.search_sports'], exact=True)
    query.fill('Yoga 2')
    yoga.wait_for()
    assert not ball.is_visible()
    page.set_viewport_size({'width': 1280 if width < 768 else 390, 'height': 844})
    assert query.input_value() == 'Yoga 2'
    page.set_viewport_size({'width': width, 'height': height})
    shot(page, f'filters-{width}-{height}-{code}-{scheme}')
    yoga.click()
    page.get_by_role('heading',name='Yoga',exact=True).wait_for()
    page.get_by_role('button',name='Yoga 2',exact=True).click()
    page.get_by_text('Equipment',exact=True).click()
    assert page.evaluate('window.unisportInjected') is None
    assert page.get_by_text('Shoes and water. <script>window.unisportInjected=true</script>',exact=True).is_visible()
    shot(page,f'detail-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button',name=tr['unisport.back_to_sports'],exact=True).click()
    assert yoga.evaluate('(element)=>document.activeElement===element')
    assert query.input_value()=='Yoga 2'
    query.fill('')
    page.get_by_role('button',name=tr['unisport.favourite_named'].format(name='Yoga'),exact=True).click()
    assert page.get_by_role('listitem').first.get_by_role('button',name='Yoga',exact=True).is_visible()
    yoga.click()
    page.get_by_role('button',name='Yoga 2',exact=True).click()
    page.get_by_text('Equipment',exact=True).wait_for()
    assert calls.count('/api/unisport/offers/2') == 1


def test_refresh_failure_keeps_cache_and_new_account_rejects_old_response(workflow_page):
    page=workflow_page;tr=language(page,'en','light');calls,control=mock(page);mount(page)
    page.get_by_role('button',name='Ball sports',exact=True).wait_for()
    control['fail']=True;page.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.get_by_role('alert').filter(has_text='Synthetic refresh unavailable').wait_for()
    assert page.get_by_role('button',name='Ball sports',exact=True).count()==1
    control.update(fail=False,delay_saved=True)
    page.evaluate("mountAudit(catalogueComponent,{...catalogueProps,view:'my_sport'})")
    page.wait_for_timeout(200);assert control['deferred'] is not None
    page.evaluate("mountAudit(catalogueComponent,{...catalogueProps,scope:'b'.repeat(64),affiliation:null,view:'my_sport'})")
    control['deferred'].fulfill(content_type='application/json',body=json.dumps({'items':[{'id':1,'title':'OLD ACCOUNT'}]}))
    page.wait_for_timeout(150)
    assert page.get_by_role('button',name='Ball sports',exact=True).count()==0
    assert page.get_by_text('OLD ACCOUNT',exact=True).count()==0


def test_indexeddb_survives_remount_and_explicit_refresh_bypasses_it(workflow_page):
    page=workflow_page;tr=language(page,'en','light');calls,control=mock(page);mount(page,scope=None)
    page.get_by_role('button',name='Ball sports',exact=True).wait_for()
    page.wait_for_function('''()=>new Promise(resolve=>{
      const request=indexedDB.open('betterilias-unisport-public-v1');request.onsuccess=()=>{
        const read=request.result.transaction('public').objectStore('public').get('catalogue:en');
        read.onsuccess=()=>{resolve(Boolean(read.result));request.result.close()};
      };
    })''')
    # Reload clears module memory while preserving IndexedDB and origin.
    page.reload()
    page.evaluate('''async()=>{
          const refresh=(await import('/@react-refresh')).default;refresh.injectIntoGlobalHook(window);
          window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
          const R=(await import('/node_modules/.vite/deps/react.js')).default;
          const RD=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          window.auditRoot=RD.createRoot(document.getElementById('audit-root'));
          window.mountAudit=(Component,props)=>auditRoot.render(R.createElement(Component,props));
    }''')
    mount(page,scope=None)
    page.get_by_role('button',name='Ball sports',exact=True).wait_for()
    assert calls==['/api/unisport/catalogue']
    page.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.wait_for_timeout(150)
    assert calls==['/api/unisport/catalogue']*2
