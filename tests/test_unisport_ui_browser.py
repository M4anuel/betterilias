"""Mocked Chromium UI coverage; no real SWITCH account or bookings."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium emulation')


def mount(page, connected=False):
    state = {'phase': 'connected' if connected else 'disconnected', 'affiliation': None, 'scope': 'a' * 64 if connected else None}
    writes = []
    def api(route):
        request = route.request; path = urlsplit(request.url).path
        assert 'x-session-id' not in request.headers and 'cookie' not in request.headers
        assert len(request.headers['x-unisport-session']) == 43
        if request.method != 'GET': writes.append((path, request.method, request.post_data_json))
        if path.endswith('/auth/start'):
            state['phase'] = 'pending'; data = dict(authorization_url='https://login.eduid.ch/synthetic', state='x' * 43)
        elif path.endswith('/catalogue'): data = {'items': [], 'sports': [], 'fetched_at': 1795459500, 'stale': False}
        elif path.endswith('/affiliations'): data = {'affiliations': ['student@example.edu', 'staff@example.edu']}
        elif path.endswith('/affiliation'):
            state['affiliation'] = request.post_data_json['affiliation']; data = {'affiliation': state['affiliation']}
        elif path.endswith('/applications'): data = [{'id': 1, 'title': 'Volleyball', 'registration': 'Confirmed', 'offerNextDate': {'begin': '2026-12-01 18:00'}}]
        else:
            if request.method == 'DELETE': state.update(phase='disconnected', affiliation=None)
            data = dict(state)
        route.fulfill(content_type='application/json', body=json.dumps(data))
    page.route('**/api/unisport/**', api)
    page.evaluate('''async()=>{
      localStorage.setItem('betterilias_session_id','must-not-be-forwarded');
      window.addEventListener('message',event=>{
        if(event.source===window&&['UNISPORT_PING','UNISPORT_START'].includes(event.data?.type)){
          postMessage({type:'UNISPORT_REPLY',requestId:event.data.requestId,success:!window.failCompanion},location.origin);
        }
      });
      const {UnisportView}=await import('/src/components/UnisportView.tsx');mountAudit(UnisportView,{});
    }''')
    return state, writes


def shot(page, name):
    directory = ROOT / 'scratch/unisport-checks'; directory.mkdir(parents=True, exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(directory / (name + '.png')), full_page=True)


def wait_routes(page, routes, count):
    deadline=time.monotonic()+5
    while len(routes)<count and time.monotonic()<deadline:
        page.wait_for_timeout(20)
    assert len(routes)==count


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_affiliation_explicit_save_registrations_disconnect(workflow_page, width, height, code, scheme):
    page = workflow_page; page.set_viewport_size({'width':width,'height':height}); tr = language(page,code,scheme)
    state, writes = mount(page, connected=True)
    select = page.get_by_label(tr['unisport.affiliation'], exact=True)
    select.wait_for()
    page.get_by_role('button', name=tr['unisport.save_affiliation'],exact=True).wait_for(state='visible')
    page.wait_for_function('document.querySelector("select").options.length===3')
    select.select_option('student@example.edu')
    assert writes == []
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert select.input_value() == 'student@example.edu'
    page.set_viewport_size({'width':width,'height':height})
    shot(page,f'affiliation-{width}-{height}-{code}-{scheme}')
    select.focus(); page.keyboard.press('Tab'); page.keyboard.press('Enter')
    page.get_by_role('button',name=tr['unisport.load_applications'],exact=True).click()
    page.get_by_role('heading',name='Volleyball',exact=True).wait_for()
    assert state['affiliation'] == 'student@example.edu'
    shot(page,f'registrations-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button',name=tr['unisport.disconnect'],exact=True).click()
    page.get_by_role('button',name=tr['unisport.connect'],exact=True).wait_for()
    assert page.get_by_role('heading',name='Volleyball',exact=True).count() == 0


def test_login_pending_cancel_failure_and_retry(workflow_page):
    page=workflow_page; tr=language(page,'de','dark'); state,writes=mount(page)
    connect=page.get_by_role('button',name=tr['unisport.connect'],exact=True)
    connect.click()
    page.get_by_role('status').filter(has_text=tr['unisport.waiting']).wait_for()
    page.get_by_role('button',name=tr['unisport.cancel'],exact=True).click()
    connect.wait_for(); page.wait_for_function('!document.querySelector("button[aria-busy=true]")')
    page.evaluate('window.failCompanion=true'); connect.click()
    page.get_by_role('alert').filter(has_text=tr['unisport.companion_required']).wait_for()
    assert len([w for w in writes if w[0].endswith('/auth/start')]) == 1
    page.evaluate('window.failCompanion=false'); connect.click()
    page.get_by_role('button',name=tr['unisport.cancel'],exact=True).wait_for()
    state.update(phase='connected')
    page.evaluate("postMessage({type:'UNISPORT_FINISHED',success:true},location.origin)")
    page.get_by_label(tr['unisport.affiliation'],exact=True).wait_for()
    assert page.get_by_role('alert').count() == 0


@pytest.mark.parametrize('width', [390, 1280])
def test_app_navigation_and_history_without_ilias_login(workflow_page, width):
    page=workflow_page; page.set_viewport_size({'width':width,'height':844}); tr=language(page,'en','light')
    mount(page)
    page.route('**/api/unisport/availability', lambda route: route.fulfill(content_type='application/json',body='{"enabled":true}'))
    page.evaluate('''async()=>{
      const {api}=await import('/src/lib/api.ts');
      api.getAuthStatus=async()=>({authenticated:false,cookies_present:false});
      api.getSemesters=async semester=>({semester:semester||'HS2026',active_semester:semester||'HS2026',available_semesters:['HS2026','FS2026'],courses:[],grouped_by_category:{}});
      history.replaceState(null,'','?view=unisport&semester=HS2026');
      const {App}=await import('/src/App.tsx');mountAudit(App,{});
    }''')
    page.get_by_role('heading',name=tr['unisport.title'],exact=True).wait_for()
    page.get_by_role('button',name=tr['unisport.connect'],exact=True).wait_for()
    assert page.locator('dialog[open]').count()==0
    if width<768: page.get_by_role('button',name=tr['Sidebar umschalten'],exact=True).click()
    nav=page.get_by_role('button',name=tr['unisport.title'],exact=True)
    assert nav.get_attribute('aria-current')=='page'
    page.get_by_role('button',name=tr['Semester-Übersicht'],exact=True).click()
    page.wait_for_function('!location.search.includes("view=unisport")')
    if width<768: page.get_by_role('button',name=tr['Sidebar umschalten'],exact=True).click()
    page.get_by_role('button',name=tr['unisport.title'],exact=True).click()
    page.get_by_role('heading',name=tr['unisport.title'],exact=True).wait_for()
    page.go_back(); page.wait_for_function('!location.search.includes("view=unisport")')
    page.go_forward(); page.get_by_role('heading',name=tr['unisport.title'],exact=True).wait_for()
    # The mobile drawer remains mounted while hidden; it still has one selection.
    assert page.locator('aside button[aria-current="page"]').count()==1
    page.mouse.move(width-5, 80)
    shot(page,f'app-navigation-{width}-en-light')


@pytest.mark.parametrize('width', [320, 768, 1280])
@pytest.mark.parametrize('mode', ['disabled', 'failed', 'enabled'])
def test_app_hides_unisport_until_server_explicitly_enables_it(workflow_page,width,mode):
    page=workflow_page;page.set_viewport_size({'width':width,'height':844});tr=language(page,'de','dark')
    calls=[]
    def handle(route):
        path=urlsplit(route.request.url).path;calls.append(path)
        if path.endswith('/availability'):
            route.fulfill(status=503 if mode=='failed' else 200,content_type='application/json',body=json.dumps({'enabled':mode=='enabled'}))
        elif path.endswith('/catalogue'):
            route.fulfill(content_type='application/json',body='{"items":[],"sports":[],"stale":false,"fetched_at":1795459500}')
        else:route.fulfill(content_type='application/json',body='{"phase":"disconnected","affiliation":null}')
    page.route('**/api/unisport/**',handle)
    page.evaluate('''async()=>{
      const {api}=await import('/src/lib/api.ts');
      api.getAuthStatus=async()=>({authenticated:false,cookies_present:false});
      api.getSemesters=async semester=>({semester:semester||'HS2026',active_semester:semester||'HS2026',available_semesters:['HS2026'],courses:[],grouped_by_category:{}});
      history.replaceState(null,'','?view=unisport');
      const {App}=await import('/src/App.tsx');mountAudit(App,{});
    }''')
    page.wait_for_function("performance.getEntriesByType('resource').some(item=>item.name.endsWith('/api/unisport/availability'))")
    if mode=='enabled':page.get_by_role('heading',name=tr['unisport.title'],exact=True).wait_for()
    else:
        page.wait_for_timeout(100)
        assert page.get_by_role('heading',name=tr['unisport.title'],exact=True).count()==0
        assert calls==['/api/unisport/availability']
    if width<1024:page.get_by_role('button',name=tr['Sidebar umschalten'],exact=True).click()
    assert page.get_by_role('button',name=tr['unisport.title'],exact=True).count()==(1 if mode=='enabled' else 0)
    page.get_by_role('button',name=tr['Vorlesungen anpassen'],exact=True).click()
    page.locator('[data-nav-card=semester]').wait_for(state='visible')
    # The hidden feature must not remain available in sidebar customisation.
    assert page.locator('[data-nav-card=unisport]').count()==(1 if mode=='enabled' else 0)
    shot(page,f'availability-{mode}-{width}-de-dark')


@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_ilias_exchange_confirmation_pending_failure_and_activation(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme)
    requests=[]
    page.route('**/api/unisport/ilias-connection',lambda route:requests.append(route))
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');window.iliasCache=cache;
      cache.setSessionId('previous-ilias-capability');window.activations=[];
      localStorage.setItem('ilias_materials_cache_previous','synthetic old draft');
      document.addEventListener('BETTERILIAS_SESSION_SYNCED',e=>activations.push(e.detail));
      const {UnisportIliasConnection}=await import('/src/components/UnisportIliasConnection.tsx');
      window.bridgeComponent=UnisportIliasConnection;
      window.bridgeProps={credential:'x'.repeat(43),scope:'a'.repeat(64),affiliation:'student'};
      mountAudit(bridgeComponent,bridgeProps);
    }''')
    action=page.get_by_role('button',name=tr['unisport.ilias_connect'],exact=True)
    action.click();modal=page.locator('dialog[open]')
    wait_routes(page,requests,1)
    assert requests[0].request.method=='POST'
    headers=requests[0].request.headers
    assert headers['x-unisport-session']=='x'*43 and headers['x-unisport-scope']=='a'*64 and headers['x-unisport-affiliation']=='student'
    assert headers['x-session-id']=='previous-ilias-capability' and 'cookie' not in headers and 'authorization' not in headers
    assert modal.count()==0
    page.get_by_text(tr['unisport.ilias_connect_pending'],exact=True).wait_for()
    assert action.is_disabled() and action.locator('svg.animate-spin').count()==1
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert action.is_disabled()
    page.set_viewport_size({'width':width,'height':height})
    shot(page,f'ilias-exchange-pending-{width}-{height}-{code}-{scheme}')
    requests[0].fulfill(status=502,content_type='application/json',body=json.dumps({'detail':tr['unisport.ilias_connect_failed']}))
    page.get_by_text(tr['unisport.ilias_connect_failed'],exact=True).wait_for()
    assert page.evaluate('iliasCache.getSessionId()')=='previous-ilias-capability'
    assert page.evaluate("localStorage.getItem('ilias_materials_cache_previous')")=='synthetic old draft'
    assert page.evaluate('activations')==[]
    assert page.evaluate("localStorage.getItem('betterilias_ilias_source')") is None
    action.click()
    wait_routes(page,requests,2)
    requests[1].fulfill(content_type='application/json',body=json.dumps({'authenticated':True,'session_id':'n'*43,'user_name':'Synthetic Student'}))
    modal.get_by_text(tr['unisport.ilias_replace_confirm'].replace('{name}','Synthetic Student'),exact=True).wait_for()
    assert page.evaluate('activations')==[]
    shot(page,f'ilias-account-switch-{width}-{height}-{code}-{scheme}')
    modal.get_by_role('button',name=tr['Abbrechen'],exact=True).click()
    assert page.evaluate('iliasCache.getSessionId()')=='previous-ilias-capability'
    assert page.evaluate("localStorage.getItem('ilias_materials_cache_previous')")=='synthetic old draft'
    action.click();wait_routes(page,requests,3)
    requests[2].fulfill(content_type='application/json',body=json.dumps({'authenticated':True,'session_id':'n'*43,'user_name':'Synthetic Student'}))
    modal.get_by_role('button',name=tr['unisport.ilias_connect'],exact=True).click()
    page.wait_for_function('activations.length===1')
    assert page.evaluate('activations[0].sessionId')=='n'*43
    assert page.evaluate("localStorage.getItem('betterilias_ilias_source')")=='unisport'
    page.get_by_text(tr['unisport.ilias_connect_success'].replace('{name}','Synthetic Student'),exact=True).wait_for()


@pytest.mark.parametrize('change',['ilias-account','unisport-affiliation','unmount','network'])
def test_ilias_exchange_ignores_stale_results_after_account_changes(workflow_page,change):
    page=workflow_page;tr=language(page,'en','light');requests=[]
    page.route('**/api/unisport/ilias-connection',lambda route:requests.append(route))
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');window.iliasCache=cache;cache.setSessionId(null);window.activations=[];
      document.addEventListener('BETTERILIAS_SESSION_SYNCED',e=>activations.push(e.detail));
      const {UnisportIliasConnection}=await import('/src/components/UnisportIliasConnection.tsx');
      window.bridgeComponent=UnisportIliasConnection;window.bridgeProps={credential:'x'.repeat(43),scope:'a'.repeat(64),affiliation:'student'};
      mountAudit(bridgeComponent,bridgeProps);
    }''')
    page.get_by_role('button',name=tr['unisport.ilias_connect'],exact=True).click()
    wait_routes(page,requests,1)
    if change=='ilias-account':page.evaluate("iliasCache.setSessionId('newer-ilias-capability')")
    elif change=='unisport-affiliation':page.evaluate("mountAudit(bridgeComponent,{...bridgeProps,affiliation:'staff'})")
    elif change=='unmount':page.evaluate('mountAudit(()=>null,{})')
    if change=='network':
        requests[0].abort()
        page.get_by_text(tr['unisport.ilias_connect_failed'],exact=True).wait_for()
    else:requests[0].fulfill(content_type='application/json',body=json.dumps({'authenticated':True,'session_id':'n'*43,'user_name':'Synthetic Student'}))
    page.wait_for_timeout(100)
    assert page.evaluate('activations')==[]
    assert page.evaluate('iliasCache.getSessionId()')==('newer-ilias-capability' if change=='ilias-account' else None)


@pytest.mark.parametrize('code,scheme',[('en','light'),('de','dark')])
def test_same_account_renewal_keeps_cache_without_confirmation(workflow_page,code,scheme):
    page=workflow_page;tr=language(page,code,scheme);requests=[]
    page.route('**/api/unisport/ilias-connection',lambda route:requests.append(route))
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');window.iliasCache=cache;
      cache.setSessionId('p'.repeat(43));window.activations=[];
      localStorage.setItem('ilias_materials_cache_previous','synthetic draft');
      document.addEventListener('BETTERILIAS_SESSION_SYNCED',e=>{
        activations.push(e.detail);cache.setSessionId(e.detail.sessionId);
      });
      const {UnisportIliasConnection}=await import('/src/components/UnisportIliasConnection.tsx');
      mountAudit(UnisportIliasConnection,{credential:'x'.repeat(43),scope:'a'.repeat(64),affiliation:'student'});
    }''')
    page.get_by_role('button',name=tr['unisport.ilias_connect'],exact=True).click()
    wait_routes(page,requests,1)
    requests[0].fulfill(content_type='application/json',body=json.dumps({'authenticated':True,'session_id':'p'*43,'user_name':'Synthetic Student','renewed':True}))
    page.wait_for_function('activations.length===1')
    assert page.locator('dialog[open]').count()==0
    assert page.evaluate('iliasCache.getSessionId()')=='p'*43
    assert page.evaluate('activations[0].renewed') is True
    assert page.evaluate("localStorage.getItem('ilias_materials_cache_previous')")=='synthetic draft'


def test_app_renewal_preserves_request_scope_and_correction_file_cache(workflow_page):
    page=workflow_page
    page.route('**/api/unisport/availability',lambda route:route.fulfill(content_type='application/json',body='{"enabled":false}'))
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');window.renewalCache=cache;cache.setSessionId('p'.repeat(43));
      localStorage.setItem('betterilias_ilias_source','unisport');
      window.renewalScope=cache.getRequestScope();window.authChecks=0;
      localStorage.setItem('ilias_materials_cache_previous','synthetic draft');
      const {feedbackFilesCache}=await import('/src/lib/feedbackFilesCache.ts');window.renewalFiles=feedbackFilesCache;
      await feedbackFilesCache.write('synthetic-resource',{member_id:'1',files:[{id:'review',title:'Correction.pdf'}]});
      const {api}=await import('/src/lib/api.ts');
      api.getAuthStatus=async()=>{authChecks++;return {authenticated:true,cookies_present:true,user_name:'Synthetic Student'};};
      api.getSemesters=async semester=>({semester:semester||'HS2026',active_semester:'HS2026',available_semesters:['HS2026'],courses:[],grouped_by_category:{}});
      const {App}=await import('/src/App.tsx');mountAudit(App,{});
    }''')
    page.wait_for_function('authChecks>0')
    page.evaluate('''()=>{
      window.previousChecks=authChecks;
      document.dispatchEvent(new CustomEvent('BETTERILIAS_SESSION_SYNCED',{detail:{sessionId:'p'.repeat(43),source:'unisport',renewed:true}}));
    }''')
    page.wait_for_function('authChecks>previousChecks')
    assert page.evaluate('renewalCache.getRequestScope().key===renewalScope.key && !renewalScope.signal.aborted')
    assert page.evaluate("localStorage.getItem('ilias_materials_cache_previous')")=='synthetic draft'
    assert page.evaluate("renewalFiles.read('synthetic-resource',()=>{throw new Error('Renewal discarded correction cache');}).then(r=>r.files[0].title)")=='Correction.pdf'
    page.evaluate('''()=>{
      localStorage.setItem('betterilias_session_id','obsolete-companion-session');
      document.dispatchEvent(new CustomEvent('BETTERILIAS_SESSION_SYNCED',{detail:{sessionId:'obsolete-companion-session'}}));
      postMessage({type:'BETTERILIAS_SESSION_SYNCED',sessionId:'obsolete-companion-session'},location.origin);
    }''')
    page.wait_for_timeout(100)
    assert page.evaluate('renewalCache.getSessionId()')=='p'*43
    assert page.evaluate("localStorage.getItem('betterilias_session_id')")=='p'*43
    assert page.evaluate("localStorage.getItem('ilias_materials_cache_previous')")=='synthetic draft'
    assert page.evaluate('renewalCache.getRequestScope().key===renewalScope.key && !renewalScope.signal.aborted')


def test_unibe_selection_survives_legacy_companion_before_cache_initialization(workflow_page):
    result=workflow_page.evaluate('''async()=>{
      localStorage.setItem('betterilias_ilias_source','unisport');
      localStorage.setItem('betterilias_cache_owner','p'.repeat(43));
      localStorage.setItem('betterilias_session_id','obsolete-companion-session');
      localStorage.setItem('ilias_materials_cache_previous','synthetic draft');
      const {cache}=await import('/src/lib/cache.ts?legacy-companion-startup');
      const selected=cache.getSessionId(),stored=localStorage.getItem('betterilias_session_id');
      const ignored=!cache.acceptSessionSync('obsolete-companion-session');
      const draft=localStorage.getItem('ilias_materials_cache_previous');
      localStorage.removeItem('betterilias_ilias_source');
      const manual=cache.acceptSessionSync('manual-companion-session');
      return {selected,stored,ignored,draft,manual,afterManual:cache.getSessionId()};
    }''')
    assert result=={'selected':'p'*43,'stored':'p'*43,'ignored':True,'draft':'synthetic draft','manual':True,'afterManual':'manual-companion-session'}
