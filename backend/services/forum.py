"""Native forum reads and verified writes using freshly discovered forms."""
import hashlib
import json
import asyncio
import re
import unicodedata

from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.coordination import coordinated, atomic_json
from backend.observability import audit
from backend.forum_models import ForumWriteResult
from backend.scrapers.authoring import native_url
from backend.scrapers.forum import parse_forum_overview, parse_forum_conversation, parse_forum_form, query
from backend.services.authoring import AuthoringError
from backend.services.assignment_multipart import encode_assignment_form


def text(value):
    soup = BeautifulSoup(value, 'lxml')
    # Inline formatting is not a word boundary. Native TinyMCE may merge or
    # split inline nodes; paragraph and line-break boundaries remain spaces.
    for node in soup.select('br'):
        node.replace_with('\n')
    for node in soup.select('p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6,tr'):
        node.insert_before('\n')
        node.append('\n')
    visible = re.sub(r'[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', soup.get_text())
    return ' '.join(unicodedata.normalize('NFC', visible).split())


class ForumMixin:
    async def _forum_overview(self, client, ref_id, page=0):
        response = await self._authoring_container(client, ref_id)
        parsed = parse_forum_overview(response.text,ref_id)
        if page:
            if page not in parsed.pages: raise AuthoringError('forum.page_missing',404)
            response = await self._authoring_get(client,parsed.pages[page])
            parsed = parse_forum_overview(response.text,ref_id)
        parsed.data.page = page
        parsed.data.has_more = any(p>page for p in parsed.pages)
        return parsed

    async def _forum_thread(self, client, overview, thread_id, page=0):
        url = overview.thread_urls.get(thread_id)
        if not url:
            raise AuthoringError('forum.thread_missing',404)
        if page:
            first = await self._forum_thread(client,overview,thread_id)
            if page not in first.pages: raise AuthoringError('forum.page_missing',404)
            url = first.pages[page]
        response = await self._authoring_get(client,url)
        parsed = parse_forum_conversation(response.text,overview.data.ref_id,thread_id)
        thread = next((item for item in overview.data.threads if item.id==thread_id),None)
        parsed.data.closed = bool(thread and thread.closed)
        if parsed.data.closed:
            for post in parsed.data.posts: post.can_reply = False
        parsed.data.page = page; parsed.data.has_more = any(p>page for p in parsed.pages)
        return parsed

    async def _forum_expand_overview(self,client,overview,thread_id=None):
        visited={0};pending=dict(overview.pages)
        while thread_id not in overview.thread_urls and any(page not in visited for page in pending):
            if len(visited)>=100: raise AuthoringError('forum.confirm_unavailable',409)
            page=next(page for page in pending if page not in visited);visited.add(page)
            response=await self._authoring_get(client,pending[page])
            parsed=parse_forum_overview(response.text,overview.data.ref_id)
            overview.data.threads.extend(item for item in parsed.data.threads if item.id not in overview.thread_urls)
            overview.thread_urls.update(parsed.thread_urls);overview.actions.update(parsed.actions);pending.update(parsed.pages)
        return overview

    async def get_forum(self,ref_id,page=0):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            return (await self._forum_overview(client,ref_id,page)).data

    async def get_forum_thread(self,ref_id,thread_id,page=0):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            overview = await self._forum_overview(client,ref_id)
            overview = await self._forum_expand_overview(client,overview,thread_id)
            return (await self._forum_thread(client,overview,thread_id,page)).data

    async def _forum_all_posts(self,client,overview,thread_id):
        first=await self._forum_thread(client,overview,thread_id)
        posts={p.id:p for p in first.data.posts};visited={0};pending=dict(first.pages)
        while any(page not in visited for page in pending):
            if len(visited)>=100: raise AuthoringError('forum.confirm_unavailable',409)
            page=next(page for page in pending if page not in visited);visited.add(page)
            response=await self._authoring_get(client,pending[page])
            parsed=parse_forum_conversation(response.text,overview.data.ref_id,thread_id)
            posts.update({p.id:p for p in parsed.data.posts});pending.update(parsed.pages)
        return list(posts.values())

    async def get_forum_edit_post(self,ref_id,thread_id,post_id,page=0):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            overview = await self._forum_overview(client,ref_id)
            overview = await self._forum_expand_overview(client,overview,thread_id)
            thread = await self._forum_thread(client,overview,thread_id,page)
            url = thread.edit_urls.get(post_id)
            if not url: raise AuthoringError('forum.not_allowed',403)
            response = await self._authoring_get(client,url)
            form = parse_forum_form(response.text,ref_id,thread_id,editing=True)
            return {'subject':form.values['subject'],'message':form.values['message']}

    @coordinated(lambda self, ref_id, *args, **kwargs: 'forum-write:' + ref_id)
    @audit('forum_post_save')
    async def write_forum_post(self,ref_id,request,thread_id=None,uploads=()):
        self._ensure_authenticated()
        if not text(request.message): raise AuthoringError('forum.message_required',400)
        key = hashlib.sha256(json.dumps([self.session_manager.session_id,ref_id,request.operation_id]).encode()).hexdigest()
        receipt_path = settings.coordination_path/'forum-writes'/(key+'.json')
        fingerprint = hashlib.sha256(json.dumps([thread_id,request.model_dump(exclude={'operation_id'}),
            [(name,hashlib.sha256(content).hexdigest()) for name,content,_ in uploads]],sort_keys=True).encode()).hexdigest()
        receipt = None
        if receipt_path.exists():
            try:
                receipt = json.loads(receipt_path.read_text(encoding='utf8'))
                if not isinstance(receipt,dict) or receipt.get('fingerprint')!=fingerprint:
                    raise ValueError()
            except (ValueError,OSError) as exc: raise AuthoringError('forum.write_uncertain',409) from exc
        if receipt and receipt.get('result'): return ForumWriteResult(**receipt['result'])
        async with self.session_manager.get_http_client() as client:
            overview = await self._forum_overview(client,ref_id)
            overview = await self._forum_expand_overview(client,overview,thread_id)
            if not receipt:
                if thread_id:
                    thread = await self._forum_thread(client,overview,thread_id,request.page)
                    parent = request.edit_post_id or request.parent_id or (thread.data.posts[0].id if thread.data.posts else '')
                    url = (thread.edit_urls if request.edit_post_id else thread.reply_urls).get(parent)
                    if not url or (thread.data.closed and not request.edit_post_id): raise AuthoringError('forum.not_allowed',403)
                    before = [p.id for p in await self._forum_all_posts(client,overview,thread_id)]
                else:
                    if request.parent_id or request.edit_post_id: raise AuthoringError('forum.not_allowed',400)
                    url = overview.create_url
                    before = [item.id for item in overview.data.threads]
                if not url: raise AuthoringError('forum.not_allowed',403)
                response = await self._authoring_get(client,url)
                form = parse_forum_form(response.text,ref_id,thread_id,editing=bool(request.edit_post_id))
                if request.edit_post_id and query(form.action).get('pos_pk')!=request.edit_post_id:
                    raise AuthoringError('forum.not_allowed',403)
                values = {**form.values,'subject':request.subject,'message':request.message}
                values.pop('notify',None)
                if request.notify: values['notify']='1'
                if uploads and not form.file_fields: raise AuthoringError('forum.attachments_unavailable',400)
                receipt = {'fingerprint':fingerprint,'before':before,'state':'dispatched','thread_id':thread_id}
                atomic_json(receipt_path,receipt)
                try:
                    if uploads:
                        files = [(form.file_fields[0].replace('[0]',f'[{i}]'),(name,content,mime)) for i,(name,content,mime) in enumerate(uploads)]
                        response = await client.post(form.action,data=values,files=files,follow_redirects=False)
                        self._check_response_for_session_loss(response,form.action)
                    elif form.file_fields:
                        body,content_type = encode_assignment_form(values,form.file_fields)
                        response = await client.post(form.action,content=body,headers={'Content-Type':content_type},follow_redirects=False)
                        self._check_response_for_session_loss(response,form.action)
                    else:
                        response = await self._post_management(client,form.action,list(values.items()),ref_id)
                    if response.status_code>=400 or response.status_code in (307,308):
                        raise AuthoringError('forum.write_uncertain',409)
                    # A fresh form with a native validation error is a definite rejection.
                    soup = BeautifulSoup(response.text,'lxml')
                    invalid_form=next((form for form in soup.select('form') if form.select_one('textarea[name="message"]') and form.select_one('.ilFormFailure, .has-error')),None)
                    if invalid_form:
                        receipt['state']='rejected'; atomic_json(receipt_path,receipt)
                        raise AuthoringError('forum.form_rejected',400)
                except httpx.HTTPError as exc: raise AuthoringError('forum.write_uncertain',409) from exc
            elif receipt.get('state')=='rejected':
                raise AuthoringError('forum.form_rejected',400)
            # Reconciliation is read-only. Never repeat a dispatched native POST.
            for delay in (0, .15, .35):
                if delay: await asyncio.sleep(delay)
                overview = await self._forum_overview(client,ref_id)
                overview = await self._forum_expand_overview(client,overview,thread_id)
                candidate_id = thread_id
                if not candidate_id:
                    candidates = [item for item in overview.data.threads if item.id not in receipt['before'] and item.title.strip()==request.subject.strip()]
                    if len(candidates)>1: raise AuthoringError('forum.write_uncertain',409)
                    if not candidates: continue
                    candidate_id = candidates[0].id
                posts = await self._forum_all_posts(client,overview,candidate_id)
                matches = [p for p in posts if p.subject.strip()==request.subject.strip() and text(p.html)==text(request.message)
                           and (p.id==request.edit_post_id if request.edit_post_id else p.id not in (receipt['before'] if receipt.get('thread_id') else []))]
                if len(matches)>1: raise AuthoringError('forum.write_uncertain',409)
                if not matches: continue
                result = ForumWriteResult(thread_id=candidate_id,post_id=matches[0].id)
                atomic_json(receipt_path,{**receipt,'state':'confirmed','result':result.model_dump()})
                return result
            raise AuthoringError('forum.write_uncertain',409)

    @coordinated(lambda self, ref_id, *args, **kwargs: 'forum-write:' + ref_id)
    @audit('forum_thread_moderate')
    async def moderate_forum_thread(self,ref_id,thread_id,action):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            overview = await self._forum_overview(client,ref_id)
            overview = await self._forum_expand_overview(client,overview,thread_id)
            commands = overview.actions.get(thread_id,{})
            command = 'confirmdeletethreads' if action=='delete' else action
            url = commands.get(command)
            if not url: raise AuthoringError('forum.not_allowed',403)
            response = await self._authoring_get(client,url)
            if action=='delete':
                soup = BeautifulSoup(response.text,'lxml')
                form = next((f for f in soup.select('form[action]') if query(f['action']).get('fallbackcmd','').lower()=='performdeletethreads'),None)
                if not form: raise AuthoringError('forum.write_uncertain',409)
                ids = [i.get('value') for i in form.select('input[name="thread_ids[]"]')]
                if ids != [thread_id]: raise AuthoringError('forum.not_allowed',403)
                values = [(i['name'],i.get('value','')) for i in form.select('input[type=hidden][name]')]
                values.append(('cmd[performDeleteThreads]','Confirm'))
                await self._post_management(client,native_url(form['action'],ref_id),values,ref_id)
            verified = await self._forum_overview(client,ref_id)
            verified = await self._forum_expand_overview(client,verified,thread_id)
            item = next((item for item in verified.data.threads if item.id==thread_id),None)
            success = (item is None if action=='delete' else item is not None and
                (item.closed if action=='close' else not item.closed if action=='reopen' else item.sticky if action=='makesticky' else not item.sticky))
            if not success: raise AuthoringError('forum.write_uncertain',409)
            return verified.data
