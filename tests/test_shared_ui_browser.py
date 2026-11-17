"""Shared presentation/lifecycle contracts in Chromium emulation, with real DOM interactions."""
import os
from pathlib import Path
import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chrome emulation')
ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_shared_feedback_and_dialog_guards_preserve_drafts_and_focus(workflow_page, width, height, code, scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme)
    page.evaluate('''async()=>{
      const {Button}=await import('/src/components/ui/Button.tsx');
      const {FeedbackBanner}=await import('/src/components/ui/FeedbackBanner.tsx');
      const {Badge}=await import('/src/components/ui/Badge.tsx');
      const {DialogShell}=await import('/src/components/ui/DialogShell.tsx');
      function Fixture(){
        const [open,setOpen]=R.useState(false),[mounted,setMounted]=R.useState(true),[busy,setBusy]=R.useState(false);
        const [draft,setDraft]=R.useState(''),[tone,setTone]=R.useState('success'),[message,setMessage]=R.useState('Saved'),[revision,setRevision]=R.useState(0);
        window.sharedControls={setBusy,setTone,setMessage,setRevision,setOpen,setMounted};
        return R.createElement(R.Fragment,null,
          R.createElement(Button,{onClick:()=>{setMounted(true);setOpen(true);}},'Open editor'),
          R.createElement(Button,{variant:'primary'},'Primary action'),
          R.createElement(Button,{variant:'danger'},'Destructive action'),
          message&&R.createElement(FeedbackBanner,{tone,message,onDismiss:()=>setMessage('')}),
          R.createElement(Badge,{tone:'success'},'Completed'),
          mounted&&R.createElement(DialogShell,{open,title:'Edit content',onRequestClose:()=>setOpen(false),closeDisabled:busy,
            footer:R.createElement(Button,{type:'submit',form:'shared-form',loading:busy},'Save draft')},
            R.createElement('form',{id:'shared-form',onSubmit:e=>{e.preventDefault();window.sharedSaves=(window.sharedSaves||0)+1;setBusy(true);}},
              R.createElement('label',null,'Draft',R.createElement('input',{autoFocus:true,value:draft,onChange:e=>setDraft(e.target.value),className:'min-h-12 w-full border p-2'})),
              R.createElement('p',null,'Server revision '+revision),
              ...Array.from({length:16},(_,i)=>R.createElement('p',{key:i,className:'py-2'},'Additional editor content '+i)))))
      }
      mountAudit(()=>R.createElement(R.StrictMode,null,R.createElement(Fixture)),{});
    }''')
    page.get_by_role('status').filter(has_text='Saved').wait_for()
    for label in ['Primary action','Destructive action']:
        control=page.get_by_role('button',name=label,exact=True)
        contrast=control.evaluate('''el=>{
          const style=getComputedStyle(el),ctx=document.createElement('canvas').getContext('2d');
          function luminance(color){ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
          const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        }''')
        assert contrast >= 4.5, (label, scheme, contrast)
    assert page.get_by_text('Completed',exact=True).get_attribute('role') is None
    page.evaluate("sharedControls.setTone('error');sharedControls.setMessage('Save failed')")
    page.get_by_role('alert').filter(has_text='Save failed').wait_for()
    page.get_by_role('button',name=tr['Schliessen'],exact=True).click()
    assert page.get_by_role('alert').count() == 0
    opener=page.get_by_role('button',name='Open editor',exact=True)
    opener.focus();page.keyboard.press('Enter')
    dialog=page.get_by_role('dialog',name='Edit content',exact=True);dialog.wait_for()
    draft=dialog.get_by_label('Draft',exact=True)
    assert dialog.evaluate('el=>el.contains(document.activeElement)')
    draft.fill('Keep this unsaved draft')
    page.evaluate('sharedControls.setRevision(2)')
    page.set_viewport_size({'width':1280 if width < 768 else 390,'height':390})
    assert draft.input_value() == 'Keep this unsaved draft'
    page.set_viewport_size({'width':width,'height':height})
    box=dialog.bounding_box()
    assert box['x'] >= 0 and box['x']+box['width'] <= width+1
    assert box['y'] >= 0 and box['y']+box['height'] <= height+1
    close=dialog.get_by_role('button',name=tr['Schliessen'],exact=True)
    save=dialog.get_by_role('button',name='Save draft',exact=True)
    assert close.bounding_box()['height'] >= 44
    assert save.bounding_box()['y']+save.bounding_box()['height'] <= height
    folder=ROOT/'scratch/shared-ui-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'dialog-{width}-{height}-{code}-{scheme}.png'))
    save.click();page.wait_for_function('sharedSaves===1')
    assert save.is_disabled() and close.is_disabled()
    page.keyboard.press('Escape')
    assert dialog.is_visible() and draft.input_value() == 'Keep this unsaved draft'
    page.evaluate('sharedControls.setBusy(false)')
    # Ignore closedby as Safari does: cancel guards must protect pending forms there too.
    page.evaluate("document.querySelector('dialog.ui-dialog').removeAttribute('closedby');sharedControls.setBusy(true)")
    page.keyboard.press('Escape');assert dialog.is_visible()
    page.evaluate('sharedControls.setBusy(false)')
    close.click();dialog.wait_for(state='hidden')
    assert opener.evaluate('el=>el===document.activeElement')
    opener.click();dialog.wait_for();assert draft.input_value() == 'Keep this unsaved draft'
    page.keyboard.press('Escape');dialog.wait_for(state='hidden')
    assert opener.evaluate('el=>el===document.activeElement')
    opener.click();dialog.wait_for()
    page.evaluate('sharedControls.setMounted(false)')
    dialog.wait_for(state='detached')
    assert opener.evaluate('el=>el===document.activeElement')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')


@pytest.mark.parametrize('width', [320,1280])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_grading_feedback_keeps_domain_labels_and_actions(workflow_page, width, code, scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':844});tr=language(page,code,scheme)
    page.evaluate('''async()=>{
      const {GradingFeedbackBar}=await import('/src/components/GradingFeedbackBar.tsx');window.gradeActions=[];
      function Fixture(){const [show,setShow]=R.useState(true),[status,setStatus]=R.useState('passed');window.changeGradeStatus=setStatus;
        return show&&R.createElement(GradingFeedbackBar,{feedback:{id:'saved',memberId:'student1',studentName:'Alexandra Very Long Student Name With Several Parts',teamId:'12',status,mark:'5.5',wasFilteredOut:true},
          onDismiss:()=>setShow(false),onViewSubmission:id=>gradeActions.push(id),onResetFilter:()=>gradeActions.push('reset')});}
      mountAudit(Fixture,{});
    }''')
    banner=page.get_by_role('status');banner.wait_for()
    assert banner.get_attribute('aria-live') == 'polite'
    page.get_by_text(tr['Bestanden'],exact=True).wait_for()
    page.get_by_text('5.5',exact=True).wait_for()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    folder=ROOT/'scratch/shared-ui-checks';folder.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(folder/f'grading-{width}-{code}-{scheme}.png'))
    for label in [tr['Einreichung ansehen'],tr['Filter aufheben']]:
        button=page.get_by_role('button',name=label,exact=True)
        assert button.bounding_box()['height'] >= 44
        button.click()
    assert page.evaluate('gradeActions') == ['student1','reset']
    page.evaluate("changeGradeStatus('failed')")
    page.get_by_text(tr['Nicht bestanden'],exact=True).wait_for()
    page.evaluate("changeGradeStatus('not_graded')")
    page.get_by_text(tr['Nicht bewertet'],exact=True).wait_for()
    page.get_by_role('button',name=tr['Schliessen'],exact=True).click()
    banner.wait_for(state='detached')
