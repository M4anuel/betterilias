"""Per-entry grading writes against the actual correction view (mocked ILIAS)."""
import os
import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language, screenshot

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser regressions')


def mount_grading(page):
    page.evaluate('''async()=>{
      const {cache}=await import('/src/lib/cache.ts'); const {api}=await import('/src/lib/api.ts');
      window.gradeCache=cache; cache.setSessionId('grading-test');
      localStorage.setItem('ilias_ta_show_marks_42','true');
      const assignment={ass_id:'20',title:'Assignment one',url:'#',is_ongoing:true,properties:{}};
      window.overview={exercise_ref_id:'200',title:'Exercises',has_ta_access:true,breadcrumbs:[],assignments:[assignment]};
      window.listing={listing_complete:true,exercise:{ref_id:'200',title:'Exercises',total_participants:2,submitted_count:2,graded_count:0},
        active_assignment_id:'20',available_assignments:[assignment],fetched_at:new Date().toISOString(),
        submissions:['1','2'].map(id=>({member_id:id,student_name:'Student '+id,submission_status:'submitted',passed_status:'not_graded',files:[],mark:'',feedback:'',notice:''}))};
      cache.setCachedExerciseOverview('200',overview); cache.setCachedExerciseSubmissions('200','20',listing);
      api.getExerciseOverview=async()=>overview; api.getExerciseSubmissions=async()=>listing;
      window.sent=[];window.deliver=[];
      api.gradeSubmission=(exercise,id,data)=>{sent.push({exercise,id,data});return new Promise((resolve,reject)=>deliver.push({resolve,reject}));};
      const {ExerciseView}=await import('/src/components/ExerciseView.tsx');
      const {SidebarPinsProvider}=await import('/src/lib/sidebarPins.ts');
      const Wrapped=(props)=>R.createElement(SidebarPinsProvider,null,R.createElement(ExerciseView,props));
      window.renderGrading=(exercise='200')=>mountAudit(Wrapped,{exerciseRefId:exercise,courseRefId:'42',activeTabProp:'submissions',onBack:()=>{}});
      renderGrading();
    }''')
    page.locator('.submission-card-save').first.wait_for()
    page.wait_for_function("[...document.querySelectorAll('.submission-card-save')].every(b=>!b.disabled)")


def button(page, member):
    return page.locator(f'.submission-card-save[data-member-id="{member}"]')


def mark(page, member):
    return button(page, member).locator('xpath=ancestor::*[contains(@class,"submission-card ")]').locator('input').first


def wait_state(page, member, state):
    page.wait_for_function('([id,state])=>document.querySelector(`.submission-card-save[data-member-id="${id}"]`)?.dataset.saveState===state', arg=[member, state])


@pytest.mark.parametrize('width,height', [(320,740),(390,800),(430,800),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('de','dark'),('en','light'),('de','light'),('en','dark')])
def test_independent_pending_and_success(workflow_page, width, height, code, scheme):
    page=workflow_page;page.set_viewport_size(dict(width=width,height=height));tr=language(page,code,scheme)
    mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click()
    mark(page,'2').fill('5');button(page,'2').click()
    assert page.evaluate('sent.length') == 2
    for member in ['1','2']:
        assert button(page,member).get_attribute('aria-busy') == 'true'
        assert button(page,member).inner_text() == tr['Speichern...']
    # A duplicate DOM click cannot create a second write for this entry.
    button(page,'1').evaluate('(el)=>{el.click();el.click()}')
    assert page.evaluate('sent.length') == 2
    page.evaluate('deliver[1].resolve({success:true})');wait_state(page,'2','saved')
    assert button(page,'1').get_attribute('aria-busy') == 'true'
    page.wait_for_timeout(1200)
    page.evaluate('deliver[0].resolve({success:true})');wait_state(page,'1','saved')
    assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20').submissions.map(s=>s.mark)") == ['4','5']
    screenshot(page,f'correction-save-{width}-{height}-{code}-{scheme}')
    # The second card's older timer must not clear the first card's newer success.
    wait_state(page,'2','idle')
    assert button(page,'1').get_attribute('data-save-state') == 'saved'
    wait_state(page,'1','idle')


def test_failure_settles_only_its_entry_and_preserves_draft(workflow_page):
    page=workflow_page;language(page,'en','light');mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click();mark(page,'2').fill('5');button(page,'2').click()
    page.evaluate("deliver[1].reject(new Error('Write rejected'))")
    page.locator('dialog.confirmation-dialog').wait_for()
    assert button(page,'2').get_attribute('data-save-state') == 'idle'
    assert button(page,'1').get_attribute('aria-busy') == 'true'
    assert mark(page,'2').input_value() == '5'
    page.evaluate('deliver[0].resolve({success:true})');wait_state(page,'1','saved')
    assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20').submissions[1].mark") == ''
    page.keyboard.press('Escape')
    button(page,'2').click();assert page.evaluate('sent.length') == 3
    page.evaluate('deliver[2].resolve({success:true})');wait_state(page,'2','saved')


@pytest.mark.parametrize('invalidate', ['account','exercise','unmount'])
def test_stale_save_cannot_update_new_context(workflow_page, invalidate):
    page=workflow_page;language(page,'en','light');mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click()
    if invalidate == 'account':
        page.evaluate("gradeCache.setSessionId('other-account')")
    elif invalidate == 'exercise':
        page.evaluate("renderGrading('300')")
        page.wait_for_function("!document.querySelector('.submission-card-save').disabled")
        mark(page,'1').fill('6')
    else:
        page.evaluate('auditRoot.unmount()')
    page.evaluate('deliver[0].resolve({success:true})');page.wait_for_timeout(100)
    if invalidate == 'account':
        assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20')") is None
    else:
        assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20').submissions[0].mark") == ('' if invalidate == 'unmount' else '4')
    if invalidate == 'exercise':
        assert mark(page,'1').input_value() == '6'
        assert button(page,'1').get_attribute('data-save-state') == 'idle'



def test_pending_survives_filter_and_refresh(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click()
    search=page.get_by_placeholder(tr['Student / Team...'],exact=True)
    search.fill('Student 2');assert button(page,'1').count() == 0
    search.fill('');assert button(page,'1').get_attribute('aria-busy') == 'true'
    page.evaluate("import('/src/lib/api.ts').then(({api})=>api.getExerciseSubmissions=async()=>new Promise(resolve=>window.finishRefresh=()=>resolve(listing)))")
    page.get_by_role('button',name=tr['Neu von ILIAS abrufen'],exact=True).first.click()
    page.wait_for_function("typeof finishRefresh==='function'")
    assert button(page,'1').inner_text() == tr['Speichern...']
    page.evaluate('finishRefresh()')
    page.wait_for_function("!document.querySelector('.submission-card-save[data-member-id=\"2\"]').disabled")
    assert button(page,'1').get_attribute('aria-busy') == 'true'
    page.evaluate('deliver[0].resolve({success:true})');wait_state(page,'1','saved')
    assert mark(page,'1').input_value() == '4'


def test_modal_observes_card_pending_and_keeps_newer_draft(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click()
    card=button(page,'1').locator('xpath=ancestor::*[contains(@class,"submission-card ")]')
    card.locator('.submission-details').click()
    modal_save=page.locator('.submission-detail-save').first
    assert modal_save.is_disabled()
    assert tr['Speichern...'] in modal_save.inner_text()
    modal_mark=page.get_by_placeholder(tr['Note oder Punktzahl (z.B. 5.5 oder 18/20)'],exact=True)
    modal_mark.fill('6')
    page.evaluate('deliver[0].resolve({success:true})')
    page.wait_for_function("!document.querySelector('.submission-detail-save').disabled")
    modal_save.click();page.wait_for_function('sent.length===2')
    assert button(page,'1').get_attribute('aria-busy') == 'true'
    assert page.evaluate('sent[1].data.mark') == '6'
    modal_mark.fill('5')
    page.evaluate('deliver[1].resolve({success:true})')
    page.wait_for_function("!document.querySelector('.submission-detail-save').disabled")
    assert modal_mark.input_value() == '5'
    assert page.evaluate("import('/src/lib/navigationGuard.ts').then(m=>m.navigationGuard.hasUnsavedChanges())")
    assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20').submissions[0].mark") == '6'


def test_new_save_outlives_previous_success_timer(workflow_page):
    page=workflow_page;language(page,'en','light');mount_grading(page)
    mark(page,'1').fill('4');button(page,'1').click()
    page.evaluate('deliver[0].resolve({success:true})');wait_state(page,'1','saved')
    mark(page,'1').fill('5');button(page,'1').click()
    page.wait_for_timeout(2600)
    assert button(page,'1').get_attribute('aria-busy') == 'true'
    page.evaluate('deliver[1].resolve({success:true})');wait_state(page,'1','saved')
    assert page.evaluate("gradeCache.getCachedExerciseSubmissions('200','20').submissions[0].mark") == '5'


def test_grade_filter_retains_each_success_until_its_own_timeout(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount_grading(page)
    page.get_by_role('button',name=tr['Zu bewerten'],exact=False).click()
    mark(page,'1').fill('4');button(page,'1').click()
    mark(page,'2').fill('5');button(page,'2').click()
    page.evaluate('deliver[0].resolve({success:true})');wait_state(page,'1','saved')
    page.wait_for_timeout(1200)
    page.evaluate('deliver[1].resolve({success:true})');wait_state(page,'2','saved')
    assert button(page,'1').count() == 1
    button(page,'1').wait_for(state='detached')
    assert button(page,'2').get_attribute('data-save-state') == 'saved'
    button(page,'2').wait_for(state='detached')
