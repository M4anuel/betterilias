"""Official participant-list navigation; synthetic accounts and names only."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit

import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language
from tests.test_unisport_catalogue_browser import offer

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL = 'https://www.zssw.unibe.ch/usp/zms/angebot/3003/index_ger.html'
PARTICIPANTS = 'https://www.zssw.unibe.ch/usp/zms/aii/anmeldeliste/3003/index_ger.html'
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium emulation')

HTML = '''<table class="ZMSTable"><tr><th>Nachname</th><th>Vorname</th><th>Angebot</th></tr>
<tr><td>Example</td><td>Ada</td><td>Archery</td></tr><tr><td>Müller</td><td>Lin</td><td>Yoga</td></tr>
<tr><td>Test</td><td>Noah</td><td>Archery</td></tr></table>
<script>window.participantsExecuted=true</script><img src="https://untrusted.invalid/pixel">'''


def companion(page):
    page.evaluate('''html=>{
      window.participantHtml=html;window.webContext='b'.repeat(64);window.participantReads=0;window.participantFailure='';
      window.addEventListener('message',event=>{
        const msg=event.data;
        if(event.source!==window || !['UNISPORT_PARTICIPANTS_CONTEXT','UNISPORT_PARTICIPANTS_READ'].includes(msg?.type))return;
        const read=msg.type==='UNISPORT_PARTICIPANTS_READ';if(read)++window.participantReads;
        const reply={type:'UNISPORT_REPLY',requestId:msg.requestId,success:!window.participantFailure,
          code:window.participantFailure,data:{context:webContext,...(read?{html:participantHtml}:{})}};
        if(read && window.holdParticipantReply)window.deferredParticipantReply=reply;
        else postMessage(reply,location.origin);
      });
    }''',HTML)


def mount_dialog(page):
    page.evaluate('''async url=>{
      const {UnisportParticipants}=await import('/src/components/UnisportParticipants.tsx');
      window.participantComponent=UnisportParticipants;
      window.participantProps={offerUrl:url,scope:'a'.repeat(64),affiliation:'student'};
      mountAudit(UnisportParticipants,participantProps);
    }''',OFFICIAL)


def test_website_course_mapping_rejects_other_origins_and_never_guesses_native_id(workflow_page):
    cases = [OFFICIAL, OFFICIAL+'?source=app#details', OFFICIAL.replace('/angebot/','/program/').replace('_ger','_eng'),
        OFFICIAL.replace('/angebot/','/offre/').replace('_ger','_fra')]
    invalid = [None, '', '/usp/zms/angebot/3003/index_ger.html', OFFICIAL.replace('https:','http:'),
        OFFICIAL.replace('www.zssw.unibe.ch','www.zssw.unibe.ch.evil.test'),
        OFFICIAL.replace('www.zssw.unibe.ch','user:secret@www.zssw.unibe.ch'),
        OFFICIAL.replace('www.zssw.unibe.ch','www.zssw.unibe.ch:444'),
        OFFICIAL.replace('/3003/','/%33%30%30%33/'), OFFICIAL.replace('/3003/','/0/'),
        'https://www.zssw.unibe.ch/usp/zms/angebot/3003/index_ger.html\n',
        r'https://evil.test\www.zssw.unibe.ch/usp/zms/angebot/3003/index_ger.html',
        'https://www.sport.unibe.ch/offer/28028', 'https://api.uniapp-backend.unibe.ch/api/v3/sports/offers/getOffer/28028']
    result = workflow_page.evaluate('''async inputs=>{
      const {unisportParticipantsUrl}=await import('/src/lib/unisportOffers.ts');
      return inputs.map(input=>unisportParticipantsUrl(input));
    }''', cases+invalid)
    assert result == [PARTICIPANTS]*len(cases) + [None]*len(invalid)


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_cached_scraped_dialog_live_filter_resizing_and_registrations(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme);calls=[]
    fetched_at=time.time()-20
    companion(page)
    unwanted=[];page.route('https://untrusted.invalid/**',lambda route:(unwanted.append(route.request.url),route.fulfill(status=204)))
    items=[{**offer(28028),'title':'Synthetic Archery','url':OFFICIAL},
        {**offer(28029),'title':'Cancelled synthetic offer','url':OFFICIAL.replace('/3003/','/3004/')},
        {**offer(28030),'title':'Synthetic offer without website mapping','url':'https://www.sport.unibe.ch/offer'}]
    def handle(route):
        request=route.request;path=urlsplit(request.url).path;calls.append(path)
        assert request.method=='GET'
        if path.endswith('/connection'):data={'phase':'connected','affiliation':'student','scope':'a'*64}
        elif path.endswith('/affiliations'):data={'affiliations':['student']}
        elif path.endswith('/catalogue'):data={'items':items,'sports':['Ball sports','Yoga'],'fetched_at':time.time(),'stale':False}
        elif path.endswith('/applications'):data={'items':[{'id':item['id'],'title':item['title'],'begin':item['begin'],'status':4 if item['id']==28029 else 8} for item in items],'fetched_at':fetched_at}
        else:raise AssertionError('No per-registration offer fetch is needed: '+path)
        route.fulfill(content_type='application/json',body=json.dumps(data))
    page.route('**/api/unisport/**',handle)
    page.evaluate('''async()=>{const {UnisportView}=await import('/src/components/UnisportView.tsx');mountAudit(UnisportView,{})}''')
    page.get_by_role('button',name=tr['unisport.load_applications'],exact=True).click()
    action=page.get_by_role('button',name=tr['unisport.participants'],exact=True)
    action.wait_for();assert action.count()==1
    page.get_by_role('button',name=tr['unisport.load_applications'],exact=True).click()
    assert calls.count('/api/unisport/applications')==1
    stamps=page.evaluate("Object.keys(sessionStorage).filter(key=>key.includes('applications')).map(key=>JSON.parse(sessionStorage.getItem(key)).fetched_at)")
    assert stamps==[fetched_at]
    page.get_by_role('button',name=tr['unisport.refresh_applications'],exact=True).click()
    page.wait_for_timeout(60);assert calls.count('/api/unisport/applications')==2
    action.click();modal=page.locator('dialog[open]').first
    modal.get_by_text('Example',exact=True).wait_for()
    search=page.get_by_label(tr['unisport.participants_search'],exact=True)
    search.fill('ada')
    assert modal.locator('tbody tr').count()==1 and page.evaluate('participantReads')==1
    search.fill('muller');assert modal.locator('tbody tr').count()==1
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert search.input_value()=='muller'
    page.set_viewport_size({'width':width,'height':height})
    search.fill('no match');page.get_by_text(tr['unisport.participants_no_matches'],exact=True).wait_for()
    search.fill('');assert modal.locator('tbody tr').count()==3
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
    assert page.evaluate('window.participantsExecuted') is None and unwanted==[]
    folder=ROOT/'scratch/unisport-participant-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'list-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    page.screenshot(path=str(folder/f'dialog-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    modal.get_by_role('button',name=tr['Schliessen'],exact=True).click()
    assert action.evaluate('(node)=>document.activeElement===node')
    action.click();modal.get_by_text('Example',exact=True).wait_for()
    assert page.evaluate('participantReads')==1
    modal.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.wait_for_function('participantReads===2');modal.get_by_text('Example',exact=True).wait_for()
    before=list(calls);navigation=[]
    def official(route):
        navigation.append(route.request)
        route.fulfill(content_type='text/html',body='<h1>Synthetic participant list</h1><p>Example Student</p>')
    page.context.route(PARTICIPANTS,official)
    link=modal.get_by_role('link',name=tr['unisport.participants_official'],exact=False)
    assert link.get_attribute('href')==PARTICIPANTS
    link.focus()
    with page.expect_popup() as popup:
        page.keyboard.press('Enter')
    other=popup.value
    other.get_by_role('heading',name='Synthetic participant list').wait_for()
    assert other.url==PARTICIPANTS and calls==before and calls.count('/api/unisport/catalogue')==1
    assert len(navigation)==1
    assert not {'authorization','x-unisport-session','x-session-id','x-unisport-scope'} & navigation[0].headers.keys()
    other.close()


@pytest.mark.parametrize('kind', ['apply','cancel'])
def test_booking_link_appears_for_verified_signup_and_disappears_after_cancellation(workflow_page,kind):
    page=workflow_page;tr=language(page,'en','light')
    record=dict(intent='i'*43,phase='ready',kind=kind,offer={**offer(28028),'url':OFFICIAL},begin=offer()['begin'],
        fields=[],confirmation='',provider_status='',expires_at=time.time()+600)
    calls=[]
    def handle(route):
        calls.append(route.request.url)
        if not urlsplit(route.request.url).path.endswith('/booking'):
            record.update(phase='confirmed',provider_status='Registered' if kind=='apply' else 'Open')
        route.fulfill(content_type='application/json',body=json.dumps(record))
    page.route('**/api/unisport/**',handle)
    page.evaluate('''async()=>{
      const {UnisportBooking}=await import('/src/components/UnisportBooking.tsx');
      mountAudit(UnisportBooking,{credential:'x'.repeat(43),scope:'a'.repeat(64),affiliation:'student',offerId:28028,
        begin:'2026-12-01T18:00:00+01:00'});
    }''')
    page.get_by_role('button',name=tr['unisport.manage_registration'],exact=True).click()
    modal=page.locator('dialog[open]').first
    link=modal.get_by_role('button',name=tr['unisport.participants'],exact=True)
    modal.get_by_role('heading',name=tr['unisport.confirm_action'],exact=True).wait_for()
    assert link.count()==(0 if kind=='apply' else 1)
    if kind=='apply':page.get_by_label(tr['unisport.accept_terms'],exact=True).check()
    modal.get_by_role('button',name=tr['unisport.register_now' if kind=='apply' else 'unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text(tr['unisport.registration_confirmed' if kind=='apply' else 'unisport.cancellation_confirmed'],exact=True).wait_for()
    assert link.count()==(1 if kind=='apply' else 0)
    assert len(calls)==2


def test_cookie_changes_and_native_disconnect_hide_cached_participants(workflow_page):
    page=workflow_page;tr=language(page,'en','light');companion(page);mount_dialog(page)
    page.get_by_role('button',name=tr['unisport.participants'],exact=True).click()
    page.get_by_text('Example',exact=True).wait_for()
    page.evaluate("webContext='c'.repeat(64);postMessage({type:'UNISPORT_PARTICIPANTS_COOKIES_CHANGED'},location.origin)")
    page.get_by_text(tr['unisport.participants_session_changed'],exact=True).wait_for()
    assert page.get_by_text('Example',exact=True).count()==0
    page.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.get_by_text('Example',exact=True).wait_for()
    assert page.evaluate('participantReads')==2
    page.evaluate("import('/src/lib/unisportCache.ts').then(module=>module.clearPrivate())")
    page.get_by_text(tr['unisport.participants_session_changed'],exact=True).wait_for()
    assert page.get_by_text('Example',exact=True).count()==0


def test_login_failure_has_an_official_fallback_and_never_reuses_cached_names(workflow_page):
    page=workflow_page;tr=language(page,'en','light');companion(page);mount_dialog(page)
    page.evaluate("participantFailure='participants_login_required'")
    page.get_by_role('button',name=tr['unisport.participants'],exact=True).click()
    page.get_by_text(tr['unisport.participants_login_required'],exact=True).wait_for()
    assert page.get_by_role('link',name=tr['unisport.participants_official'],exact=False).get_attribute('href')==PARTICIPANTS
    assert page.locator('tbody tr').count()==0
    page.evaluate("participantFailure='';participantHtml='<form>Sign in</form>'")
    page.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.get_by_text(tr['unisport.participants_login_required'],exact=True).wait_for()
    assert page.locator('tbody tr').count()==0


def test_pending_result_after_disconnect_cannot_repopulate_private_cache(workflow_page):
    page=workflow_page;tr=language(page,'en','light');companion(page);mount_dialog(page)
    page.evaluate('holdParticipantReply=true')
    page.get_by_role('button',name=tr['unisport.participants'],exact=True).click()
    page.wait_for_function('Boolean(window.deferredParticipantReply)')
    page.evaluate("import('/src/lib/unisportCache.ts').then(module=>{module.clearPrivate();postMessage(deferredParticipantReply,location.origin)})")
    page.get_by_text(tr['unisport.participants_session_changed'],exact=True).wait_for()
    page.wait_for_timeout(50)
    assert page.locator('tbody tr').count()==0
    assert page.evaluate("Object.keys(sessionStorage).filter(key=>key.includes('participants:')).length")==0


def test_valid_empty_list_and_malformed_rows_are_distinct(workflow_page):
    page=workflow_page;tr=language(page,'en','light');companion(page);mount_dialog(page)
    page.evaluate("participantHtml='<table><tr><th>Nachname</th><th>Vorname</th><th>Angebot</th></tr></table>'")
    page.get_by_role('button',name=tr['unisport.participants'],exact=True).click()
    page.get_by_text(tr['unisport.participants_empty'],exact=True).wait_for()
    page.evaluate("participantHtml='<table><tr><th>Nachname</th><th>Vorname</th><th>Angebot</th></tr><tr><td>Partial</td></tr></table>'")
    page.get_by_role('button',name=tr['unisport.refresh'],exact=True).click()
    page.get_by_text(tr['unisport.participants_read_failed'],exact=True).wait_for()
    assert page.get_by_text('Partial',exact=True).count()==0


def test_website_identity_login_resumes_list_and_ignores_other_accounts(workflow_page):
    page=workflow_page;tr=language(page,'de','dark');page.set_viewport_size({'width':320,'height':740})
    companion(page);mount_dialog(page)
    page.evaluate("""()=>{
      window.participantFailure='participants_login_required';window.loginStarts=[];
      addEventListener('message',e=>{if(e.data?.type==='UNISPORT_PARTICIPANTS_LOGIN'){
        loginStarts.push(e.data);postMessage({type:'UNISPORT_REPLY',requestId:e.data.requestId,success:true},location.origin)
      }});
    }""")
    page.get_by_role('button',name=tr['unisport.participants'],exact=True).click()
    page.get_by_role('button',name=tr['unisport.website_login'],exact=True).click()
    page.get_by_text(tr['unisport.website_login_waiting'],exact=True).wait_for()
    page.wait_for_function('loginStarts.length===1')
    assert page.evaluate('loginStarts[0].course')=='3003'
    page.evaluate("postMessage({type:'UNISPORT_PARTICIPANTS_LOGIN_FINISHED',scope:'z'.repeat(64),affiliation:'student',success:true},location.origin)")
    page.wait_for_timeout(50)
    assert page.get_by_text(tr['unisport.website_login_waiting'],exact=True).count()==1
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    folder=ROOT/'scratch/unisport-participant-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/'website-login-320-de-dark.png'),full_page=True)
    page.evaluate("participantFailure='';postMessage({type:'UNISPORT_PARTICIPANTS_LOGIN_FINISHED',scope:'a'.repeat(64),affiliation:'student',success:true},location.origin)")
    page.get_by_text('Example',exact=True).wait_for()
    assert page.locator('tbody tr').count()==3
