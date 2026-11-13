"""Mocked Chrome emulation: community board and the shared forum composer."""
import os
from pathlib import Path
import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chrome emulation')
ROOT = Path(__file__).resolve().parents[1]


def mount(page, admin=False):
    page.evaluate('''async admin => {
      const {requestApi}=await import('/src/lib/featureRequests.ts');
      window.communityData={id:'abc',title:'Better keyboard navigation',description:'A helpful improvement with a long description. '.repeat(4),category:'qol',status:'open',nickname:'Student',created:1700000000,updated:1700000000,owned:true,score:0,my_vote:0,comment_count:0,comments:[],images:[],images_archived:false};
      window.communityWrites=[];
      requestApi.list=async()=>({items:[structuredClone(communityData)],has_more:false,storage:{used:1000,limit:10000000000}});
      requestApi.detail=async()=>structuredClone(communityData);
      requestApi.upload=async()=>{if(window.failUpload)throw Error('Image storage is full');return {id:'image'};};
      requestApi.write=async(path,method,payload,admin)=>{
        communityWrites.push({path,method,payload,admin});
        if(path.endsWith('/vote')){communityData.my_vote=payload.value;communityData.score=payload.value;}
        else if(path.endsWith('/status'))communityData.status=payload.status;
        else if(method==='DELETE'&&path.includes('/comments/'))communityData.comments=[];
        else if(path.includes('/comments')){
          if(method==='PATCH')communityData.comments[0].message=payload.message;
          else communityData.comments.push({id:'comment',message:payload.message,nickname:payload.nickname,owned:true,created:1700000001,updated:1700000001});
        }else if(method!=='DELETE')Object.assign(communityData,payload,{images:[]});
        return structuredClone(communityData);
      };
      const {FeatureRequestsView}=await import('/src/components/FeatureRequestsView.tsx');mountAudit(FeatureRequestsView,{admin});
    }''', admin)


def shot(page, name):
    folder = ROOT / 'scratch/community-checks'; folder.mkdir(parents=True, exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(folder / (name + '.png')), full_page=True)


@pytest.mark.parametrize('width,height', [(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme', [('en','light'),('de','dark'),('en','dark'),('de','light')])
def test_create_vote_reply_edit_and_resize(workflow_page, width, height, code, scheme):
    page = workflow_page; page.set_viewport_size({'width':width,'height':height}); tr = language(page, code, scheme); mount(page)
    page.get_by_role('button', name='Better keyboard navigation', exact=True).wait_for()
    shot(page, f'list-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button', name=tr['requests.new'], exact=True).click()
    title = page.get_by_label(tr['requests.request_title'], exact=True)
    title.fill('Accessible lecture navigation')
    description = page.get_by_label(tr['requests.description'], exact=True); description.fill('Preserve my unsaved draft through resizing.')
    page.get_by_label(tr['requests.nickname'], exact=True).fill('Student')
    page.get_by_label(tr['requests.category'], exact=True).select_option('ilias')
    page.set_viewport_size({'width':1280 if width < 768 else 390,'height':844})
    assert description.input_value() == 'Preserve my unsaved draft through resizing.'
    page.set_viewport_size({'width':width,'height':height})
    shot(page, f'compose-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button', name=tr['requests.publish'], exact=True).click()
    page.get_by_role('heading', name='Accessible lecture navigation', exact=True).wait_for()
    assert page.evaluate("communityWrites[0].payload.category==='ilias'")
    up = page.get_by_role('button', name=tr['requests.upvote'], exact=True); up.click()
    page.wait_for_function("communityData.my_vote===1")
    assert up.get_attribute('aria-pressed') == 'true'
    up.click(); page.wait_for_function("communityData.my_vote===0")
    page.get_by_role('button', name=tr['requests.downvote'], exact=True).click(); page.wait_for_function("communityData.my_vote===-1")
    page.get_by_role('button', name=tr['forum.reply'], exact=True).click()
    message = page.get_by_label(tr['forum.message'], exact=True); message.fill('This would help on phones too.')
    shot(page, f'reply-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button', name=tr['forum.send'], exact=True).click()
    page.get_by_text('This would help on phones too.', exact=True).wait_for()
    page.get_by_role('button', name=tr['forum.edit_post'], exact=True).last.click()
    page.get_by_label(tr['forum.message'], exact=True).fill('An edited comment')
    page.get_by_role('button', name=tr['forum.send'], exact=True).click()
    page.get_by_text('An edited comment', exact=True).wait_for()
    shot(page, f'detail-{width}-{height}-{code}-{scheme}')


def test_failed_upload_preserves_draft_and_retry(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    page.get_by_role('button',name=tr['requests.new'],exact=True).click()
    page.get_by_label(tr['requests.request_title'],exact=True).fill('Upload test')
    page.get_by_label(tr['requests.description'],exact=True).fill('Keep this description')
    page.locator('input[type=file]').set_input_files({'name':'screen.png','mimeType':'image/png','buffer':b'png-test'})
    page.evaluate('window.failUpload=true')
    page.get_by_role('button',name=tr['requests.publish'],exact=True).click()
    page.get_by_role('alert').filter(has_text='Image storage is full').wait_for()
    assert page.get_by_label(tr['requests.description'],exact=True).input_value() == 'Keep this description'
    assert page.evaluate('communityWrites.length') == 0
    page.evaluate('window.failUpload=false')
    page.get_by_role('button',name=tr['requests.publish'],exact=True).click()
    page.get_by_role('heading',name='Upload test',exact=True).wait_for()
    assert page.evaluate("communityWrites[0].payload.images[0]==='image'")


def test_admin_moderates_and_confirms_delete(workflow_page):
    page=workflow_page;tr=language(page,'de','dark');mount(page,True)
    page.get_by_role('button',name='Better keyboard navigation',exact=True).click()
    page.get_by_label(tr['requests.status'],exact=True).select_option('completed')
    page.wait_for_function("communityData.status==='completed'")
    page.get_by_role('button',name=tr['requests.delete'],exact=True).click()
    page.locator('dialog.confirmation-dialog').wait_for()
    assert page.evaluate('communityWrites.length') == 1
    page.keyboard.press('Escape')
    page.locator('dialog.confirmation-dialog').wait_for(state='hidden')
    assert page.evaluate('communityWrites.length') == 1
    shot(page,'admin-completed-de-dark')


def test_attachment_viewer_restores_keyboard_focus(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    image=bytes.fromhex('89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001249444154789c6364686860606060620003000baa0104e42a59070000000049454e44ae426082')
    page.route('**/community-image.png',lambda route: route.fulfill(content_type='image/png',body=image))
    page.evaluate("communityData.images=[{id:'image',variants:[{width:2,height:2,url:'/community-image.png'}]}]")
    page.get_by_role('button',name='Better keyboard navigation',exact=True).click()
    image_button=page.get_by_role('button',name=tr['requests.image_alt'].replace('{number}','1').replace('{title}','Better keyboard navigation'),exact=True)
    image_button.focus();page.keyboard.press('Enter')
    page.get_by_role('dialog').wait_for()
    page.keyboard.press('Escape')
    page.get_by_role('dialog').wait_for(state='hidden')
    assert image_button.evaluate('e=>e===document.activeElement')


def test_public_deep_link_without_ilias_login(workflow_page,workflow_site):
    page=workflow_page
    page.route('**/api/feature-requests*',lambda route: route.fulfill(content_type='application/json',body='{"items":[],"has_more":false}'))
    page.route('**/api/auth/status',lambda route: route.fulfill(content_type='application/json',body='{"authenticated":false,"cookies_present":false}'))
    page.goto(workflow_site+'/?view=feature-requests')
    page.locator('[data-feature-requests]').wait_for()
    assert page.locator('[data-connection-notice]').count() == 0
    assert page.get_by_role('button',name='Feature requests',exact=True).get_attribute('aria-current') == 'page'
    page.get_by_role('button',name='Feature requests',exact=True).click()
    assert 'view=feature-requests' in page.url
