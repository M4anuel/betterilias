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
def test_personal_list_uses_cached_catalogue_and_opens_official_list(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme);calls=[]
    items=[{**offer(28028),'title':'Synthetic Archery','url':OFFICIAL},
        {**offer(28029),'title':'Cancelled synthetic offer','url':OFFICIAL.replace('/3003/','/3004/')},
        {**offer(28030),'title':'Synthetic offer without website mapping','url':'https://www.sport.unibe.ch/offer'}]
    def handle(route):
        request=route.request;path=urlsplit(request.url).path;calls.append(path)
        assert request.method=='GET'
        if path.endswith('/connection'):data={'phase':'connected','affiliation':'student','scope':'a'*64}
        elif path.endswith('/affiliations'):data={'affiliations':['student']}
        elif path.endswith('/catalogue'):data={'items':items,'sports':['Ball sports','Yoga'],'fetched_at':time.time(),'stale':False}
        elif path.endswith('/applications'):data=[{'id':item['id'],'title':item['title'],'begin':item['begin'],'status':4 if item['id']==28029 else 8} for item in items]
        else:raise AssertionError('No per-registration offer fetch is needed: '+path)
        route.fulfill(content_type='application/json',body=json.dumps(data))
    page.route('**/api/unisport/**',handle)
    page.evaluate('''async()=>{const {UnisportView}=await import('/src/components/UnisportView.tsx');mountAudit(UnisportView,{})}''')
    page.get_by_role('button',name=tr['unisport.load_applications'],exact=True).click()
    link=page.get_by_role('link',name=tr['unisport.participants'],exact=False)
    link.wait_for()
    assert link.count()==1 and link.get_attribute('href')==PARTICIPANTS
    assert link.get_attribute('target')=='_blank' and link.get_attribute('rel')=='noopener noreferrer'
    assert link.bounding_box()['height']>=44
    page.get_by_text(tr['unisport.participants_hint'],exact=True).wait_for()
    link.scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
    folder=ROOT/'scratch/unisport-participant-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'list-{width}-{height}-{code}-{scheme}.png'),full_page=True)
    before=list(calls);navigation=[]
    def official(route):
        navigation.append(route.request)
        route.fulfill(content_type='text/html',body='<h1>Synthetic participant list</h1><p>Example Student</p>')
    page.context.route(PARTICIPANTS,official)
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
    link=modal.get_by_role('link',name=tr['unisport.participants'],exact=False)
    modal.get_by_role('heading',name=tr['unisport.confirm_action'],exact=True).wait_for()
    assert link.count()==(0 if kind=='apply' else 1)
    if kind=='apply':page.get_by_label(tr['unisport.accept_terms'],exact=True).check()
    modal.get_by_role('button',name=tr['unisport.register_now' if kind=='apply' else 'unisport.confirm_cancellation'],exact=True).click()
    page.get_by_text(tr['unisport.registration_confirmed' if kind=='apply' else 'unisport.cancellation_confirmed'],exact=True).wait_for()
    assert link.count()==(1 if kind=='apply' else 0)
    if kind=='apply':assert link.get_attribute('href')==PARTICIPANTS
    assert len(calls)==2
