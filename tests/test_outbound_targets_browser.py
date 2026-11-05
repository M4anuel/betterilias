"""Blocked resource links give usable feedback without disconnecting the user."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,900),(768,900),(1280,900),(667,375)])
@pytest.mark.parametrize('language,scheme', [('de','dark'),('en','light')])
def test_blocked_download_message_and_successful_retry(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    blocked, requests = [True], []
    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/submissions'):
            route.fulfill(content_type='application/json', body=json.dumps(dict(
                exercise=dict(ref_id='200',title='Exercises',total_participants=1,submitted_count=1,graded_count=0),
                available_assignments=[dict(ass_id='20',title='Assignment one',url='#')],active_assignment_id='20',listing_complete=True,
                submissions=[dict(member_id='101',student_name='Student',submission_status='submitted',passed_status='not_graded',
                    files=[],download_url='https://ilias.unibe.ch/ilias.php?cmd=downloadReturned&member_id=101')])) )
        elif path.endswith('/download'):
            requests.append(route.request)
            assert route.request.headers.get('x-session-id') == 'alice'
            assert 'session_id=' not in route.request.url
            if blocked[0]:
                route.fulfill(status=400,content_type='application/json',body=json.dumps(
                    dict(detail=tr('outbound.target_blocked'),code='OUTBOUND_TARGET_BLOCKED')))
            else:
                route.fulfill(content_type='application/pdf',headers={'Content-Disposition':'attachment; filename="safe.pdf"'},body=b'%PDF-1.4\n%%EOF')
        else:
            mock_api(route)
    artifacts=ROOT/'scratch'/'egress-review'
    artifacts.mkdir(parents=True,exist_ok=True)
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=width,height=height),color_scheme=scheme,is_mobile=width<768,has_touch=width<768,accept_downloads=True)
        page.add_init_script(f"""localStorage.setItem('betterilias_language','{language}');
            localStorage.setItem('betterilias_session_id','alice');
            window.authEvents=[];window.addEventListener('ilias-session',e=>authEvents.push(e.detail));""")
        page.route('**/api/**',respond)
        page.goto(local_site+'/?course=42&exercise=200&tab=submissions')
        button=page.get_by_role('button',name=tr('Abgabe herunterladen'),exact=True)
        button.click()
        toast=page.locator('.download-progress-bar-container')
        pw.expect(toast.get_by_text(tr('outbound.target_blocked'),exact=True)).to_be_visible()
        assert toast.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        assert_no_overflow(page)
        assert False not in page.evaluate('authEvents')
        page.screenshot(path=str(artifacts/f'blocked-{width}-{language}.png'))
        toast.get_by_role('button',name=tr('Schliessen'),exact=True).click()
        pw.expect(toast).to_have_count(0)
        blocked[0]=False
        with page.expect_download() as result:
            button.focus()
            page.keyboard.press('Enter')
        assert result.value.suggested_filename=='safe.pdf'
        assert len(requests)==2 and all(request.method=='GET' for request in requests)
        assert page.evaluate("localStorage.getItem('betterilias_session_id')")=='alice'
        assert False not in page.evaluate('authEvents')
        browser.close()


@pytest.mark.parametrize('directory',['extensions/chrome','extensions/firefox'])
@pytest.mark.parametrize('language,scheme',[('de','dark'),('en','light')])
@pytest.mark.parametrize('gateway_status',[502,504])
def test_both_companions_keep_credentials_on_verification_network_failure(local_site,directory,language,scheme,gateway_status):
    pw=pytest.importorskip('playwright.sync_api')
    tr=json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    valid,requests=[False],[]
    def respond(route):
        requests.append(route.request.post_data_json)
        if valid[0]:
            route.fulfill(content_type='application/json',body=json.dumps(dict(success=True,authenticated=True,session_id='newly-verified',user_name='Alice')))
        else:
            route.fulfill(status=gateway_status,content_type='application/json',body=json.dumps(
                dict(detail=tr('Session verification unavailable. Check your connection and the backend, then retry.'))))
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=320 if language=='de' else 430,height=740),color_scheme=scheme)
        page.add_init_script("""
            window.extensionStore={sessionId:'working',autoSyncEnabled:false,language:%s};
            window.chrome={storage:{local:{get:async()=>({...extensionStore}),set:async value=>Object.assign(extensionStore,value)}},
              cookies:{getAll:async()=>[{name:'PHPSESSID',value:'unverified'},{name:'_shibsession_test',value:'not-proof'}]},
              action:{setBadgeText:async()=>{},setIcon:async()=>{}},tabs:{query:async()=>[]}};
        """ % json.dumps(language) + ("window.browser=window.chrome;" if directory.endswith('firefox') else ''))
        page.route('**/api/auth/sync',respond)
        page.goto(f'{local_site}/{directory}/popup.html')
        badge=page.locator('#ilias-status-badge')
        pw.expect(badge).to_have_text(tr('Nicht verifiziert'))
        pw.expect(page.locator('#login-btn')).to_be_hidden()
        assert page.evaluate('extensionStore.sessionId')=='working'
        page.locator('#sync-btn').click()
        pw.expect(page.locator('#feedback-box')).to_have_text(tr('Session verification unavailable. Check your connection and the backend, then retry.'))
        assert page.evaluate('extensionStore.sessionId')=='working'
        valid[0]=True
        page.locator('#sync-btn').click()
        pw.expect(badge).to_have_text(tr('Synchronisiert'))
        assert page.evaluate('extensionStore.sessionId')=='newly-verified'
        assert all(request['source']==('firefox_extension' if directory.endswith('firefox') else 'chrome_extension') for request in requests)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        browser.close()
