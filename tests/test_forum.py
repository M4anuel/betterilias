"""Native forum contracts and fault injection. Fixtures contain no real user content."""
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.forum_models import ForumWrite
from backend.main import app
from backend.scrapers.forum import parse_forum_overview, parse_forum_conversation, parse_forum_form, clean_markup
from backend.scrapers.materials import parse_course_materials
from backend.services.ilias_client import IliasClient
from backend.services.authoring import AuthoringError


def url(command='showThreads', **params):
    return 'https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilObjForumGUI&cmdNode=fresh:node&ref_id=42&cmd='+command+''.join('&'+key+'='+str(value) for key,value in params.items())


def listing(created=False, closed=False, sticky=False, deleted=False):
    items = []
    for tid,title in [('10','Questions')] + ([('20','New topic')] if created else []):
        if deleted and tid=='10': continue
        items.append(f'''<li><div class="il-item il-std-item"><h4 class="il-item-title"><a href="{url('viewThread',thr_pk=tid,page=0)}">{title}{' (closed)' if closed and tid=='10' else ''}</a></h4>
          <span class="il-item-property-name">Created by</span><span class="il-item-property-value">Test Student</span>
          <span class="il-item-property-name">Posts</span><span class="il-item-property-value">2</span>
          <a href="{url('reopen' if closed else 'close',thr_pk=tid)}">State</a>
          <a href="{url('unmakesticky' if sticky else 'makesticky',thr_pk=tid)}">Pin</a>
          <a href="{url('confirmDeleteThreads',thr_pk=tid)}">Delete</a></div></li>''')
    return f'''<h1 class="ilHeader">Course forum</h1><div id="tab_forums_threads"></div>
      <div id="il_center_col"><div class="ilc_page_Page"><p>Introduction</p></div></div>
      <button data-action="{url('createThread')}">New Thread</button>
      <button data-action="{url('edit').replace('ilObjForumGUI','ilForumPageGUI')}&rtoken=private-token">Edit Page</button>
      <ul>{''.join(items)}</ul>'''


def thread(tid='10', added=False, closed=False, updated=False):
    posts = [('100','Questions','<p>Original post</p>')]
    if tid=='20': posts=[('200','New topic','<p>Hello</p>')]
    elif added: posts.append(('101','Questions','<p>Hello</p>'))
    if updated: posts=[('100','Questions','<p>Hello</p>')]
    content=''
    for pid,subject,html in posts:
        content += f'''<li class="ilFrmPostRow ilFrmPost-level-1"><div class="ilFrmPostImage"><img src="/data/unibe/usr_images/test.jpg" alt="student"></div>
          <a id="{pid}"></a><div class="ilFrmPostHeader"><span class="small">Test Student | student | 10.11.2026, 10:00</span><div class="ilFrmPostTitle">{subject}</div></div>
          <div class="ilFrmPostContent">{html}</div>
          {'' if closed else f'<button data-action="{url("viewThread",thr_pk=tid,pos_pk=pid,action="showreply")}">Reply</button>'}
          <button data-action="{url('viewThread',thr_pk=tid,pos_pk=pid,action='showedit')}">Edit</button></li>'''
    return f'<h1 class="ilHeader">Thread "Questions"</h1><ul id="ilFrmPostList">{content}</ul>'


def form(tid=None,pid='100',editing=False):
    command='savePost' if tid else 'addThread'
    action=url('post',fallbackCmd=command,rtoken='fresh-token',**({'thr_pk':tid,'pos_pk':pid,'action':'ready_showedit' if editing else 'ready_showreply'} if tid else {}))
    return f'''<form action="{action}"><input type="hidden" name="ilfilehash" value="fresh-hash">
      <input name="subject" value="Questions"><textarea name="message">&lt;p&gt;Original post&lt;/p&gt;</textarea>
      <input type="file" name="userfile[0]"><input type="submit" name="cmd[{command}]" value="Save"></form>'''


def test_overview_parses_permissions_intro_and_thread_state_without_exposing_tokens():
    parsed=parse_forum_overview(listing(closed=True,sticky=True),'42')
    assert parsed.data.threads[0].closed and parsed.data.threads[0].sticky
    assert parsed.data.threads[0].post_count==2
    assert parsed.data.can_create and parsed.data.can_edit_page
    assert 'Introduction' in parsed.data.intro_html
    assert 'rtoken' not in parsed.data.model_dump_json() and 'private-token' not in parsed.data.model_dump_json()
    assert parse_course_materials(listing(),'42').container_type=='frm'


def test_posts_preserve_content_and_proxy_profile_photos():
    parsed=parse_forum_conversation(thread(added=True),'42','10')
    assert len(parsed.data.posts)==2
    assert parsed.data.posts[0].author=='Test Student'
    assert parsed.data.posts[0].can_reply and parsed.data.posts[0].can_edit
    assert parsed.data.posts[0].avatar_url.startswith('/api/materials/42/download?')
    assert not parse_forum_conversation(thread(closed=True),'42','10').data.posts[0].can_reply
    attached=thread().replace('</li>','<div class="ilFrmPostAttachmentsContainer"><a title="Example.pdf" href="'+url('viewThread',pos_pk=100,file='a'*32)+'">Example.pdf</a></div></li>',1)
    file=parse_forum_conversation(attached,'42','10').data.posts[0].attachments[0]
    assert file.title=='Example.pdf' and file.url.startswith('/api/materials/42/download?')


def test_signed_profile_photo_and_thread_visits_are_preserved():
    photo = '/src/FileDelivery/deliver.php/' + 'signed_profile_token' * 8
    html = thread().replace('/data/unibe/usr_images/test.jpg', photo)
    avatar = parse_forum_conversation(html, '42', '10').data.posts[0].avatar_url
    assert parse_qs(avatar.split('?', 1)[1])['custom_url'] == ['https://ilias.unibe.ch' + photo]
    for label in ('Visits', 'Aufrufe', 'Besuche'):
        html = listing().replace('</div></li>', f'<span class="il-item-property-name">{label}</span><span class="il-item-property-value">1\u2019234</span></div></li>')
        assert parse_forum_overview(html, '42').data.threads[0].view_count == 1234
    assert parse_forum_overview(listing(), '42').data.threads[0].view_count is None


def test_rich_content_is_inert_and_preserves_lecturer_blocks():
    html=clean_markup('<script>alert(1)</script><p onclick="bad()">Text <strong>bold</strong><a href="javascript:bad()">link</a></p><img src="https://evil.invalid/a.jpg"><pre>code</pre><table><tr><td>Cell</td></tr></table>','42')
    assert 'script' not in html and 'onclick' not in html and 'javascript:' not in html and 'evil.invalid' not in html
    assert '<strong>bold</strong>' in html and '<pre>code</pre>' in html and '<td>Cell</td>' in html


def test_post_forms_are_fresh_and_bound_to_the_requested_forum_and_thread():
    parsed=parse_forum_form(form('10'),'42','10')
    assert parsed.values['ilfilehash']=='fresh-hash' and parsed.command=='cmd[savePost]'
    with pytest.raises(Exception): parse_forum_form(form('10'),'43','10')
    with pytest.raises(Exception): parse_forum_form(form('10'),'42','11')


class Scenario:
    def __init__(self, lost=False):
        self.created=self.replied=self.updated=self.closed=self.sticky=self.deleted=False
        self.lost=lost; self.posts=[]; self.requests=[]
        self.manager=SimpleNamespace(session_id='forum-owner',has_cookies=lambda:True,
            get_http_client=lambda:httpx.AsyncClient(transport=httpx.MockTransport(self.handle),follow_redirects=True))
        self.client=IliasClient(self.manager)
        self.client._check_response_for_session_loss=lambda *args:None

    def handle(self, request):
        self.requests.append(request)
        p={k.lower():v[-1] for k,v in parse_qs(request.url.query.decode()).items()}
        cmd=p.get('fallbackcmd',p.get('cmd','')).lower(); tid=p.get('thr_pk')
        if request.method=='POST':
            self.posts.append(request)
            if cmd=='addthread': self.created=True
            if cmd=='savepost':
                if p.get('action')=='ready_showedit': self.updated=True
                else: self.replied=True
            if cmd=='performdeletethreads': self.deleted=True
            if self.lost: self.lost=False; raise httpx.ReadTimeout('Lost response',request=request)
            return httpx.Response(200,text='<p>Saved</p>',request=request)
        if cmd=='createthread': content=form()
        elif cmd=='viewthread' and p.get('action') in ('showreply','showedit'): content=form(tid,p.get('pos_pk','100'),p['action']=='showedit')
        elif cmd=='viewthread': content=thread(tid,self.replied,self.closed,self.updated)
        elif cmd=='confirmdeletethreads':
            content=f'<form action="{url("post",fallbackCmd="performDeleteThreads",rtoken="fresh-delete")}"><input type="hidden" name="thread_ids[]" value="10"></form>'
        else:
            if cmd=='close': self.closed=True
            if cmd=='reopen': self.closed=False
            if cmd=='makesticky': self.sticky=True
            if cmd=='unmakesticky': self.sticky=False
            content=listing(self.created,self.closed,self.sticky,self.deleted)
        return httpx.Response(200,text=content,request=request)


@pytest.fixture(autouse=True)
def private_receipts(tmp_path,monkeypatch): monkeypatch.setattr(settings,'coordination_dir',str(tmp_path/'coordination'))


@pytest.mark.asyncio
@pytest.mark.parametrize('reply',[False,True])
@pytest.mark.parametrize('lost',[False,True])
async def test_post_creation_and_reply_reconcile_without_duplicate_native_writes(reply,lost):
    scenario=Scenario(lost)
    payload=ForumWrite(operation_id='stable-forum-operation-123',subject='Questions' if reply else 'New topic',message='<p>Hello</p>',parent_id='100' if reply else None)
    if lost:
        with pytest.raises(AuthoringError): await scenario.client.write_forum_post('42',payload,'10' if reply else None)
    result=await scenario.client.write_forum_post('42',payload,'10' if reply else None)
    assert result.thread_id==('10' if reply else '20') and len(scenario.posts)==1
    assert (await scenario.client.write_forum_post('42',payload,'10' if reply else None))==result
    assert len(scenario.posts)==1 and b'fresh-hash' in scenario.posts[0].content
    payload.message='<p>Changed draft</p>'
    with pytest.raises(AuthoringError): await scenario.client.write_forum_post('42',payload,'10' if reply else None)
    assert len(scenario.posts)==1


@pytest.mark.asyncio
async def test_closed_thread_cannot_receive_reply_even_when_moderator_link_exists():
    scenario=Scenario(); scenario.closed=True
    payload=ForumWrite(operation_id='closed-thread-operation-123',subject='Questions',message='<p>Hello</p>',parent_id='100')
    with pytest.raises(AuthoringError) as exc: await scenario.client.write_forum_post('42',payload,'10')
    assert exc.value.status_code==403 and not scenario.posts


@pytest.mark.asyncio
async def test_edit_post_uses_native_edit_form_and_preserves_its_target():
    scenario=Scenario()
    original=await scenario.client.get_forum_edit_post('42','10','100')
    assert 'Original post' in original['message']
    payload=ForumWrite(operation_id='edit-post-operation-123',subject='Questions',message='<p>Hello</p>',edit_post_id='100')
    result=await scenario.client.write_forum_post('42',payload,'10')
    assert result.post_id=='100' and scenario.updated and not scenario.replied


@pytest.mark.asyncio
async def test_attachments_use_the_native_upload_field():
    scenario=Scenario()
    payload=ForumWrite(operation_id='attachment-operation-123',subject='New topic',message='<p>Hello</p>')
    await scenario.client.write_forum_post('42',payload,uploads=[('answer.txt',b'Example attachment','text/plain')])
    body=scenario.posts[0].content
    assert b'name="userfile[0]"; filename="answer.txt"' in body and b'Example attachment' in body


class PagedScenario(Scenario):
    def handle(self,request):
        p={k.lower():v[-1] for k,v in parse_qs(request.url.query.decode()).items()}
        if request.method=='GET' and p.get('cmd','').lower()=='viewthread' and not p.get('action') and p.get('thr_pk')=='10':
            if p.get('page','0')=='0':html=thread()+f'<a href="{url("viewThread",thr_pk=10,page=1)}">Next</a>'
            else:
                html=thread(added=self.replied).replace('id="100"','id="200"').replace('pos_pk=100','pos_pk=200').replace('id="101"','id="201"').replace('pos_pk=101','pos_pk=201')
                html+=f'<a href="{url("viewThread",thr_pk=10,page=0)}">Previous</a>'
            return httpx.Response(200,text=html,request=request)
        if request.method=='GET' and p.get('cmd','').lower() in ('','showthreads'):
            html=listing(created=True,deleted=True) if p.get('page')=='1' else listing()+f'<button data-action="{url("showThreads",page=1)}">Next</button>'
            return httpx.Response(200,text=html,request=request)
        return super().handle(request)


@pytest.mark.asyncio
async def test_threads_and_replies_on_later_pages_keep_their_native_targets():
    scenario=PagedScenario()
    later=await scenario.client.get_forum('42',1)
    assert later.page==1 and later.threads[0].id=='20'
    assert (await scenario.client.get_forum_thread('42','20')).posts[0].id=='200'
    posts=await scenario.client.get_forum_thread('42','10',1)
    assert posts.page==1 and posts.posts[0].id=='200'
    payload=ForumWrite(operation_id='paged-reply-operation-123',subject='Questions',message='<p>Hello</p>',parent_id='200',page=1)
    result=await scenario.client.write_forum_post('42',payload,'10')
    assert result.post_id=='201' and len(scenario.posts)==1


@pytest.mark.asyncio
@pytest.mark.parametrize('action',['close','reopen','makesticky','unmakesticky','delete'])
async def test_moderation_discovers_current_permissions_and_confirms_result(action):
    scenario=Scenario(); scenario.closed=action=='reopen'; scenario.sticky=action=='unmakesticky'
    data=await scenario.client.moderate_forum_thread('42','10',action)
    if action=='delete':
        assert not data.threads and len(scenario.posts)==1
        assert b'thread_ids%5B%5D=10' in scenario.posts[0].content
    else: assert data.threads


def test_native_unpin_alias_and_readonly_sticky_property_are_recognised():
    html = listing(sticky=True).replace('cmd=unmakesticky', 'cmd=make_topics_non_sticky')
    parsed = parse_forum_overview(html, '42')
    assert parsed.data.threads[0].sticky
    assert 'unmakesticky' in parsed.data.threads[0].actions
    assert 'cmd=make_topics_non_sticky' in parsed.actions['10']['unmakesticky']
    readonly = listing().replace('</div></li>', '<span class="il-item-property-name">Relevance</span><span class="il-item-property-value">Sticky</span></div></li>')
    assert parse_forum_overview(readonly, '42').data.threads[0].sticky


def test_supplied_pinned_dump_exposes_native_unpin_command():
    root = Path(r'C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias\Forum')
    path = next(root.glob('*PINNED*.html'), None)
    if path is None: pytest.skip('Private dump unavailable')
    parsed = parse_forum_overview(path.read_text(encoding='utf-8'), '3114496')
    pinned = [item for item in parsed.data.threads if item.sticky]
    assert pinned and 'unmakesticky' in pinned[0].actions
    assert 'make_topics_non_sticky' in parsed.actions[pinned[0].id]['unmakesticky']


@pytest.mark.asyncio
async def test_native_pin_and_unpin_confirm_without_repeating_actions():
    class NativePinScenario(Scenario):
        def handle(self, request):
            params = dict(request.url.params)
            if params.get('cmd') == 'make_topics_non_sticky': self.sticky = False
            response = super().handle(request)
            if 'text/html' in response.headers.get('content-type', '') or response.status_code == 200:
                return httpx.Response(200, text=response.text.replace('cmd=unmakesticky', 'cmd=make_topics_non_sticky'), request=request)
            return response
    scenario = NativePinScenario()
    pinned = await scenario.client.moderate_forum_thread('42', '10', 'makesticky')
    assert pinned.threads[0].sticky and 'unmakesticky' in pinned.threads[0].actions
    unpinned = await scenario.client.moderate_forum_thread('42', '10', 'unmakesticky')
    assert not unpinned.threads[0].sticky
    assert sum(request.url.params.get('cmd') == 'make_topics_non_sticky' for request in scenario.requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('stale_reads', [1, 10])
async def test_post_confirmation_retries_reads_without_reposting(stale_reads):
    class StalePostScenario(Scenario):
        reads = 0
        def handle(self, request):
            response = super().handle(request)
            if self.created and request.method == 'GET' and request.url.params.get('cmd') == 'viewThread':
                self.reads += 1
                if self.reads <= stale_reads:
                    return httpx.Response(200, text=response.text.replace('<p>Hello</p>', '<p>Stale body</p>'), request=request)
            return response
    scenario = StalePostScenario()
    payload = ForumWrite(operation_id='stale-read-forum-operation', subject='New topic', message='<p>Hello</p>')
    if stale_reads == 1:
        assert (await scenario.client.write_forum_post('42', payload)).post_id == '200'
        assert scenario.reads == 2
    else:
        with pytest.raises(AuthoringError) as exc: await scenario.client.write_forum_post('42', payload)
        assert exc.value.status_code == 409 and scenario.reads == 3
    assert len(scenario.posts) == 1


@pytest.mark.asyncio
async def test_inline_formatting_normalisation_does_not_reject_saved_post():
    scenario = Scenario()
    payload = ForumWrite(operation_id='inline-format-forum-operation', subject='New topic', message='<p><strong>He</strong>llo</p>')
    assert (await scenario.client.write_forum_post('42', payload)).post_id == '200'
    assert len(scenario.posts) == 1


def test_confirmation_text_preserves_visible_word_boundaries():
    from backend.services.forum import text
    assert text('Hello<div>world</div>') == text('<p>Hello<br>world</p>') == 'Hello world'
    assert text('<p><strong>He</strong>llo</p>') == text('<p>Hello</p>') == 'Hello'
    assert text('<p>He llo</p>') != text('<p>Hello</p>')


def test_forum_http_endpoints_require_explicit_mutation_credentials():
    client=TestClient(app)
    assert client.get('/api/forums/42').status_code==401
    assert client.post('/api/forums/42/threads',data={'payload':'{}'}).status_code==401
    assert client.post('/api/forums/42/threads/10/moderate',json={'action':'close'}).status_code==401
    assert client.get('/api/forums/42/page').status_code==401
    assert client.post('/api/forums/42/page',json={}).status_code==401


@pytest.mark.parametrize('filename,kind',[
    ('Threads_ Forum MMS_ ILIAS*.html','overview'),
    ('Threads_ Forum zur Vorlesung PN_One_Thread_Closed_*.html','closed'),
    ('Thread _Frage zur CSV-Datei__*.html','posts'),
    ('Thread _Frage zur CSV-Datei_reply__*.html','reply'),
    ('Threads_ Forum MMS__New_Thread__*.html','create'),
])
def test_supplied_forum_dumps(filename,kind):
    root=Path(r'C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias\Forum')
    path=next(root.glob(filename),None)
    if not path: pytest.skip('Private source dump not available')
    html=path.read_text(encoding='utf8')
    if kind in ('overview','closed'):
        parsed=parse_forum_overview(html,'3114496' if kind=='closed' else '3782761')
        assert parsed.data.threads and parsed.data.can_create
        if kind=='closed': assert any(t.closed for t in parsed.data.threads)
    elif kind=='posts': assert len(parse_forum_conversation(html,'3782761','120057').data.posts)==2
    else: assert parse_forum_form(html,'3782761','120057' if kind=='reply' else None).file_fields==['userfile[0]']


def test_supplied_selected_post_dump_preserves_its_changed_subject_and_invisible_body():
    root=Path(r'C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias\Forum')
    path=next(root.glob('*PAGENOTWORKING*.html'),None)
    if not path:pytest.skip('Private source dump not available')
    parsed=parse_forum_conversation(path.read_text(encoding='utf8'),'3782761','118933')
    assert len(parsed.data.posts)==1
    post=parsed.data.posts[0]
    assert post.subject and post.subject!=parsed.data.title
    assert '\u200e' in post.html and post.can_reply
