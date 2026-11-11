"""Forum pane, editor and draft behavior at phone/tablet/desktop sizes."""
import json
import os
from pathlib import Path
import pytest
from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language

pytestmark=pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS')!='1',reason='Opt-in Chrome emulation')
ROOT=Path(__file__).resolve().parents[1]


def mount(page,student=False):
    page.evaluate('''async(student)=>{
      const {forumApi}=await import('/src/lib/forum.ts');window.forumWrites=[];
      window.forumData={ref_id:'42',title:'Course discussion forum',intro_html:'<p>Welcome to the discussion.</p>',
        can_create:true,can_edit_page:!student,editor_url:'https://ilias.unibe.ch/ilias.php?ref_id=42',page:0,has_more:false,
        threads:[{id:'10',title:'Questions about the assignment and the supplied CSV file',author:'Test Student',last_post:'10.11.2026',post_count:2,unread:true,closed:false,sticky:true,actions:student?[]:['close','delete']},
        {id:'20',title:'Closed discussion',author:'Test Tutor',last_post:'09.11.2026',post_count:1,unread:false,closed:true,sticky:false,actions:[]}]};
      forumApi.overview=async()=>structuredClone(forumData);
      window.forumPageData={ref_id:'42',revision:'a'.repeat(64),blocks:[{id:'intro',content:'<p>Welcome to the discussion.</p>',characteristic:'Standard'}],append_after_id:'intro',preview_html:'',other_components:0,
        elements:[{id:'intro',text_block:{id:'intro',content:'<p>Welcome to the discussion.</p>',characteristic:'Standard'},preview_html:''}]};
      forumApi.page=async()=>structuredClone(forumPageData);
      forumApi.writePage=async(ref,request)=>{
        const id=request.block_id||'new-block';const block={id,content:request.content,characteristic:'Standard'};
        if(request.action==='delete'){forumPageData.blocks=forumPageData.blocks.filter(b=>b.id!==id);forumPageData.elements=forumPageData.elements.filter(b=>b.id!==id);}
        else if(request.action==='insert'){forumPageData.blocks.push(block);forumPageData.elements.push({id,text_block:block,preview_html:''});}
        else{forumPageData.blocks=forumPageData.blocks.map(b=>b.id===id?block:b);forumPageData.elements=forumPageData.elements.map(b=>b.id===id?{id,text_block:block,preview_html:''}:b);}
        return structuredClone(forumPageData);
      };
      forumApi.thread=async(ref,id)=>({ref_id:ref,thread_id:id,title:id==='10'?forumData.threads[0].title:'Closed discussion',closed:id==='20',page:0,has_more:false,
        posts:[{id:'100',subject:'Questions',author:'Test Student',date:'10.11.2026, 10:00',edited:'',depth:1,avatar_url:null,can_reply:id==='10',can_edit:!student,
          html:'<p>'+('A readable post with some detailed discussion. '.repeat(35))+'</p><pre>'+('code_'.repeat(50))+'</pre>'}]});
      forumApi.write=async(ref,thread,payload,files)=>{forumWrites.push({ref,thread,payload,files:files.length});return {thread_id:'10',post_id:'101'};};
      forumApi.moderate=async()=>{forumData.threads[0].closed=true;return structuredClone(forumData);};
      const {ForumView}=await import('/src/components/ForumView.tsx');
      mountAudit(ForumView,{refId:'42',title:'Forum',courseTitle:'Course',onBack:()=>window.forumBack=true});
    }''',student)


def shot(page,name):
    folder=ROOT/'scratch/forum-checks';folder.mkdir(parents=True,exist_ok=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(folder/(name+'.png')))


@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('de','dark'),('en','light'),('de','light'),('en','dark')])
def test_read_reply_resize_and_publish(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme);mount(page)
    page.get_by_role('button',name='Questions about the assignment',exact=False).click()
    page.get_by_role('article').wait_for()
    assert page.get_by_role('button',name=tr['forum.back_threads'],exact=True).is_visible()==(width<768)
    if width<768: assert not page.get_by_label(tr['forum.search'],exact=True).is_visible()
    paragraph=page.locator('.forum-prose p').last
    assert paragraph.evaluate('e=>e.getBoundingClientRect().width<=68*parseFloat(getComputedStyle(e).fontSize)')
    assert page.get_by_role('region',name=tr['forum.code'],exact=True).get_attribute('tabindex')=='0'
    shot(page,f'read-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button',name=tr['forum.reply'],exact=True).click()
    editor=page.get_by_role('textbox',name=tr['forum.message'],exact=True)
    editor.fill('My unsaved reply')
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert editor.inner_text()=='My unsaved reply'
    page.set_viewport_size({'width':width,'height':height})
    page.get_by_role('button',name=tr['forum.send'],exact=True).click()
    page.get_by_role('status').filter(has_text=tr['forum.saved']).wait_for()
    assert page.evaluate("forumWrites.length===1 && forumWrites[0].payload.parent_id==='100'")
    shot(page,f'saved-{width}-{height}-{code}-{scheme}')


def test_closed_threads_and_student_permissions(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page,student=True)
    assert page.get_by_role('button',name=tr['forum.edit_page'],exact=True).count()==0
    page.get_by_role('button',name='Closed discussion',exact=False).click()
    page.get_by_text(tr['forum.closed_hint'],exact=True).wait_for()
    assert page.get_by_role('button',name=tr['forum.reply'],exact=True).count()==0
    assert page.get_by_text(tr['forum.actions'],exact=True).count()==0


def test_uncertain_post_check_keeps_the_same_operation_and_draft(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    page.evaluate('''async()=>{const {forumApi}=await import('/src/lib/forum.ts');forumApi.write=async(ref,thread,payload)=>{
      forumWrites.push(structuredClone(payload));if(forumWrites.length===1)throw new TypeError('Response lost');
      return {thread_id:'10',post_id:'101'};};}''')
    page.get_by_role('button',name=tr['forum.new_thread'],exact=True).click()
    page.get_by_label(tr['forum.subject'],exact=True).fill('New question')
    page.get_by_role('textbox',name=tr['forum.message'],exact=True).fill('My message')
    page.get_by_role('button',name=tr['forum.send'],exact=True).click()
    page.get_by_role('button',name=tr['forum.check_result'],exact=True).wait_for()
    assert page.get_by_role('textbox',name=tr['forum.message'],exact=True).get_attribute('contenteditable')=='false'
    page.get_by_role('button',name=tr['forum.check_result'],exact=True).click()
    page.get_by_role('status').filter(has_text=tr['forum.saved']).wait_for()
    assert page.evaluate('forumWrites.length===2 && JSON.stringify(forumWrites[0])===JSON.stringify(forumWrites[1])')


def test_edit_preview_places_thread_placeholder_below_custom_content(workflow_page):
    page=workflow_page;page.set_viewport_size({'width':390,'height':844});tr=language(page,'de','dark');mount(page)
    page.get_by_role('button',name=tr['forum.edit_page'],exact=True).click()
    placeholder=page.get_by_label(tr['forum.thread_placeholder'],exact=True)
    placeholder.wait_for()
    assert placeholder.bounding_box()['y']>page.get_by_text('Welcome to the discussion.',exact=True).bounding_box()['y']
    assert not page.get_by_role('article').count()
    shot(page,'edit-preview-390-de-dark')


@pytest.mark.parametrize('width,height',[(320,740),(390,844),(430,844),(768,850),(1280,900),(844,390)])
@pytest.mark.parametrize('code,scheme',[('de','dark'),('en','light')])
def test_native_text_edit_add_delete_and_resize(workflow_page,width,height,code,scheme):
    page=workflow_page;page.set_viewport_size({'width':width,'height':height});tr=language(page,code,scheme);mount(page)
    page.get_by_role('button',name=tr['forum.edit_page'],exact=True).click()
    page.get_by_role('button',name=tr['forum.edit_text'],exact=True).click()
    text=page.get_by_role('textbox',name=tr['forum.text_block'],exact=True)
    text.fill('My edited introduction')
    page.set_viewport_size({'width':1280 if width<768 else 390,'height':844})
    assert text.inner_text()=='My edited introduction'
    page.set_viewport_size({'width':width,'height':height})
    shot(page,f'edit-text-{width}-{height}-{code}-{scheme}')
    page.get_by_role('button',name=tr['forum.save_block'],exact=True).click()
    page.get_by_text('My edited introduction',exact=True).wait_for()
    page.get_by_role('button',name=tr['forum.add_text'],exact=True).click()
    page.get_by_role('textbox',name=tr['forum.text_block'],exact=True).fill('An additional text block')
    page.get_by_role('button',name=tr['forum.save_block'],exact=True).click()
    page.get_by_text('An additional text block',exact=True).wait_for()
    page.get_by_role('button',name=tr['forum.delete_block'],exact=True).last.click()
    page.get_by_role('dialog').get_by_role('button',name=tr['Bestätigen'],exact=True).click()
    page.get_by_text('An additional text block',exact=True).wait_for(state='hidden')
    shot(page,f'edit-saved-{width}-{height}-{code}-{scheme}')


def test_selecting_current_thread_does_not_silently_discard_reply(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    item=page.get_by_role('button',name='Questions about the assignment',exact=False)
    item.click();page.get_by_role('button',name=tr['forum.reply'],exact=True).click()
    page.get_by_role('textbox',name=tr['forum.message'],exact=True).fill('Keep this draft')
    item.click()
    page.get_by_role('dialog').get_by_role('button',name=tr['Auf Seite bleiben'],exact=True).click()
    assert page.get_by_role('textbox',name=tr['forum.message'],exact=True).inner_text()=='Keep this draft'


def test_page_refresh_preserves_draft_and_checks_concurrent_replacement(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    page.get_by_role('button',name=tr['forum.edit_page'],exact=True).click()
    page.get_by_role('button',name=tr['forum.edit_text'],exact=True).click()
    editor=page.get_by_role('textbox',name=tr['forum.text_block'],exact=True);editor.fill('My draft')
    page.evaluate("forumPageData.blocks[0].content='Concurrent edit';forumPageData.elements[0].text_block.content='Concurrent edit'")
    page.get_by_role('button',name=tr['forum.refresh'],exact=True).last.click()
    assert editor.inner_text()=='My draft'
    page.get_by_role('button',name=tr['forum.save_block'],exact=True).click()
    page.get_by_role('dialog').get_by_text(tr['forum.replace_changed_block'],exact=True).wait_for()


def test_uncertain_native_text_save_keeps_original_operation(workflow_page):
    page=workflow_page;tr=language(page,'en','light');mount(page)
    page.evaluate('''async()=>{
      const {forumApi}=await import('/src/lib/forum.ts');const native=forumApi.writePage;window.pageWrites=[];
      forumApi.writePage=async(ref,request)=>{pageWrites.push(structuredClone(request));
        if(pageWrites.length===1){await native(ref,request);throw new TypeError('Response lost');}
        return structuredClone(forumPageData);};
    }''')
    page.get_by_role('button',name=tr['forum.edit_page'],exact=True).click()
    page.get_by_role('button',name=tr['forum.edit_text'],exact=True).click()
    page.get_by_role('textbox',name=tr['forum.text_block'],exact=True).fill('Confirmed exactly once')
    page.get_by_role('button',name=tr['forum.save_block'],exact=True).click()
    page.get_by_role('button',name=tr['forum.check_result'],exact=True).wait_for()
    page.get_by_role('button',name=tr['forum.check_result'],exact=True).click()
    page.get_by_text('Confirmed exactly once',exact=True).wait_for()
    assert page.evaluate('pageWrites.length===2&&JSON.stringify(pageWrites[0])===JSON.stringify(pageWrites[1])')


def test_native_forum_opens_from_course_and_returns_with_browser_back(workflow_browser):
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    from urllib.parse import urlsplit
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT/'frontend/dist')))
    Thread(target=server.serve_forever,daemon=True).start()
    context=workflow_browser.new_context(viewport={'width':390,'height':844},locale='en-GB',color_scheme='light')
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    key='forum-test-account';requests=[]
    page.add_init_script("localStorage.setItem('betterilias_session_id','forum-test-account');localStorage.setItem('betterilias_language','en');")
    def api(route):
        request=route.request;path=urlsplit(request.url).path;requests.append(request)
        if path=='/api/auth/status': body={'authenticated':True,'cookies_present':True,'user_name':'Test Student'}
        elif path=='/api/dashboard/semesters': body={'active_semester':'HS2026','available_semesters':['HS2026'],'courses':[{'ref_id':'100','title':'Course','url':'https://ilias.unibe.ch/go/crs/100','item_type':'crs','semester':'HS2026'}],'grouped_by_category':{}}
        elif path=='/api/courses/100/materials': body={'container_ref_id':'100','title':'Course','breadcrumbs':[],
            'items':[{'ref_id':'42','title':'Course discussion forum','item_type':'frm','url':'https://ilias.unibe.ch/go/frm/42','properties':{}}],
            'blocks':[{'id':'forums','kind':'items','items':[{'ref_id':'42','title':'Course discussion forum','item_type':'frm','url':'https://ilias.unibe.ch/go/frm/42','properties':{}}]}]}
        elif path=='/api/courses/42/materials': body={'container_ref_id':'42','container_type':'frm','title':'Course discussion forum','items':[],
            'breadcrumbs':[{'ref_id':'100','title':'Course','url':'https://ilias.unibe.ch/go/crs/100'}]}
        elif path=='/api/forums/42':body={'ref_id':'42','title':'Course discussion forum','intro_html':'<p>Welcome</p>','can_create':True,'can_edit_page':False,'editor_url':None,'page':0,'has_more':False,
            'threads':[{'id':'10','title':'Assignment questions','author':'Test Student','last_post':'10.11.2026','post_count':1,'unread':False,'closed':False,'sticky':False,'actions':[]}]}
        elif path=='/api/forums/42/threads/10':body={'ref_id':'42','thread_id':'10','title':'Assignment questions','closed':False,'page':0,'has_more':False,
            'posts':[{'id':'100','subject':'Assignment questions','author':'Test Student','date':'10.11.2026','edited':'','html':'<p>The first forum post.</p>','avatar_url':None,'depth':1,'can_reply':True,'can_edit':False}]}
        else:body={}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(body))
    page.route('**/api/**',api)
    try:
        page.goto(f'http://127.0.0.1:{server.server_port}/?course=100&semester=HS2026')
        page.get_by_role('button',name='Course discussion forum',exact=True).click()
        page.wait_for_url('**folder=42*')
        page.get_by_role('heading',name='Course discussion forum',exact=True).wait_for()
        page.get_by_role('button',name='Assignment questions',exact=False).click()
        page.get_by_text('The first forum post.',exact=True).wait_for()
        page.get_by_role('button',name='Back to threads',exact=True).click()
        page.get_by_label('Search threads',exact=True).wait_for()
        page.go_back()
        page.get_by_role('button',name='Course discussion forum',exact=True).wait_for()
        protected=[r for r in requests if urlsplit(r.url).path.startswith('/api/')]
        assert protected and all(r.headers.get('x-session-id')==key for r in protected)
        assert all(key not in r.url for r in requests) and not errors
    finally:
        context.close();server.shutdown();server.server_close()
