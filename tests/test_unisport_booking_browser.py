"""Native booking UI in Chromium emulation; all provider responses synthetic."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit

import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language
from tests.test_unisport_catalogue_browser import offer

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium emulation')


def field(identifier, kind='textField', **values):
    return dict(id=identifier, kind=kind, title=identifier, required=True, choices=[], when=[], **values)


def mock(page, kind='apply'):
    record = dict(intent='i'*43, phase='ready', kind=kind, offer=offer(), begin=offer()['begin'],
        expires_at=time.time()+600, fields=[], confirmation='', provider_status='')
    control = {'record': record, 'calls': [], 'deferred': None, 'hold': False, 'fail': False}
    def handle(route):
        request = route.request; path = urlsplit(request.url).path
        assert request.headers['x-unisport-scope'] == 'a'*64
        assert request.headers['x-unisport-affiliation'] == 'student'
        assert 'x-session-id' not in request.headers and 'cookie' not in request.headers
        body = request.post_data_json if request.method == 'POST' else None
        control['calls'].append((request.method, path, body))
        if path.endswith('/booking'):
            assert request.method == 'POST' and body['begin'] == offer()['begin']
        elif request.method == 'POST':
            if body['step'] == 'start':
                if kind == 'cancel': record.update(phase='confirmation', confirmation='Synthetic cancellation fee: CHF 5.')
                else: record.update(phase='form', fields=[
                    field('Name'),
                    {**field('Size', 'radioType'), 'choices': [{'id':'small','title':'Small'}, {'id':'large','title':'Large'}]},
                    {**field('Explanation', 'textArea'), 'when': [{'id':'Size', 'value':'large'}]},
                    field('Date', 'dateType'),
                    {**field('Document', 'fileType'), 'required':False},
                    {**field('Equipment', 'checkBox'), 'choices':[{'id':'shoes','title':'Shoes'}, {'id':'mat','title':'Mat'}]},
                    {**field('Location', 'dropDown'), 'choices':[{'id':'bern','title':'Bern'}, {'id':'thun','title':'Thun'}]},
                ])
            else:
                if control['hold']: control['deferred'] = route; return
                record.update(phase='confirmed', provider_status='Registered: waiting list' if kind=='apply' else 'Open')
        route.fulfill(content_type='application/json', body=json.dumps(record))
    page.route('**/api/unisport/**', handle)
    return control


def mount(page, kind='auto'):
    page.evaluate('''async kind=>{
      const {UnisportBooking}=await import('/src/components/UnisportBooking.tsx');
      window.bookingComponent=UnisportBooking;
      window.bookingProps={credential:'x'.repeat(43),scope:'a'.repeat(64),affiliation:'student',offerId:1,
        begin:'2026-12-01T18:00:00+01:00',kind};
      mountAudit(UnisportBooking,bookingProps);
    }''', kind)


def shot(page, name):
    folder=ROOT/'scratch/unisport-booking-checks'; folder.mkdir(parents=True, exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    modal=page.locator('dialog[open]').first
    assert modal.evaluate('(node)=>node.getBoundingClientRect().width<=innerWidth && node.getBoundingClientRect().height<=innerHeight')
    page.screenshot(path=str(folder/(name+'.png')), full_page=True)


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_native_form_drafts_conditions_pending_and_read_only_recheck(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme)
    control=mock(page);mount(page)
    invoker=page.get_by_role('button',name=tr['unisport.manage_registration'],exact=True);invoker.click()
    modal=page.locator('dialog[open]').first
    page.get_by_label(tr['unisport.accept_terms'],exact=True).check()
    shot(page,f'ready-{width}-{height}-{code}-{scheme}')
    modal.get_by_role('button',name=tr['unisport.register_now'],exact=True).click()
    name=page.get_by_label('Name',exact=False);name.fill('Synthetic student')
    page.get_by_label('Large',exact=True).check()
    page.get_by_label('Explanation',exact=False).fill('Draft kept across resizing and closing')
    page.get_by_label('Date',exact=False).fill('2031-12-01')
    page.get_by_label('Shoes',exact=True).check()
    page.get_by_label('Location',exact=False).select_option('bern')
    page.get_by_label('Document',exact=False).set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic only'})
    page.get_by_text(tr['unisport.selected_file'].replace('{name}','synthetic.txt'),exact=True).wait_for()
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert name.input_value()=='Synthetic student'
    modal.get_by_role('button',name=tr.get('Schliessen','Close'),exact=True).click()
    assert invoker.evaluate('(node)=>document.activeElement===node')
    invoker.click()
    assert name.input_value()=='Synthetic student'
    assert page.get_by_label('Explanation',exact=False).input_value()=='Draft kept across resizing and closing'
    page.set_viewport_size({'width':width,'height':height})
    shot(page,f'form-{width}-{height}-{code}-{scheme}')
    page.get_by_label('Small',exact=True).check()
    assert page.get_by_label('Explanation',exact=False).count()==0
    control['hold']=True
    submit=modal.get_by_role('button',name=tr['unisport.submit_registration'],exact=True);submit.click()
    page.wait_for_timeout(80)
    assert control['deferred'] is not None and submit.get_attribute('aria-busy')=='true'
    assert modal.get_by_role('button',name=tr.get('Schliessen','Close'),exact=True).is_disabled()
    assert len(control['calls'])==3
    payload=control['calls'][-1][2]['answers']
    assert payload['Name']==['Synthetic student'] and 'Explanation' not in payload
    assert payload['Date']==['2031-12-01'] and payload['Document']==['c3ludGhldGljIG9ubHk=']
    shot(page,f'pending-{width}-{height}-{code}-{scheme}')
    control['record'].update(phase='uncertain')
    control['deferred'].abort('failed')
    page.get_by_role('button',name=tr['unisport.check_booking'],exact=True).wait_for()
    control['record'].update(phase='confirmed',provider_status='Registered: waiting list')
    page.get_by_role('button',name=tr['unisport.check_booking'],exact=True).click()
    page.get_by_text(tr['unisport.registration_confirmed'],exact=True).wait_for()
    assert [call[0] for call in control['calls']]==['POST','POST','POST','GET']
    shot(page,f'confirmed-{width}-{height}-{code}-{scheme}')


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_cancellation_requires_the_provider_confirmation_and_resume_never_posts(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme);control=mock(page,'cancel');mount(page,'cancel')
    page.get_by_role('button',name=tr['unisport.cancel_registration'],exact=True).click()
    page.get_by_role('button',name=tr['unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text('Synthetic cancellation fee: CHF 5.',exact=True).wait_for()
    shot(page,f'cancellation-{width}-{height}-{code}-{scheme}')
    assert len(control['calls'])==2
    page.get_by_role('button',name=tr['unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text(tr['unisport.cancellation_confirmed'],exact=True).wait_for()
    assert [call[2].get('step') for call in control['calls'][1:]]==['start','confirm']
    page.get_by_role('button',name=tr['Schliessen'],exact=True).click()
    page.evaluate('auditRoot.render(null)');page.wait_for_timeout(50)
    page.evaluate('mountAudit(bookingComponent,bookingProps)')
    page.get_by_role('button',name=tr['unisport.cancel_registration'],exact=True).click()
    page.get_by_text(tr['unisport.cancellation_confirmed'],exact=True).wait_for()
    assert control['calls'][-1][0]=='GET' and len(control['calls'])==4


def test_personal_list_invalidation_preserves_the_open_cancellation_dialog(workflow_page):
    page=workflow_page;tr=language(page,'en','light');control={'cancelled':False,'apps':0,'writes':0}
    operation=dict(intent='i'*43,phase='ready',kind='cancel',offer=offer(),begin=offer()['begin'],
        expires_at=time.time()+600,fields=[],confirmation='',provider_status='')
    def handle(route):
        request=route.request;path=urlsplit(request.url).path
        if path.endswith('/connection'):data={'phase':'connected','affiliation':'student','scope':'a'*64}
        elif path.endswith('/affiliations'):data={'affiliations':['student']}
        elif path.endswith('/catalogue'):data={'items':[offer()],'sports':['Ball sports'],'fetched_at':time.time(),'stale':False}
        elif path.endswith('/bookmarks'):data={'items':[]}
        elif path.endswith('/applications'):
            control['apps']+=1
            data=[] if control['cancelled'] else [{'id':1,'title':'Volleyball','begin':offer()['begin'],'status':8}]
        elif path.endswith('/booking'):data=operation
        elif '/bookings/' in path:
            control['writes']+=1
            if request.post_data_json['step']=='start':operation.update(phase='confirmation',confirmation='Confirm cancellation fee.')
            else:operation.update(phase='confirmed',provider_status='Open');control['cancelled']=True
            data=operation
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps(data))
    page.route('**/api/unisport/**',handle)
    page.evaluate('''async()=>{const {UnisportView}=await import('/src/components/UnisportView.tsx');mountAudit(UnisportView,{})}''')
    page.get_by_role('navigation', name=tr['unisport.title']).get_by_role('button', name=tr['unisport.my_sport'], exact=True).click()
    page.get_by_role('button',name=tr['unisport.cancel_registration'],exact=True).click()
    page.get_by_role('button',name=tr['unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text('Confirm cancellation fee.',exact=True).wait_for()
    assert control['apps']==1
    page.get_by_role('button',name=tr['unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text(tr['unisport.cancellation_confirmed'],exact=True).wait_for()
    assert control['apps']==1 and control['writes']==2
    page.get_by_role('button',name=tr['Schliessen'],exact=True).click()
    page.get_by_text(tr['unisport.no_applications'],exact=True).wait_for()
    assert control['apps']==2


def test_quick_registration_uses_one_click_and_confirms_readback(workflow_page):
    page = workflow_page
    tr = language(page, 'en', 'light')
    selected = offer()
    calls = []
    receipt = dict(intent='i' * 43, phase='ready', kind='apply', offer=selected, begin=selected['begin'],
                   fields=[], confirmation='', provider_status='', expires_at=time.time()+600)

    def handle(route):
        assert route.request.method == 'POST'
        path = urlsplit(route.request.url).path
        calls.append(route.request.post_data_json)
        if '/bookings/' in path:
            assert route.request.post_data_json == {'step': 'quick'}
            assert page.evaluate("Object.values(sessionStorage).includes('i'.repeat(43))")
            receipt.update(phase='confirmed', provider_status='Registered')
        route.fulfill(content_type='application/json', body=json.dumps(receipt))

    page.route('**/api/unisport/**', handle)
    page.evaluate('''async begin => {
      const {UnisportBooking} = await import('/src/components/UnisportBooking.tsx');
      mountAudit(UnisportBooking, {credential:'x'.repeat(43), scope:'a'.repeat(64), affiliation:'student',
        offerId:1, begin, kind:'apply', quick:true});
    }''', selected['begin'])
    page.get_by_role('button', name=tr['unisport.register_now'], exact=True).click()
    page.get_by_text(tr['unisport.registration_confirmed'], exact=True).wait_for()
    assert calls == [{'kind': 'apply', 'begin': selected['begin']}, {'step': 'quick'}]
