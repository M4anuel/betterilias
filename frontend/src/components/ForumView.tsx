import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Lock, MessageSquare, Paperclip, Pencil, Pin, Plus, RefreshCw, Send, X } from 'lucide-react';
import { forumApi, forumDate, forumMarkup, forumOperationId, type ForumAction, type ForumConversation, type ForumOverview, type ForumPost, type ForumWrite } from '../lib/forum';
import { t, useLanguage } from '../lib/i18n';
import { cache } from '../lib/cache';
import { navigationGuard, useNavigationGuard } from '../lib/navigationGuard';
import { useConnectionRetry } from '../lib/connection';
import { confirmDialog } from '../lib/dialog';
import { ErrorNotice } from './ErrorNotice';
import { InstructionEditor } from './InstructionEditor';
import { ForumPageEditor } from './ForumPageEditor';

const button = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
type Draft = { thread: string | null; payload: ForumWrite; files: File[]; baseline: string };
const snapshot = (payload: ForumWrite) => JSON.stringify([payload.subject, payload.message, payload.notify]);

export function ForumView({ refId, title, courseTitle, onBack }: { refId: string; title: string; courseTitle: string; onBack: () => void }) {
  useLanguage();
  const [overview, setOverview] = useState<ForumOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ForumConversation | null>(null);
  const [search, setSearch] = useState('');
  const [editPage, setEditPage] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const [postPage, setPostPage] = useState(0);
  const owner = useRef(0);
  const read = useRef(0);
  const draftRequest = useRef(0);
  const paneTitle = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const dirty = !!draft && (snapshot(draft.payload) !== draft.baseline || draft.files.length > 0 || uncertain);
  useNavigationGuard({ isDirty: dirty, isPending: busy, onDiscard: () => { setDraft(null); setUncertain(false); } });
  const loadOverview = useCallback(async (page = 0) => {
    const sequence = owner.current;
    const data = await forumApi.overview(refId, page);
    if (sequence === owner.current) setOverview(data);
    return data;
  }, [refId]);
  const loadThread = useCallback(async (id: string, page = 0) => {
    const sequence = ++read.current; setLoading(true);
    try {
      const data = await forumApi.thread(refId, id, page);
      if (sequence === read.current) { setConversation(data); setPostPage(page); }
    } catch (e) { if (sequence === read.current) throw e; }
    finally { if (sequence === read.current) setLoading(false); }
  }, [refId]);
  useEffect(() => {
    ++owner.current; const sequence = owner.current;
    void loadOverview().catch(e => { if (sequence === owner.current) setError(e.message); });
    return () => { ++owner.current; ++read.current; ++draftRequest.current; };
  }, [loadOverview]);
  const refresh = async () => {
    setError('');
    try { await loadOverview(overview?.page || 0); if (selected) await loadThread(selected, postPage); }
    catch (e: any) { setError(e.message || t('forum.load_failed')); }
  };
  useConnectionRetry(() => { void refresh(); });
  const choose = async (id: string | null, trigger?: HTMLButtonElement) => {
    if (busy || !await navigationGuard.confirmNavigation()) return;
    ++draftRequest.current;
    setDraft(null); setUncertain(false); setError(''); setNotice(''); setEditPage(false);
    setSelected(id); setConversation(null);
    if (trigger) selectedButton.current = trigger;
    if (id) {
      paneTitle.current?.focus();
      try { await loadThread(id); requestAnimationFrame(() => paneTitle.current?.focus()); }
      catch (e: any) { setError(e.message || t('forum.load_failed')); }
    } else requestAnimationFrame(() => selectedButton.current?.focus());
  };
  const begin = async (post?: ForumPost, editing = false) => {
    if (busy || !await navigationGuard.confirmNavigation()) return;
    const attempt = ++draftRequest.current;
    setError(''); setNotice(''); setUncertain(false); setEditPage(false);
    try {
      const values = editing && selected && post ? await forumApi.edit(refId, selected, post.id, postPage) : null;
      if (attempt !== draftRequest.current) return;
      const payload: ForumWrite = { operation_id: forumOperationId(), subject: values?.subject || (post ? conversation?.title : '') || '',
        message: values?.message || '', notify: false, page: postPage, ...(post ? editing ? { edit_post_id: post.id } : { parent_id: post.id } : {}) };
      setDraft({ thread: post ? selected : null, payload, files: [], baseline: snapshot(payload) });
      requestAnimationFrame(() => { composer.current?.scrollIntoView({ block: 'nearest' }); composer.current?.querySelector<HTMLElement>('input')?.focus(); });
    } catch (e: any) { setError(e.message || t('forum.load_failed')); }
  };
  const patch = (values: Partial<ForumWrite>) => setDraft(current => current ? { ...current, payload: { ...current.payload, ...values } } : current);
  const submit = async () => {
    if (!draft || busy) return;
    const submitted = draft; const scope = cache.getRequestScope().key;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await forumApi.write(refId, submitted.thread, submitted.payload, submitted.files);
      if (scope !== cache.getRequestScope().key) return;
      setDraft(null); setUncertain(false); setSelected(result.thread_id); setNotice(t('forum.saved'));
      try { await loadOverview(); await loadThread(result.thread_id); }
      catch { setError(t('forum.saved_refresh_failed')); }
    } catch (e: any) {
      if (scope !== cache.getRequestScope().key) return;
      const unknown = e.status === undefined || e.status >= 500 || e.status === 409;
      setUncertain(unknown);
      setError(unknown ? t('forum.write_uncertain') : e.message);
      if (!unknown) setDraft(current => current ? { ...current, payload: { ...current.payload, operation_id: forumOperationId() } } : current);
    } finally { setBusy(false); }
  };
  const moderate = async (action: ForumAction) => {
    if (!selected || busy || !await navigationGuard.confirmNavigation()) return;
    if (!await confirmDialog({ title: t(`forum.action.${action}`), message: t(action === 'delete' ? 'forum.delete_confirm' : 'forum.moderate_confirm'), variant: action === 'delete' ? 'danger' : 'warning' })) return;
    setBusy(true); setError('');
    try {
      const data = await forumApi.moderate(refId, selected, action); setOverview(data); setNotice(t('forum.saved'));
      if (action === 'delete') { setSelected(null); setConversation(null); }
      else await loadThread(selected);
    } catch (e: any) { setError(e.message || t('forum.write_uncertain')); }
    finally { setBusy(false); }
  };
  const selectedThread = overview?.threads.find(thread => thread.id === selected);
  const filtered = overview?.threads.filter(thread => `${thread.title} ${thread.author}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || [];
  const showConversation = !!selected || !!draft;
  const ordered = [...filtered].sort((a,b) => Number(b.sticky) - Number(a.sticky));

  return <section className="forum-view mx-auto w-full max-w-[1600px] p-3 sm:p-5" aria-label={t('forum.title')}>
    <header className="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy} onClick={async () => { if (await navigationGuard.confirmNavigation()) onBack(); }} aria-label={t('forum.back_course')}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{courseTitle}</span></button>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-teal-700 dark:text-teal-300">{t('forum.title')}</p><h1 className="break-words text-xl font-bold text-slate-900 dark:text-white">{overview?.title || title}</h1></div>
      <button type="button" className={button} disabled={busy || loading} onClick={() => void refresh()} aria-label={t('forum.refresh')}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button>
    </header>
    {overview?.can_edit_page && <nav aria-label={t('forum.views')} className="mb-4 flex gap-2">
      <button type="button" className={button} aria-pressed={!editPage} onClick={async () => { if (await navigationGuard.confirmNavigation()) { setDraft(null); setEditPage(false); } }}>{t('forum.conversations')}</button>
      <button type="button" className={button} aria-pressed={editPage} onClick={async () => { if (await navigationGuard.confirmNavigation()) { setDraft(null); setEditPage(true); } }}><Pencil className="h-4 w-4" />{t('forum.edit_page')}</button>
    </nav>}
    {error && <div className="mb-4"><ErrorNotice message={error} onRetry={uncertain ? () => void submit() : () => void refresh()} retryDisabled={busy} onDismiss={() => setError('')} /></div>}
    {notice && <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-teal-50 p-3 text-sm text-teal-900 dark:bg-teal-950/40 dark:text-teal-200"><Check className="h-4 w-4" />{notice}</p>}
    {!editPage && overview?.intro_html && <div className="forum-prose ilias-rich-content mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900" dangerouslySetInnerHTML={{ __html: forumMarkup(overview.intro_html) }} />}
    {editPage ? <ForumPageEditor refId={refId} onSaved={() => { void loadOverview().catch(() => setError(t('forum.saved_refresh_failed'))); }} /> : <div className="forum-workspace grid min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
      <aside className={`${showConversation ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col border-slate-200 dark:border-slate-700 md:border-r`} aria-label={t('forum.threads')}>
        <div className="space-y-3 border-b border-slate-200 p-3 dark:border-slate-700">
          {overview?.can_create && <button type="button" className={`${button} w-full`} disabled={busy} onClick={() => void begin()}><Plus className="h-4 w-4" />{t('forum.new_thread')}</button>}
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{t('forum.search')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 text-base text-slate-900 dark:border-slate-600 dark:text-white" /></label>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {ordered.map(thread => <li key={thread.id}><button type="button" disabled={busy} onClick={e => void choose(thread.id, e.currentTarget)} aria-current={selected === thread.id ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-teal-500 ${selected === thread.id ? 'border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/50' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            <span className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{thread.title}</span>{thread.sticky && <Pin aria-label={t('forum.pinned')} className="h-4 w-4 shrink-0 text-teal-600" />}{thread.closed && <Lock aria-label={t('forum.closed')} className="h-4 w-4 shrink-0 text-slate-500" />}</span>
            <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{thread.author}</span>
            <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400"><span>{t('forum.post_count', { count: thread.post_count })}</span><span>{forumDate(thread.last_post)}</span>{thread.unread && <span className="font-semibold text-teal-700 dark:text-teal-300">{t('forum.unread')}</span>}</span>
          </button></li>)}
          {!overview && <li role="status" className="p-4 text-sm text-slate-500">{t('forum.loading')}</li>}
          {overview && !ordered.length && <li className="p-4 text-sm text-slate-500 dark:text-slate-400">{t(search ? 'forum.no_results' : 'forum.no_threads')}</li>}
        </ul>
        {overview && (overview.has_more || overview.page > 0) && <div className="flex gap-2 p-3"><button className={button} disabled={!overview.page || busy} onClick={() => void loadOverview(overview.page - 1).catch(e => setError(e.message))}>{t('forum.previous')}</button><button className={button} disabled={!overview.has_more || busy} onClick={() => void loadOverview(overview.page + 1).catch(e => setError(e.message))}>{t('forum.next')}</button></div>}
      </aside>
      <div className={`${showConversation ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-b border-slate-200 p-3 dark:border-slate-700 md:flex">
          <button type="button" className={`${button} phone-only forum-thread-back`} disabled={busy} onClick={() => void choose(null)} aria-label={t('forum.back_threads')}><ArrowLeft className="h-4 w-4" /></button>
          <h2 ref={paneTitle} tabIndex={-1} className="col-start-2 row-start-1 min-w-0 flex-1 break-words py-2 text-base font-bold text-slate-900 outline-none dark:text-slate-100">{draft?.thread === null ? t('forum.new_thread') : conversation?.title || selectedThread?.title || t('forum.select_thread')}</h2>
          {selectedThread && selectedThread.actions.length > 0 && <details className="relative col-span-2 justify-self-end"><summary className={`${button} cursor-pointer`}>{t('forum.actions')}</summary><div className="absolute right-0 z-10 mt-1 min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">{selectedThread.actions.map(action => <button key={action} type="button" className={`${button} w-full border-0 justify-start`} disabled={busy} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); void moderate(action); }}>{t(`forum.action.${action}`)}</button>)}</div></details>}
        </div>
        <div className="forum-conversation min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5" aria-busy={loading}>
          {!showConversation && <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400"><MessageSquare className="h-10 w-10 text-teal-600" /><p>{t('forum.select_thread')}</p></div>}
          {loading && <p role="status" className="mb-3 text-sm text-slate-500">{t('forum.loading')}</p>}
          {conversation?.closed && <p className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Lock className="h-4 w-4 shrink-0" />{t('forum.closed_hint')}</p>}
          {draft?.thread !== null && <div className="space-y-5">{conversation?.posts.map(post => <article key={post.id} id={`forum-post-${post.id}`} className="flex min-w-0 gap-2 sm:gap-3" aria-label={t('forum.post_by', { name: post.author })}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200" aria-hidden="true">{post.avatar_url ? <img src={post.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement?.append(post.author.slice(0,2).toUpperCase()); }} /> : post.author.slice(0,2).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><header className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="break-words text-sm font-bold text-slate-900 dark:text-slate-100">{post.author}</h3><span className="text-xs text-slate-500 dark:text-slate-400">{forumDate(post.date)}</span>{post.depth > 1 && <span className="text-xs text-teal-700 dark:text-teal-300">{t('forum.reply')}</span>}</header>
              <div className="forum-prose ilias-rich-content w-full max-w-[72ch] min-w-0 rounded-2xl rounded-tl-sm bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-800/70 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: forumMarkup(post.html) }} />
              {Boolean(post.attachments?.length) && <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('forum.attachments')}>{post.attachments?.map(file => <li key={file.url}><a className={`${button} max-w-full text-xs`} href={file.url} download><Paperclip className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{file.title}</span></a></li>)}</ul>}
              {post.edited && <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">{t('forum.edited')} {forumDate(post.edited)}</p>}
              <div className="mt-1 flex flex-wrap gap-1">{post.can_reply && !conversation.closed && <button type="button" className={`${button} border-0 bg-transparent text-xs`} disabled={busy} onClick={() => void begin(post)}>{t('forum.reply')}</button>}{post.can_edit && <button type="button" className={`${button} border-0 bg-transparent text-xs`} disabled={busy} onClick={() => void begin(post, true)}><Pencil className="h-3 w-3" />{t('forum.edit_post')}</button>}</div>
            </div>
          </article>)}</div>}
          {conversation && (conversation.has_more || conversation.page > 0) && <div className="my-4 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || loading || postPage === 0} onClick={() => void loadThread(conversation.thread_id, postPage - 1).catch(e => setError(e.message))}>{t('forum.previous')}</button><button type="button" className={button} disabled={busy || loading || !conversation.has_more} onClick={() => void loadThread(conversation.thread_id, postPage + 1).catch(e => setError(e.message))}>{t('forum.next')}</button></div>}
          {draft && <div ref={composer} className="mt-5 rounded-2xl border border-teal-300 p-3 dark:border-teal-800">
            <div className="mb-3 flex items-center gap-2"><h3 className="flex-1 text-sm font-bold text-slate-900 dark:text-slate-100">{t(draft.thread === null ? 'forum.new_thread' : draft.payload.edit_post_id ? 'forum.edit_post' : 'forum.reply')}</h3><button type="button" className={button} disabled={busy} aria-label={t('forum.cancel_draft')} onClick={async () => { if (await navigationGuard.confirmNavigation()) { setDraft(null); setUncertain(false); } }}><X className="h-4 w-4" /></button></div>
            <fieldset disabled={busy || uncertain} className="min-w-0 space-y-3 disabled:opacity-70"><label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{t('forum.subject')}<input maxLength={255} value={draft.payload.subject} onChange={e => patch({ subject: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 text-base text-slate-900 dark:border-slate-600 dark:text-white" /></label>
              <InstructionEditor value={draft.payload.message} onChange={message => patch({ message })} label={t('forum.message')} sanitize={forumMarkup} disabled={busy || uncertain} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={draft.payload.notify} onChange={e => patch({ notify: e.target.checked })} className="h-5 w-5" />{t('forum.notify')}</label>
              {!draft.payload.edit_post_id && <label className={`${button} w-fit cursor-pointer`}><Paperclip className="h-4 w-4" />{t('forum.attach_files')}<input type="file" multiple className="sr-only" onChange={e => {
                const files=Array.from(e.currentTarget.files || []);
                setDraft(current => current ? { ...current, files: [...current.files, ...files] } : current);
                e.currentTarget.value='';
              }} /></label>}
              <ul className="space-y-1">{draft.files.map((file,index) => <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span className="min-w-0 flex-1 break-words">{file.name}</span><button type="button" className={button} aria-label={t('forum.remove_file', { name: file.name })} onClick={() => setDraft(current => current ? { ...current, files: current.files.filter((_,i) => i !== index) } : current)}><X className="h-4 w-4" /></button></li>)}</ul>
            </fieldset>
            <div className="mt-3 flex justify-end"><button type="button" className={`${button} border-teal-600 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-700 dark:text-white`} disabled={busy || !draft.payload.subject.trim() || !draft.payload.message.replace(/<[^>]*>/g, '').trim()} onClick={() => void submit()}><Send className="h-4 w-4" />{t(busy ? 'forum.sending' : uncertain ? 'forum.check_result' : draft.payload.edit_post_id ? 'forum.save_post' : 'forum.send')}</button></div>
          </div>}
        </div>
      </div>
    </div>}
  </section>;
}
