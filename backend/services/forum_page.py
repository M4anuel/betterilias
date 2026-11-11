"""Native paragraph editing through the discovered COPage server adapter.

Only individual Paragraph commands are sent; tables/media/other page components
are never replaced. See the release_9 COPage client and Paragraph action handler.
"""
import hashlib
import json
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from bs4 import BeautifulSoup
import httpx

from backend.config import settings
from backend.coordination import atomic_json, coordinated
from backend.observability import audit
from backend.forum_models import ForumPage, ForumTextBlock, ForumPageElement
from backend.scrapers.authoring import native_url
from backend.scrapers.dumper import safe_parser
from backend.scrapers.forum import clean_markup, query
from backend.services.authoring import AuthoringError


@dataclass
class PageShell:
    endpoint: str
    areas: list[dict]
    top_level_ids: list[str]
    previews: dict[str,str]


@safe_parser('forum_page_editor')
def parse_forum_page_shell(html,ref_id):
    soup=BeautifulSoup(html,'lxml');init=soup.select_one('#il-copg-init[data-endpoint]')
    if not init: raise AuthoringError('forum.page_unsupported',409)
    endpoint=native_url(init['data-endpoint'],ref_id)
    params=query(endpoint)
    if params.get('cmdclass','').lower()!='ilpageeditorserveradaptergui' or params.get('cmd','').lower()!='invokeserver':
        raise AuthoringError('forum.page_unsupported',409)
    areas=[];top=[];previews={}
    for area in soup.select('[data-copg-ed-type="pc-area"][data-pcid]'):
        pid=area['data-pcid']
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',pid): raise AuthoringError('forum.page_unsupported',409)
        areas.append({'id':pid,'kind':area.get('data-cname','')})
        if not area.select_one('[data-copg-ed-type="pc-area"]'):
            previews[pid]=clean_markup(str(area),ref_id)
        if not area.find_parent(attrs={'data-copg-ed-type':'pc-area'}): top.append(pid)
    return PageShell(endpoint,areas,top,previews)


@safe_parser('forum_paragraph_markup')
def paragraph_markup(html):
    """The native paragraph editor sends inline HTML with line breaks, not P wrappers."""
    soup=BeautifulSoup(html,'lxml')
    for node in soup.select('script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,template'):
        node.decompose()
    for node in list(soup.body.find_all(True)):
        if node.name in ('strong','b','em','i','u'):
            characteristic={'strong':'Strong','b':'Strong','em':'Emph','i':'Emph','u':'Important'}[node.name]
            node.name='span';node.attrs={'class':'ilc_text_inline_'+characteristic}
        elif node.name in ('p','div'):
            node.append(soup.new_tag('br'));node.unwrap()
        elif node.name not in ('span','br','a','ul','ol','li','sup','sub','code'):
            node.unwrap()
        else:
            attributes=dict(node.attrs);node.attrs={}
            if node.name=='span':
                classes=attributes.get('class',[])
                safe=[value for value in classes if re.fullmatch(r'ilc_text_inline_[A-Za-z0-9_]+',value)]
                if safe: node['class']=safe
            if node.name=='a' and urlparse(attributes.get('href','')).scheme in ('https','http','mailto'):
                node['href']=attributes['href']
    result=soup.body.decode_contents().strip()
    return re.sub(r'(?:<br\s*/?>\s*)+$','',result)


def signature(value): return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()


class ForumPageMixin:
    async def _forum_page(self,client,ref_id):
        overview=await self._forum_overview(client,ref_id)
        if not overview.data.can_edit_page or not overview.data.editor_url: raise AuthoringError('forum.not_allowed',403)
        response=await self._authoring_get(client,overview.data.editor_url)
        shell=parse_forum_page_shell(response.text,ref_id)
        parts=urlparse(shell.endpoint)
        params=dict(parse_qsl(parts.query));params.update(component='Page',action='ui.all',action_id='betterilias-page-read')
        response=await self._authoring_get(client,urlunparse(parts._replace(query=urlencode(params))))
        try: data=response.json();models=data['pcModel']
        except (ValueError,KeyError,TypeError) as exc: raise AuthoringError('forum.page_unsupported',409) from exc
        if models==[]: models={}
        if not isinstance(models,dict) or data.get('error'): raise AuthoringError('forum.page_unsupported',409)
        blocks=[]
        for area in shell.areas:
            model=models.get(area['id'],{})
            if area['kind']=='Paragraph' and isinstance(model,dict) and isinstance(model.get('text'),str):
                blocks.append(ForumTextBlock(id=area['id'],content=model['text'],characteristic=model.get('characteristic','Standard')))
        revision=signature([models,shell.areas,shell.top_level_ids])
        editable={block.id:block for block in blocks}
        elements=[ForumPageElement(id=area['id'],text_block=editable.get(area['id']),preview_html=shell.previews.get(area['id'],''))
                  for area in shell.areas if area['id'] in editable or area['id'] in shell.previews]
        page=ForumPage(ref_id=ref_id,revision=revision,blocks=blocks,elements=elements,
            append_after_id=shell.top_level_ids[-1] if shell.top_level_ids else 'pg',preview_html=overview.data.intro_html,
            other_components=sum(area['kind']!='Paragraph' for area in shell.areas))
        return page,shell,models

    async def get_forum_page(self,ref_id):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            page,_,_=await self._forum_page(client,ref_id)
            return page

    @coordinated(lambda self,ref_id,*args,**kwargs:'forum-write:'+ref_id)
    @audit('forum_page_save')
    async def write_forum_page(self,ref_id,request):
        self._ensure_authenticated()
        key=signature([self.session_manager.session_id,ref_id,request.operation_id])
        path=settings.coordination_path/'forum-page-writes'/(key+'.json')
        fingerprint=signature(request.model_dump(exclude={'operation_id'}))
        receipt=None
        if path.exists():
            try:
                receipt=json.loads(path.read_text(encoding='utf8'))
                if not isinstance(receipt,dict) or receipt.get('fingerprint')!=fingerprint: raise ValueError()
            except (ValueError,OSError) as exc: raise AuthoringError('forum.write_uncertain',409) from exc
        async with self.session_manager.get_http_client() as client:
            page,shell,models=await self._forum_page(client,ref_id)
            if receipt and receipt.get('state')=='confirmed': return page
            if receipt and receipt.get('state')=='rejected': raise AuthoringError('forum.form_rejected',400)
            block_id=request.block_id if request.action!='insert' else key[:20]
            content=paragraph_markup(request.content) if request.content.strip() else ''
            if request.action!='delete' and not content: raise AuthoringError('forum.message_required',400)
            current=next((block for block in page.blocks if block.id==block_id),None)
            if not receipt:
                if request.revision!=page.revision: raise AuthoringError('forum.page_changed',412)
                if request.action=='insert':
                    if not content or block_id in models or request.after_id not in ['pg',*shell.top_level_ids]:
                        raise AuthoringError('forum.page_changed',412)
                    action_data={'pcid':block_id,'after_pcid':request.after_id,'content':content,'characteristic':'Standard','fromPlaceholder':False}
                else:
                    if current is None: raise AuthoringError('forum.not_allowed',403)
                    if request.action=='update' and not content: raise AuthoringError('forum.message_required',400)
                    action_data={'pcid':block_id,'content':content,'characteristic':current.characteristic}
                receipt={'fingerprint':fingerprint,'block_id':block_id,'state':'dispatched'}
                atomic_json(path,receipt)
                try:
                    response=await client.post(shell.endpoint,json={'action_id':request.operation_id,'component':'Paragraph','action':request.action,'data':action_data},follow_redirects=False)
                    self._check_response_for_session_loss(response,shell.endpoint)
                    if response.status_code!=200: raise AuthoringError('forum.write_uncertain',409)
                    data=response.json()
                    if data.get('error'):
                        # The adapter can report an exception after persisting a
                        # component. Keep the dispatch receipt and inspect it.
                        raise AuthoringError('forum.write_uncertain',409)
                except (httpx.HTTPError,ValueError) as exc: raise AuthoringError('forum.write_uncertain',409) from exc
                page,_,_=await self._forum_page(client,ref_id)
                current=next((block for block in page.blocks if block.id==block_id),None)
            confirmed=(current is None if request.action=='delete' else current is not None and paragraph_markup(current.content)==content)
            if not confirmed: raise AuthoringError('forum.write_uncertain',409)
            atomic_json(path,{**receipt,'state':'confirmed'})
            return page
