import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { forumApi, forumMarkup, forumOperationId, type ForumPage, type ForumPageWrite, type ForumTextBlock } from '../lib/forum';
import { t, useLanguage } from '../lib/i18n';
import { useNavigationGuard, navigationGuard } from '../lib/navigationGuard';
import { confirmDialog } from '../lib/dialog';
import { ErrorNotice } from './ErrorNotice';
import { InstructionEditor } from './InstructionEditor';

const button='inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200';
type Draft={ id: string | null; content: string; baseline: string };

export function ForumPageEditor({ refId, onSaved }: { refId: string; onSaved: () => void }) {
  useLanguage();
  const [page,setPage]=useState<ForumPage | null>(null);
  const [draft,setDraft]=useState<Draft | null>(null);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const pending=useRef<ForumPageWrite | null>(null);
  const generation=useRef(0);
  const editor=useRef<HTMLDivElement>(null);
  const dirty=!!draft && (draft.content!==draft.baseline || uncertain);
  useNavigationGuard({ isDirty:dirty,isPending:busy,onDiscard:()=>{setDraft(null);setUncertain(false);pending.current=null;} });
  useEffect(()=>{
    const own=++generation.current;
    void forumApi.page(refId).then(data=>{if(own===generation.current)setPage(data);}).catch(e=>{if(own===generation.current)setError(e.message);});
    return ()=>{++generation.current;};
  },[refId]);
  async function reload() {
    setError('');
    try {
      const data=await forumApi.page(refId);setPage(data);
      setDraft(current=>current?.id&&!data.blocks.some(block=>block.id===current.id)?{...current,id:null,baseline:''}:current);
    }
    catch(e:any){setError(e.message||t('forum.load_failed'));}
  }
  async function begin(block?:ForumTextBlock) {
    if(busy || !await navigationGuard.confirmNavigation())return;
    pending.current=null;setUncertain(false);setSaved(false);setError('');
    setDraft({id:block?.id||null,content:block?.content||'',baseline:block?.content||''});
    requestAnimationFrame(()=>{editor.current?.scrollIntoView({block:'nearest'});editor.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus();});
  }
  async function save(request?:ForumPageWrite) {
    if(!page || busy || (!request && !draft && !pending.current))return;
    if(!request&&!pending.current&&draft?.id&&page.blocks.find(block=>block.id===draft.id)?.content!==draft.baseline) {
      if(!await confirmDialog({title:t('forum.page_changed_title'),message:t('forum.replace_changed_block'),variant:'warning'}))return;
    }
    const own=generation.current;
    const payload=request || pending.current || {operation_id:forumOperationId(),revision:page.revision,
      action:draft?.id?'update':'insert',block_id:draft?.id||undefined,after_id:page.append_after_id,content:draft?.content||''} as ForumPageWrite;
    pending.current=payload;setBusy(true);setError('');setSaved(false);
    try {
      const data=await forumApi.writePage(refId,payload);
      if(own!==generation.current)return;
      setPage(data);setDraft(null);setUncertain(false);pending.current=null;setSaved(true);onSaved();
    } catch(e:any) {
      if(own!==generation.current)return;
      const unknown=e.status===undefined || e.status>=500 || e.status===409;
      setUncertain(unknown);setError(unknown?t('forum.write_uncertain'):e.message);
      if(!unknown)pending.current=null;
    } finally {if(own===generation.current)setBusy(false);}
  }
  async function remove(block:ForumTextBlock) {
    if(!page || busy || !await navigationGuard.confirmNavigation())return;
    if(!await confirmDialog({title:t('forum.delete_block'),message:t('forum.delete_block_confirm'),variant:'danger'}))return;
    await save({operation_id:forumOperationId(),revision:page.revision,action:'delete',block_id:block.id});
  }
  const draftEditor=<div ref={editor} className="min-w-0 space-y-3 rounded-2xl border border-teal-400 p-3 dark:border-teal-700">
    <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 font-semibold text-slate-900 dark:text-slate-100">{t(draft?.id?'forum.edit_text':'forum.add_text')}</h3><button type="button" className={button} disabled={busy} aria-label={t('forum.cancel_draft')} onClick={async()=>{if(await navigationGuard.confirmNavigation()){setDraft(null);setUncertain(false);pending.current=null;}}}><X className="h-4 w-4" /></button></div>
    <fieldset disabled={busy||uncertain} className="min-w-0"><InstructionEditor value={draft?.content||''} onChange={content=>setDraft(current=>current?{...current,content}:current)} label={t('forum.text_block')} sanitize={forumMarkup} disabled={busy||uncertain} /></fieldset>
    <div className="flex justify-end"><button type="button" className={button} disabled={busy||!draft?.content.replace(/<[^>]*>/g,'').trim()} onClick={()=>void save()}><Save className="h-4 w-4" />{t(busy?'forum.sending':uncertain?'forum.check_result':'forum.save_block')}</button></div>
  </div>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="font-bold text-slate-900 dark:text-slate-100">{t('forum.custom_content')}</h2><p className="mt-1 max-w-[68ch] text-sm text-slate-600 dark:text-slate-300">{t('forum.native_edit_hint')}</p></div><button type="button" className={button} disabled={busy||uncertain} onClick={()=>void reload()} aria-label={t('forum.refresh')}><RefreshCw className="h-4 w-4" /></button></div>
    {error&&<ErrorNotice message={error} retryDisabled={busy} onRetry={uncertain?()=>void save():()=>void reload()} onDismiss={()=>setError('')} />}
    {saved&&<p role="status" className="flex items-center gap-2 text-sm text-teal-800 dark:text-teal-200"><Check className="h-4 w-4" />{t('forum.saved')}</p>}
    {!page&&!error&&<p role="status" className="text-sm text-slate-500">{t('forum.loading')}</p>}
    {page&&<>
      {page.elements.map(element=>element.text_block?<div key={element.id}>
        {draft?.id===element.id?draftEditor:<div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row">
          <div className="forum-prose ilias-rich-content min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-200" dangerouslySetInnerHTML={{__html:forumMarkup(element.text_block.content)}} />
          <div className="flex shrink-0 gap-2 self-end sm:self-start"><button type="button" className={button} disabled={busy||uncertain} onClick={()=>void begin(element.text_block!)} aria-label={t('forum.edit_text')}><Pencil className="h-4 w-4" /></button><button type="button" className={button} disabled={busy||uncertain} onClick={()=>void remove(element.text_block!)} aria-label={t('forum.delete_block')}><Trash2 className="h-4 w-4" /></button></div>
        </div>}
      </div>:<div key={element.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><div className="forum-prose ilias-rich-content" dangerouslySetInnerHTML={{__html:forumMarkup(element.preview_html)}} /><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('forum.other_component')}</p></div>)}
      {draft?.id===null&&draftEditor}
      {!draft&&<button type="button" className={button} disabled={busy||uncertain} onClick={()=>void begin()}><Plus className="h-4 w-4" />{t('forum.add_text')}</button>}
      {uncertain&&!draft&&<button type="button" className={button} disabled={busy} onClick={()=>void save()}>{t('forum.check_result')}</button>}
    </>}
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400" aria-label={t('forum.thread_placeholder')}><MessageSquare className="h-8 w-8" /><h2 className="font-semibold">{t('forum.thread_placeholder')}</h2><p className="max-w-[68ch] text-sm">{t('forum.thread_placeholder_hint')}</p></div>
  </div>;
}
