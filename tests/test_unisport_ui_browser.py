"""Mocked Chromium UI coverage; no real SWITCH account or bookings."""
import json
import os
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
