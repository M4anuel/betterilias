"""Named account search: built admin app, mocked API, Chromium emulation."""
import json
import os
import time
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import ROOT, local_site

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,900),(768,900),(1280,900),(667,375)])
@pytest.mark.parametrize('language,scheme', [('en','light'),('de','dark')])
def test_private_names_search_resize_and_expiry(local_site,width,height,language,scheme):
    pw=pytest.importorskip('playwright.sync_api')
    tr=json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    queries=[];state={'expired':False};now=time.time()
    def respond(route):
        req=route.request;path=urlparse(req.url).path
        data={};status=200
        if path.endswith('/session'):data={'authenticated':True,'expires_at':now+1800}
        elif path.endswith('/summary'):
            data={'event_catalogue':{},'diagnostics':None,'outbound':{},'accounts':{'active':2,'last_24_hours':4,'retained':7,'retention_days':30,'as_of':now}}
        elif path.endswith('/accounts/query'):
            assert req.method=='POST' and not urlparse(req.url).query
            assert req.headers['x-admin-request']=='1'
            body=req.post_data_json;queries.append(body)
            if state['expired']:status=404
            else:
                name='Müller Beispiel' if body['query'] else 'Synthetic Student With A Long Display Name'
                data={'accounts':[{'id':'a'*64,'name':name,'last_seen':now}], 'total':1,'offset':0,'limit':50,'retention_days':30}
        elif path.endswith('/events'):data={'events':[],'next_before':None}
        elif path.endswith('/reports'):data={'reports':[],'counts':[],'next_before':None}
        elif path.endswith('/feature-requests'):data={'items':[],'has_more':False}
        else:pytest.fail(path)
        route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport={'width':width,'height':height},color_scheme=scheme,is_mobile=width<768,has_touch=width<768)
        page.add_init_script('localStorage.setItem("betterilias_language",%s)'%json.dumps(language))
        page.route('**/api/**',respond);page.goto(local_site+'/admin/')
        section=page.locator('.account-usage')
        pw.expect(section.get_by_role('heading',name=tr('admin.accounts_title'))).to_be_visible()
        assert not queries
        section.get_by_role('button',name=tr('admin.accounts_show_names')).click()
        pw.expect(section.get_by_text('Synthetic Student With A Long Display Name',exact=True)).to_be_visible()
        field=section.get_by_label(tr('admin.accounts_search'),exact=True)
        field.fill('Müller')
        pw.expect(section.get_by_text('Müller Beispiel',exact=True)).to_be_visible()
        page.set_viewport_size({'width':height,'height':width})
        pw.expect(field).to_have_value('Müller')
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        section.scroll_into_view_if_needed()
        folder=ROOT/'scratch'/'account-usage-review';folder.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(folder/f'{width}-{height}-{language}-{scheme}.png'),full_page=True)
        section.get_by_role('button',name=tr('admin.accounts_hide_names')).click()
        pw.expect(page.get_by_text('Müller Beispiel',exact=True)).to_have_count(0)
        assert not page.evaluate('Object.values(localStorage).some(value=>value.includes("Müller"))')
        section.get_by_role('button',name=tr('admin.accounts_show_names')).click()
        pw.expect(section.get_by_text('Müller Beispiel',exact=True)).to_be_visible()
        state['expired']=True
        section.get_by_role('button',name=tr('admin.refresh'),exact=True).click()
        pw.expect(page.get_by_label(tr('admin.key'),exact=True)).to_be_visible()
        pw.expect(page.get_by_text('Müller Beispiel',exact=True)).to_have_count(0)
        browser.close()
