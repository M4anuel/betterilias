"""Deferred-response component and transport regressions against actual frontend modules."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from urllib.request import urlopen

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser regressions')


@pytest.fixture(scope='module')
def workflow_site(tmp_path_factory):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    log_path = tmp_path_factory.mktemp('state-vite') / 'vite.log'
    with log_path.open('w', encoding='utf8') as log:
        process = subprocess.Popen([shutil.which('node'), str(ROOT / 'frontend/node_modules/vite/bin/vite.js'),
            '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT / 'frontend', stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        url = f'http://127.0.0.1:{port}'
        try:
            for _ in range(200):
                if process.poll() is not None: pytest.fail(log_path.read_text(encoding='utf8'))
                try:
                    with urlopen(url, timeout=.2): break
                except OSError: time.sleep(.1)
            else: pytest.fail('Vite did not become ready')
            yield url
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()


@pytest.fixture(scope='module')
def workflow_browser():
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL', 'chrome'))
        yield browser
        browser.close()


@pytest.fixture
def workflow_page(workflow_site, workflow_browser):
    page = workflow_browser.new_page(viewport={'width': 1280, 'height': 900})
    page.set_default_timeout(6000)
    page.route('**/audit-harness', lambda route: route.fulfill(content_type='text/html', body='''<!doctype html>
      <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head>
      <body><div id="audit-root" style="height:100dvh;overflow:auto;padding:16px"></div></body></html>'''))
    page.route('**/api/**', lambda route: route.fulfill(content_type='application/json', body='{}'))
    page.goto(workflow_site + '/audit-harness')
    page.evaluate('''async()=>{
      const refresh=(await import('/@react-refresh')).default;refresh.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      window.R=(await import('/node_modules/.vite/deps/react.js')).default;
      window.RD=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {ConfirmModal}=await import('/src/components/ConfirmModal.tsx');
      window.auditRoot=RD.createRoot(document.getElementById('audit-root'));
      window.mountAudit=(Component,props)=>auditRoot.render(R.createElement(R.Fragment,null,
        R.createElement(Component,props),R.createElement(ConfirmModal)));
    }''')
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    yield page
    assert not errors
    page.close()


def language(page, code, scheme):
    page.emulate_media(color_scheme=scheme)
    page.evaluate('''async({code,scheme})=>{
      (await import('/src/lib/i18n.ts')).setLanguage(code);
      document.documentElement.classList.toggle('dark',scheme==='dark');
    }''', {'code': code, 'scheme': scheme})
    return json.loads((ROOT / 'locales' / f'{code}.json').read_text(encoding='utf8'))


def screenshot(page, name):
    directory = ROOT / 'scratch/state-machine-checks'; directory.mkdir(parents=True, exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(directory / f'{name}.png'))


@pytest.mark.parametrize('width,height', [(320, 740), (390, 800), (430, 800), (768, 850), (1280, 900), (844, 390)])
@pytest.mark.parametrize('code,scheme', [('en', 'light'), ('de', 'dark'), ('en', 'dark'), ('de', 'light')])
def test_grade_saved_snapshot_preserves_later_edits(workflow_page, width, height, code, scheme):
    page = workflow_page; page.set_viewport_size({'width': width, 'height': height}); tr = language(page, code, scheme)
    page.evaluate('''async()=>{
      const {SubmissionDetailModal}=await import('/src/components/SubmissionDetailModal.tsx');
      window.sent=[];window.closedAudit=false;
      mountAudit(SubmissionDetailModal,{
        submission:{member_id:'1',student_name:'Test Student',submission_status:'submitted',files:[]},
        onSave:async(id,data)=>{sent.push(data);await new Promise(resolve=>window.finishSave=resolve);},
        onClose:()=>window.closedAudit=true});
    }''')
    mark = page.get_by_placeholder(tr['Note oder Punktzahl (z.B. 5.5 oder 18/20)'], exact=True)
    mark.fill('4'); page.locator('.submission-detail-save').first.click(); mark.fill('6')
    page.evaluate('finishSave()'); page.wait_for_function("document.querySelector('.submission-detail-save').disabled===false")
    assert page.evaluate('sent[0].mark') == '4'
    assert mark.input_value() == '6'
    assert page.evaluate("import('/src/lib/navigationGuard.ts').then(m=>m.navigationGuard.hasUnsavedChanges())")
    page.get_by_role('button', name=tr['Schliessen'], exact=True).first.click()
    page.locator('dialog.confirmation-dialog').wait_for()
    page.keyboard.press('Escape')
    page.locator('dialog.confirmation-dialog').wait_for(state='hidden')
    assert not page.evaluate('closedAudit')
    screenshot(page, f'grade-{width}-{height}-{code}-{scheme}')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 800), (430, 800), (768, 850), (1280, 900), (844, 390)])
@pytest.mark.parametrize('code,scheme', [('en', 'light'), ('de', 'dark')])
def test_assignment_swr_keeps_dirty_draft(workflow_page, width, height, code, scheme):
    page = workflow_page; page.set_viewport_size({'width': width, 'height': height}); language(page, code, scheme)
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {api}=await import('/src/lib/api.ts');
      window.existing={ass_id:'1',exercise_ref_id:'200',title:'Cached title',type_id:1,type_name:'Upload',mandatory:true,
        instruction_html:'<p>Original</p>',deadline_mode:0,deadline:'2030-12-31T23:59',instruction_files:[],available_types:{'1':'Upload'}};
      cache.setCachedTAAssignmentDetail('200','1',existing);
      api.getTAAssignmentDetail=async()=>await new Promise(resolve=>window.deliverDetail=()=>resolve({...existing,title:'Server title'}));
      const {TAExerciseEditorView}=await import('/src/components/TAExerciseEditorView.tsx');
      mountAudit(TAExerciseEditorView,{exerciseRefId:'200',assId:'1',onBack:()=>{},onSaved:()=>{}});
    }''')
    title = page.locator('#assignment-title'); title.wait_for(); title.fill('Unsaved title')
    page.evaluate('deliverDetail()'); page.wait_for_timeout(100)
    assert title.input_value() == 'Unsaved title'
    assert page.evaluate("import('/src/lib/navigationGuard.ts').then(m=>m.navigationGuard.hasUnsavedChanges())")
    screenshot(page, f'assignment-{width}-{height}-{code}-{scheme}')


def test_confirmation_queue_resolves_every_request_and_unmount(workflow_page):
    page = workflow_page; language(page, 'en', 'light')
    page.evaluate('''async()=>{mountAudit(()=>null,{});}'''); page.wait_for_timeout(50)
    page.evaluate('''async()=>{
      window.decisions=[];const {confirmDialog}=await import('/src/lib/dialog.ts');
      confirmDialog({message:'First'}).then(v=>decisions.push(['first',v]));
      confirmDialog({message:'Second'}).then(v=>decisions.push(['second',v]));
    }''')
    page.get_by_text('First', exact=True).wait_for(); page.get_by_role('button', name='Cancel', exact=True).click()
    page.get_by_text('Second', exact=True).wait_for(); page.get_by_role('button', name='Confirm', exact=True).click()
    assert page.evaluate('decisions') == [['first', False], ['second', True]]
    page.evaluate('''async()=>{
      const {confirmDialog}=await import('/src/lib/dialog.ts');
      confirmDialog({message:'Third'}).then(v=>decisions.push(['third',v]));
      confirmDialog({message:'Fourth'}).then(v=>decisions.push(['fourth',v]));
    }''')
    page.get_by_text('Third', exact=True).wait_for(); page.evaluate('auditRoot.unmount()')
    assert page.evaluate('decisions')[-2:] == [['third', False], ['fourth', False]]


def test_management_flights_and_auth_events_are_credential_scoped(workflow_page):
    result = workflow_page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {api}=await import('/src/lib/api.ts');
      const native=window.fetch;const calls=[],deliveries=[],events=[];
      window.addEventListener('ilias-session',e=>events.push(e.detail));
      window.fetch=async(input,init)=>{
        calls.push(new Headers(init.headers).get('X-Session-Id'));
        return await new Promise(resolve=>deliveries.push(status=>resolve(new Response(JSON.stringify({tenant:calls.length}),{status}))));
      };
      cache.setSessionId('alice');const a=api.getManagement('42').catch(e=>e.name);
      cache.setSessionId('bob');const b=api.getManagement('42');
      deliveries[0](401);deliveries[1](200);
      const old=await a;await b;window.fetch=native;
      return {calls,old,events};
    }''')
    assert result == {'calls': ['alice', 'bob'], 'old': 'AbortError', 'events': [True]}


def test_body_and_logout_generations_reject_stale_data(workflow_page):
    result = workflow_page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {sessionFetch}=await import('/src/lib/api.ts');
      const native=window.fetch;let body;
      cache.setSessionId('owner');
      window.fetch=async()=>new Response(new ReadableStream({start(controller){body=controller;}}),{status:200});
      const response=await sessionFetch('/api/held-body');const reading=response.json().catch(e=>e.name);
      cache.invalidateSessionRequests();
      body.enqueue(new TextEncoder().encode('{"private":"old"}'));body.close();
      const outcome=await reading;window.fetch=native;return {outcome,credential:cache.getSessionId()};
    }''')
    assert result == {'outcome': 'AbortError', 'credential': 'owner'}


def test_old_success_cannot_override_newer_expiry_for_same_credential(workflow_page):
    result = workflow_page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {sessionFetch}=await import('/src/lib/api.ts');
      cache.setSessionId('owner');const deliveries=[],events=[];
      window.addEventListener('ilias-session',e=>events.push(e.detail));
      window.fetch=async()=>await new Promise(resolve=>deliveries.push(status=>resolve(new Response('{}',{status}))));
      const older=sessionFetch('/api/older');const newer=sessionFetch('/api/newer').catch(()=>{});
      deliveries[1](401);await newer;deliveries[0](200);await older;
      return events;
    }''')
    assert result == [False]


def test_logout_cancels_pending_reads_and_publishes_inactive(workflow_page):
    result = workflow_page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {api,sessionFetch}=await import('/src/lib/api.ts');
      cache.setSessionId('owner');const deliveries=[],events=[];
      window.addEventListener('ilias-session',e=>events.push(e.detail));
      window.fetch=async()=>await new Promise(resolve=>deliveries.push(()=>resolve(new Response('{}'))));
      const old=sessionFetch('/api/old').catch(e=>e.name);const logout=api.logout();
      const during=sessionFetch('/api/during').catch(e=>e.name);
      deliveries[1]();await logout;deliveries[0]();deliveries[2]();
      return {old:await old,during:await during,events,key:cache.getSessionId()};
    }''')
    assert result == {'old': 'AbortError', 'during': 'AbortError', 'events': [False], 'key': 'owner'}


def test_completed_download_does_not_mask_active_duplicate(workflow_page):
    result = workflow_page.evaluate('''async()=>{
      const {downloadManager}=await import('/src/lib/downloadManager.ts');let calls=0;
      window.fetch=async()=>{calls++;return calls===1?new Response('file'):await new Promise(()=>{});};
      await downloadManager.startDownload('/api/download');void downloadManager.startDownload('/api/download');
      void downloadManager.startDownload('/api/download');
      return {calls,active:downloadManager.getAll().filter(i=>i.state==='preparing').length,selected:downloadManager.get('/api/download').state};
    }''')
    assert result == {'calls': 2, 'active': 1, 'selected': 'preparing'}


def test_appended_notification_receives_full_lifetime(workflow_page):
    page = workflow_page
    page.evaluate('''async()=>{
      const {NotificationToast}=await import('/src/components/NotificationToast.tsx');window.dismissed=0;
      window.notices=[];window.showNotice=id=>{notices.push({id,title:id,type:'general'});
        mountAudit(NotificationToast,{notifications:[...notices],autoDismissMs:800,onDismiss:()=>dismissed++});};
      showNotice('First');
    }''')
    page.wait_for_timeout(600); page.evaluate("showNotice('Second')"); page.wait_for_timeout(350)
    assert page.evaluate('dismissed') == 0
    page.wait_for_function('dismissed===1')


def test_joined_calendar_job_keeps_polling_until_terminal(workflow_page):
    page = workflow_page
    page.evaluate('''async()=>{
      const {api}=await import('/src/lib/api.ts');window.reads=0;window.syncs=0;window.complete=false;
      const cal={semester:'HS2026',semester_start_date:'2026-09-14',semester_end_date:'2026-12-31',semester_mid_date:'2026-11-01',courses:[],rules:[],events:[]};
      const progress=()=>({is_syncing:!complete,current:1,total:2,current_course_title:'In progress'});
      api.getCalendar=async()=>{reads++;return reads===1?cal:{...cal,sync_progress:progress()};};
      api.discoverCalendarCourses=async()=>cal;
      api.getMyCourses=async()=>({courses:[{ref_id:'42',title:'Course',semester:'HS2026',item_type:'crs'}]});
      api.syncCalendar=async()=>{syncs++;return {...cal,sync_progress:progress()};};
      const {CalendarView}=await import('/src/components/CalendarView.tsx');
      mountAudit(CalendarView,{selectedSemester:'HS2026',coursesList:[],onSelectCourse:()=>{}});
    }''')
    page.wait_for_function('syncs===1'); page.wait_for_function('reads>=3')
    page.evaluate('complete=true'); page.wait_for_timeout(1700)
    terminal_reads = page.evaluate('reads'); page.wait_for_timeout(1700)
    assert page.evaluate('reads') == terminal_reads


@pytest.mark.parametrize('code,scheme', [('en', 'light'), ('de', 'dark')])
def test_uncertain_creation_rechecks_original_payload_and_preserves_new_edits(workflow_page, code, scheme):
    page = workflow_page; page.set_viewport_size({'width': 390, 'height': 800}); tr = language(page, code, scheme)
    page.evaluate('''async()=>{
      const {api}=await import('/src/lib/api.ts');window.calls=[];window.saved=[];
      api.getTAAssignments=async()=>({assignments:[],available_types:{'1':'Upload'}});
      api.saveTAAssignment=async(id,payload)=>{
        calls.push(payload);
        if(calls.length===1)throw Object.assign(Error('Response lost'),{status:409});
        return {...payload,ass_id:'99',instruction_files:[]};
      };
      const {TAExerciseEditorView}=await import('/src/components/TAExerciseEditorView.tsx');
      mountAudit(TAExerciseEditorView,{exerciseRefId:'200',assId:null,onBack:()=>{},onSaved:id=>saved.push(id)});
    }''')
    page.locator('#assignment-title').fill('Original draft'); page.locator('#assignment-deadline').fill('2030-12-31T23:59')
    page.get_by_role('button', name=tr['Übung erstellen'], exact=True).first.click(); page.get_by_text('Response lost').wait_for()
    page.locator('#assignment-title').fill('Later unsaved draft')
    page.get_by_role('button', name=tr['editor.check_creation'], exact=True).first.click()
    page.wait_for_function('calls.length===2')
    assert page.evaluate('calls[0].operation_id===calls[1].operation_id')
    assert page.evaluate('calls[1].title') == 'Original draft'
    assert page.locator('#assignment-title').input_value() == 'Later unsaved draft'
    assert page.evaluate('saved.length') == 0
    screenshot(page, f'creation-check-{code}-{scheme}')
    page.get_by_role('button', name=tr['Änderungen speichern'], exact=True).first.click()
    page.wait_for_function('saved.length===1')
    assert page.evaluate('calls[2].ass_id') == '99'
    assert page.evaluate('calls[2].title') == 'Later unsaved draft'


@pytest.mark.parametrize('width', [320, 390, 430, 768, 1280])
@pytest.mark.parametrize('code,scheme', [('en', 'light'), ('de', 'dark')])
def test_partial_feedback_import_can_be_rechecked_without_reselecting_archive(workflow_page, width, code, scheme):
    page = workflow_page; page.set_viewport_size({'width': width, 'height': 800})
    tr = language(page, code, scheme)
    page.evaluate('''async()=>{
      const {api}=await import('/src/lib/api.ts');window.feedbackCalls=[];
      api.previewFeedbackImport=async()=>({staged_import_id:'stage',snapshot_token:'snapshot',
        units:[{unit_id:'user:1',member_id:'1',recipient_name:'Test Student',files:[{
          source_path:'feedback.pdf',filename:'feedback.pdf',size_bytes:10,is_conflict:false,action:'upload'}]}],
        unmatched_files:[],skipped_files:[],blockers:[],total_files:1,total_size_bytes:10,total_units:1,has_conflicts:false});
      api.commitFeedbackImport=async(exercise,ass,request)=>{
        feedbackCalls.push(request);const failed=feedbackCalls.length===1;
        return {success:!failed,total_processed:1,uploaded_count:failed?0:1,skipped_count:0,
          failed_count:failed?1:0,results:[],message:''};
      };
      const {ReturnFeedbackModal}=await import('/src/components/ReturnFeedbackModal.tsx');
      mountAudit(ReturnFeedbackModal,{exerciseRefId:'200',assId:'20',assignmentTitle:'Assignment',
        isOpen:true,onClose:()=>{},onSuccess:()=>{}});
    }''')
    page.locator('input[type=file]').set_input_files({'name': 'feedback.zip', 'mimeType': 'application/zip', 'buffer': b'archive'})
    publish = page.get_by_role('button', name=tr['Feedback auf ILIAS veröffentlichen'], exact=True)
    publish.click()
    page.get_by_role('heading', name=tr['Feedback-Import fehlgeschlagen'], exact=True).wait_for()
    screenshot(page, f'feedback-retry-{width}-{code}-{scheme}')
    page.get_by_role('button', name=tr['feedback.retry_failed'], exact=True).click()
    publish.click()
    page.get_by_role('heading', name=tr['Feedback-Dateien erfolgreich zurückgegeben!'], exact=True).wait_for()
    assert page.evaluate('feedbackCalls.length===2 && JSON.stringify(feedbackCalls[0])===JSON.stringify(feedbackCalls[1])')
