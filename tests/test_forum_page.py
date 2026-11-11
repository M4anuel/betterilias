"""COPage protocol regressions: operate on one native paragraph, preserve other PCs."""
import json
from urllib.parse import parse_qs

import httpx
import pytest

from backend.forum_models import ForumPageWrite
from backend.services.authoring import AuthoringError
from backend.services.forum_page import parse_forum_page_shell, paragraph_markup
from tests.test_forum import Scenario, url, private_receipts


class PageScenario(Scenario):
    def __init__(self,lost=False):
        super().__init__(lost)
        self.models={'text-one':{'text':'Original text','characteristic':'Standard'},'image-one':{'resource':'preserve-this-image'}}
        self.order=['text-one','image-one'];self.page_posts=[]
        self.error_after_write=False

    def shell(self):
        endpoint=url('invokeServer').replace('ilObjForumGUI','ilPageEditorServerAdapterGUI')
        return '<span id="il-copg-init" data-endpoint="'+endpoint+'"></span>'+''.join(
            f'<div data-copg-ed-type="pc-area" data-pcid="{pid}" data-cname="{"Paragraph" if "text" in self.models[pid] else "MediaObject"}">Preview</div>' for pid in self.order)

    def handle(self,request):
        params={k.lower():v[-1] for k,v in parse_qs(request.url.query.decode()).items()}
        if params.get('cmdclass','').lower()=='ilforumpagegui': return httpx.Response(200,text=self.shell(),request=request)
        if params.get('cmdclass','').lower()=='ilpageeditorserveradaptergui':
            if request.method=='GET': return httpx.Response(200,json={'pcModel':self.models},request=request)
            body=json.loads(request.content);self.page_posts.append(body)
            assert body['component']=='Paragraph';data=body['data'];pid=data['pcid']
            if body['action']=='delete': self.models.pop(pid,None);self.order.remove(pid)
            else:
                self.models[pid]={'text':data['content'],'characteristic':data['characteristic']}
                if body['action']=='insert':
                    after=data['after_pcid'];idx=self.order.index(after)+1 if after!='pg' else 0;self.order.insert(idx,pid)
            if self.lost: self.lost=False;raise httpx.ReadTimeout('Page response lost',request=request)
            if self.error_after_write:
                self.error_after_write=False
                return httpx.Response(200,json={'error':'Response rendering failed after saving'},request=request)
            return httpx.Response(200,json={'error':None,'renderedContent':'Native output'},request=request)
        return super().handle(request)


@pytest.mark.asyncio
@pytest.mark.parametrize('action',['insert','update','delete'])
@pytest.mark.parametrize('lost',[False,True])
async def test_native_text_block_writes_preserve_other_components_and_do_not_repeat(action,lost):
    scenario=PageScenario(lost)
    page=await scenario.client.get_forum_page('42')
    assert len(page.blocks)==1 and page.other_components==1 and len(page.elements)==2
    request=ForumPageWrite(operation_id='native-page-operation-123',revision=page.revision,action=action,
        block_id='text-one' if action!='insert' else None,after_id='image-one',content='<p>New <strong>text</strong></p>' if action!='delete' else '')
    if lost:
        with pytest.raises(AuthoringError):await scenario.client.write_forum_page('42',request)
    result=await scenario.client.write_forum_page('42',request)
    assert scenario.models['image-one']=={'resource':'preserve-this-image'} and len(scenario.page_posts)==1
    assert len(result.blocks)==(0 if action=='delete' else 2 if action=='insert' else 1)
    await scenario.client.write_forum_page('42',request)
    assert len(scenario.page_posts)==1


@pytest.mark.asyncio
async def test_page_revision_rejects_overwriting_concurrent_native_edits_before_post():
    scenario=PageScenario();page=await scenario.client.get_forum_page('42')
    scenario.models['text-one']['text']='Concurrent native edit'
    request=ForumPageWrite(operation_id='concurrent-page-operation-123',revision=page.revision,action='update',block_id='text-one',content='My draft')
    with pytest.raises(AuthoringError) as exc:await scenario.client.write_forum_page('42',request)
    assert exc.value.status_code==412 and not scenario.page_posts


@pytest.mark.asyncio
async def test_page_api_cannot_modify_non_text_component():
    scenario=PageScenario();page=await scenario.client.get_forum_page('42')
    request=ForumPageWrite(operation_id='non-text-page-operation-123',revision=page.revision,action='delete',block_id='image-one')
    with pytest.raises(AuthoringError) as exc:await scenario.client.write_forum_page('42',request)
    assert exc.value.status_code==403 and not scenario.page_posts


@pytest.mark.asyncio
async def test_empty_page_can_receive_its_first_text_block():
    scenario=PageScenario();scenario.models={};scenario.order=[]
    page=await scenario.client.get_forum_page('42')
    request=ForumPageWrite(operation_id='empty-page-operation-123',revision=page.revision,action='insert',content='<p>First paragraph</p>')
    result=await scenario.client.write_forum_page('42',request)
    assert len(result.blocks)==1 and scenario.page_posts[0]['data']['after_pcid']=='pg'


def test_paragraph_protocol_uses_native_inline_formatting_and_removes_active_html():
    value=paragraph_markup('<p>Hello <strong>bold</strong></p><p>Next <em>emphasis</em></p><script>bad()</script>')
    assert '<p>' not in value and '<script>' not in value
    assert 'ilc_text_inline_Strong' in value and 'ilc_text_inline_Emph' in value and '<br' in value


@pytest.mark.asyncio
async def test_page_adapter_error_after_insert_is_reconciled_without_replaying():
    scenario=PageScenario();scenario.error_after_write=True
    page=await scenario.client.get_forum_page('42')
    request=ForumPageWrite(operation_id='adapter-error-operation-123',revision=page.revision,action='insert',content='Saved before error')
    with pytest.raises(AuthoringError) as exc:await scenario.client.write_forum_page('42',request)
    assert exc.value.status_code==409
    result=await scenario.client.write_forum_page('42',request)
    assert len(result.blocks)==2 and len(scenario.page_posts)==1
