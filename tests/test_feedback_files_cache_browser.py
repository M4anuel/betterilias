"""Private feedback-file metadata caching and correction-view recovery."""
import os
import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language, screenshot

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser regressions')


def install_transport(page):
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {api}=await import('/src/lib/api.ts');
      window.fileCache=cache;window.fileApi=api;cache.setSessionId('alice');window.fileRequests=[];
      window.fetch=(url,init={})=>new Promise(resolve=>fileRequests.push({url,method:init.method||'GET',
        finish:(files,status=200)=>resolve(new Response(JSON.stringify(status===200?{member_id:'1',files}:{detail:'Feedback read failed'}),{status}))}));
      window.startRead=(ass='20',member='1')=>api.getFeedbackFiles('200',member,ass,'https://ilias.unibe.ch/feedback');
    }''')


def test_coalescing_empty_results_failures_and_scope(workflow_page):
    page=workflow_page;install_transport(page)
    page.evaluate('()=>{window.reads=[startRead(),startRead()];}')
    page.wait_for_function('fileRequests.length===1')
    page.evaluate("fileRequests[0].finish([])")
    assert page.evaluate('Promise.all(reads).then(r=>r.map(x=>x.files.length))') == [0,0]
    assert page.evaluate('startRead().then(x=>x.files.length)') == 0
    assert page.evaluate('fileRequests.length') == 1
    page.evaluate("()=>{window.other=startRead('21').catch(e=>e.message);}")
    page.wait_for_function('fileRequests.length===2');page.evaluate('fileRequests[1].finish([],409)')
    assert 'Feedback read failed' in page.evaluate('other')
    page.evaluate("()=>{window.retry=startRead('21');}")
    page.wait_for_function('fileRequests.length===3');page.evaluate("fileRequests[2].finish([{id:'new',title:'New.pdf'}])")
    assert page.evaluate('retry.then(r=>r.files[0].title)') == 'New.pdf'
    page.evaluate("()=>{window.old=startRead('22').catch(e=>e.name);fileCache.setSessionId('bob');}")
    # The loader may not start if account ownership was already invalidated.
    page.wait_for_timeout(100)
    if page.evaluate('fileRequests.length') == 4:
        page.evaluate("fileRequests[3].finish([{id:'old',title:'Private.pdf'}])")
    assert page.evaluate('old') == 'AbortError'
    page.evaluate('()=>{window.bob=startRead();}');page.wait_for_function('fileRequests.length>=4')
    page.evaluate('fileRequests[fileRequests.length-1].finish([])');assert page.evaluate('bob.then(x=>x.files.length)') == 0


@pytest.mark.parametrize('old_status',[200,409])
def test_mutation_wins_over_older_read_and_caches_deletion(workflow_page,old_status):
    page=workflow_page;install_transport(page)
    page.evaluate('()=>{window.old=startRead().catch(e=>e.name);}');page.wait_for_function('fileRequests.length===1')
    page.evaluate("()=>{window.upload=fileApi.uploadFeedbackFile('200','1',new File(['review'],'Review.pdf'),'20');}")
    page.wait_for_function('fileRequests.length===2')
    page.evaluate("fileRequests[1].finish([{id:'uploaded',title:'Review.pdf'}])")
    page.evaluate('upload')
    page.evaluate('(status)=>fileRequests[0].finish([],status)',old_status);assert page.evaluate('old') == 'AbortError'
    assert page.evaluate('startRead().then(r=>r.files[0].id)') == 'uploaded'
    assert page.evaluate('fileRequests.length') == 2
    page.evaluate("()=>{window.deletion=fileApi.deleteFeedbackFile('200','1','uploaded','20');}")
    page.wait_for_function('fileRequests.length===3');page.evaluate('fileRequests[2].finish([])');page.evaluate('deletion')
    assert page.evaluate('startRead().then(r=>r.files.length)') == 0
    assert page.evaluate('fileRequests.length') == 3


def test_saver_survives_reload_expires_and_clears_on_logout(workflow_page):
    page=workflow_page;install_transport(page)
    page.evaluate('()=>{fileCache.setIliasSaverEnabled(true);window.read=startRead();}')
    page.wait_for_function('fileRequests.length===1')
    page.evaluate("fileRequests[0].finish([{id:'saved',title:'Cached correction.pdf'}])");page.evaluate('read')
    assert page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('betterilias_feedback_files:')).length") == 1
    assert not page.evaluate("JSON.stringify(localStorage).includes('Cached correction.pdf')")
    page.reload()
    result=page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {feedbackFilesCache,feedbackFilesKey}=await import('/src/lib/feedbackFilesCache.ts');
      const resource=feedbackFilesKey('200','1','20');let calls=0;
      const result=await feedbackFilesCache.read(resource,async()=>{calls++;return {member_id:'1',files:[]};});
      for(const key of Object.keys(sessionStorage))if(key.startsWith('betterilias_feedback_files:')){
        const value=JSON.parse(sessionStorage[key]);value.timestamp=0;sessionStorage[key]=JSON.stringify(value);
      }
      const freshCache=(await import('/src/lib/feedbackFilesCache.ts?expired-test')).feedbackFilesCache;
      const fresh=await freshCache.read(resource,async()=>{calls++;return {member_id:'1',files:[{id:'fresh',title:'Fresh.pdf'}]};});
      cache.invalidateSessionRequests();
      return {calls,title:result.files[0].title,fresh:fresh.files[0].title,remaining:Object.keys(sessionStorage).filter(k=>k.startsWith('betterilias_feedback_files:')).length};
    }''')
    assert result == {'calls':1,'title':'Cached correction.pdf','fresh':'Fresh.pdf','remaining':0}


def mount_file_corrections(page):
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts');const {api}=await import('/src/lib/api.ts');cache.setSessionId('alice');
      localStorage.setItem('ilias_ta_eval_mode_42','file');
      const assignment={ass_id:'20',title:'Assignment one',url:'#',is_ongoing:true,properties:{}};
      const second={...assignment,ass_id:'21',title:'Assignment two',is_ongoing:false};
      const overview={exercise_ref_id:'200',title:'Exercises',has_ta_access:true,breadcrumbs:[],assignments:[assignment,second]};
      const listing={listing_complete:true,exercise:{ref_id:'200',title:'Exercises',total_participants:1,submitted_count:1,graded_count:0},
        active_assignment_id:'20',available_assignments:[assignment,second],fetched_at:new Date().toISOString(),
        submissions:[{member_id:'1',student_name:'Test Student',submission_status:'submitted',passed_status:'not_graded',files:[],
          evaluation_by_file_url:'https://ilias.unibe.ch/feedback?member_id=1&ass_id=20'}]};
      cache.setCachedExerciseOverview('200',overview);cache.setCachedExerciseSubmissions('200','20',listing);
      api.getExerciseOverview=async()=>overview;
      api.getExerciseSubmissions=async(exercise,ass)=>({...listing,active_assignment_id:ass||'20',
        submissions:listing.submissions.map(s=>({...s,evaluation_by_file_url:'https://ilias.unibe.ch/feedback?member_id=1&ass_id='+(ass||'20')}))});
      window.fileCalls=0;window.failFiles=true;
      window.fetch=async(url,init={})=>{
        if(String(url).includes('/feedback-files')){fileCalls++;return new Response(JSON.stringify(failFiles?{detail:'Feedback read failed'}:
          {member_id:'1',files:[{id:'review',title:new URL(String(url),location.origin).searchParams.get('ass_id')==='21'?'Assignment two.pdf':'Correction.pdf'}]}),{status:failFiles?409:200});}
        return new Response('{}',{status:200});
      };
      const {ExerciseView}=await import('/src/components/ExerciseView.tsx');
      const {SidebarPinsProvider}=await import('/src/lib/sidebarPins.ts');
      const Wrapped=props=>R.createElement(SidebarPinsProvider,null,R.createElement(ExerciseView,props));
      window.renderFileView=()=>mountAudit(Wrapped,{exerciseRefId:'200',courseRefId:'42',activeTabProp:'submissions',onBack:()=>{}});renderFileView();
    }''')


@pytest.mark.parametrize('width,height',[(320,740),(390,800),(430,800),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('de','dark'),('en','light'),('en','dark'),('de','light')])
def test_file_retry_cached_details_and_failed_refresh_keep_known_files(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size(dict(width=width,height=height));tr=language(page,code,scheme)
    mount_file_corrections(page)
    error=page.get_by_role('alert').filter(has_text='Feedback read failed');error.wait_for()
    page.wait_for_timeout(100)
    initial_calls=page.evaluate('fileCalls')
    page.wait_for_timeout(100);assert page.evaluate('fileCalls') == initial_calls
    page.evaluate('failFiles=false');error.get_by_role('button',name=tr['Erneut versuchen'],exact=True).click()
    page.get_by_text('Correction.pdf',exact=True).wait_for();assert page.evaluate('fileCalls') == initial_calls+1
    page.locator('.submission-details').click()
    dialog=page.get_by_role('dialog',name='Test Student',exact=True)
    dialog.get_by_text('Correction.pdf',exact=True).wait_for();page.wait_for_timeout(100)
    assert page.evaluate('fileCalls') == initial_calls+1
    dialog.get_by_role('button',name=tr['Schliessen'],exact=True).first.click()
    page.evaluate('failFiles=true')
    if page.locator('.phone-page-header').is_visible():
        page.locator('.phone-page-header summary').click()
    page.get_by_role('button',name=tr['Neu von ILIAS abrufen'],exact=True).first.click()
    error.wait_for();page.get_by_text('Correction.pdf',exact=True).wait_for()
    error.evaluate("e=>e.scrollIntoView({block:'center'})")
    screenshot(page,f'feedback-files-{width}-{height}-{code}-{scheme}')
    page.evaluate('failFiles=false');error.get_by_role('button',name=tr['Erneut versuchen'],exact=True).click()
    error.wait_for(state='hidden')
    assert page.get_by_text('Correction.pdf',exact=True).count() == 1


def test_modal_retry_keeps_cached_file_visible(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount_file_corrections(page)
    error=page.get_by_role('alert').filter(has_text='Feedback read failed');error.wait_for()
    page.evaluate('failFiles=false');error.get_by_role('button',name=tr['Erneut versuchen'],exact=True).click()
    page.get_by_text('Correction.pdf',exact=True).wait_for();page.locator('.submission-details').click()
    dialog=page.get_by_role('dialog',name='Test Student',exact=True)
    dialog.get_by_text('Correction.pdf',exact=True).wait_for()
    page.evaluate("failFiles=true;window.dispatchEvent(new Event('betterilias-retry'))")
    modal_error=dialog.get_by_role('alert').filter(has_text='Feedback read failed');modal_error.wait_for()
    assert dialog.get_by_text('Correction.pdf',exact=True).is_visible()
    page.evaluate('failFiles=false');modal_error.get_by_role('button',name=tr['Erneut versuchen'],exact=True).click()
    modal_error.wait_for(state='hidden');assert dialog.get_by_text('Correction.pdf',exact=True).is_visible()


def test_assignment_switch_and_view_remount_reuse_matching_cache(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount_file_corrections(page)
    error=page.get_by_role('alert').filter(has_text='Feedback read failed');error.wait_for()
    page.evaluate('failFiles=false');error.get_by_role('button',name=tr['Erneut versuchen'],exact=True).click()
    page.get_by_text('Correction.pdf',exact=True).wait_for()
    page.locator('#ta-assignment-select').select_option('21')
    page.get_by_text('Assignment two.pdf',exact=True).wait_for()
    count=page.evaluate('fileCalls')
    page.locator('#ta-assignment-select').select_option('20')
    page.get_by_text('Correction.pdf',exact=True).wait_for();page.wait_for_timeout(100)
    assert page.evaluate('fileCalls') == count
    assert page.get_by_text('Assignment two.pdf',exact=True).count() == 0
    page.evaluate('mountAudit(()=>null,{})');page.wait_for_timeout(50)
    page.evaluate('renderFileView()');page.get_by_text('Correction.pdf',exact=True).wait_for()
    page.wait_for_timeout(100);assert page.evaluate('fileCalls') == count


def test_unavailable_storage_still_caches_in_memory(workflow_page):
    page=workflow_page;install_transport(page)
    page.evaluate("()=>{fileCache.setIliasSaverEnabled(true);Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Disabled')}});window.read=startRead();}")
    page.wait_for_function('fileRequests.length===1');page.evaluate("fileRequests[0].finish([{id:'review',title:'Correction.pdf'}])")
    assert page.evaluate('read.then(r=>r.files[0].title)') == 'Correction.pdf'
    assert page.evaluate('startRead().then(r=>r.files[0].title)') == 'Correction.pdf'
    assert page.evaluate('fileRequests.length') == 1


def test_disabling_saver_during_read_does_not_repopulate_storage(workflow_page):
    page=workflow_page;install_transport(page)
    page.evaluate('()=>{fileCache.setIliasSaverEnabled(true);window.read=startRead();}')
    page.wait_for_function('fileRequests.length===1')
    page.evaluate('fileCache.setIliasSaverEnabled(false)')
    page.evaluate("fileRequests[0].finish([{id:'review',title:'Correction.pdf'}])");page.evaluate('read')
    assert page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('betterilias_feedback_files:')).length") == 0
