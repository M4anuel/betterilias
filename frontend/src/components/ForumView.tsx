import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Lock, MessageSquare, Paperclip, Pencil, Pin, Plus, Send, X } from 'lucide-react';
import { forumApi, forumDate, forumMarkup, forumOperationId, type ForumAction, type ForumConversation, type ForumOverview, type ForumPost, type ForumWrite } from '../lib/forum';
import { t, useLanguage } from '../lib/i18n';
import { cache } from '../lib/cache';
import { navigationGuard, useNavigationGuard } from '../lib/navigationGuard';
import { useConnectionRetry } from '../lib/connection';
import { confirmDialog } from '../lib/dialog';
import { ErrorNotice } from './ErrorNotice';
import { InstructionEditor } from './InstructionEditor';
import { ForumPageEditor } from './ForumPageEditor';
import { FileDropzone } from './FileDropzone';
import { CompactBreadcrumbs } from './CompactBreadcrumbs';
import { SyncRefreshControl } from './SyncRefreshControl';
import type { BreadcrumbItem } from '../types';
import { forumPlainText } from '../lib/forum';

const button = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
type Draft = { thread: string | null; payload: ForumWrite; files: File[]; baseline: string };
const snapshot = (payload: ForumWrite) => JSON.stringify([payload.subject, payload.message, payload.notify]);

interface ForumViewProps {
  refId: string; title: string; courseTitle: string; onBack: () => void;
  courseRefId?: string; breadcrumbs?: BreadcrumbItem[]; managementMode?: boolean;
  onManagementModeChange?: (value: boolean) => void; onNavigateHome?: () => void;
  onNavigateCourse?: (ref: string) => void; onNavigateFolder?: (ref: string) => void;
  onNavigateRepository?: (ref: string) => void; onNavigateSemester?: (semester: string) => void;
}
export function ForumView({ refId, title, courseTitle, onBack, courseRefId, breadcrumbs = [],
  managementMode, onManagementModeChange, onNavigateHome, onNavigateCourse, onNavigateFolder,
  onNavigateRepository, onNavigateSemester }: ForumViewProps) {
  useLanguage();
  const [overview, setOverview] = useState<ForumOverview | null>(() => cache.getCachedForum(refId, 'overview:0'));
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ForumConversation | null>(null);
  const [search, setSearch] = useState('');
  const [localEditing, setLocalEditing] = useState(false);
  const editPage = (managementMode ?? localEditing) && Boolean(overview?.can_edit_page || localEditing);
  const setEditPage = (value: boolean) => { setLocalEditing(value); onManagementModeChange?.(value); };
  const [syncCount, setSyncCount] = useState(0);
  const [pageSyncing, setPageSyncing] = useState(false);
  const [pageRefresh, setPageRefresh] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const root = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const [postPage, setPostPage] = useState(0);
  const owner = useRef(0);
  const overviewRead = useRef(0);
  const read = useRef(0);
  const draftRequest = useRef(0);
  const paneTitle = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (editPage) setLocalEditing(true); }, [editPage]);
  const dirty = !!draft && (snapshot(draft.payload) !== draft.baseline || draft.files.length > 0 || uncertain);
  useNavigationGuard({ isDirty: dirty, isPending: busy, onDiscard: () => { setDraft(null); setUncertain(false); } });
  const loadOverview = useCallback(async (page = 0, force = false) => {
    const sequence = owner.current;
    const request = ++overviewRead.current;
    const view = `overview:${page}`;
    const cached = cache.getCachedForum<ForumOverview>(refId, view);
    if (cached) setOverview(cached);
    if (!force && cached && cache.isForumSaverFresh(refId, view)) return cached;
    const scope = cache.getRequestScope().key;
    setSyncCount(value => value + 1);
    try {
      const data = await forumApi.overview(refId, page);
      if (sequence === owner.current && request === overviewRead.current && scope === cache.getRequestScope().key) {
        cache.setCachedForum(refId, view, data); setOverview(data);
      }
      return data;
    } catch (error) {
      if (sequence === owner.current && request === overviewRead.current) throw error;
      return cached;
    } finally { setSyncCount(value => Math.max(0, value - 1)); }
  }, [refId]);
  const loadThread = useCallback(async (id: string, page = 0, force = false) => {
    const sequence = ++read.current;
    const view = `thread:${id}:${page}`;
    const cached = cache.getCachedForum<ForumConversation>(refId, view);
    if (cached) { setConversation(cached); setPostPage(page); setLoading(false); }
    if (!force && cached && cache.isForumSaverFresh(refId, view)) return;
    const scope = cache.getRequestScope().key;
    setLoading(!cached); setSyncCount(value => value + 1);
    try {
      const data = await forumApi.thread(refId, id, page);
      if (sequence === read.current && scope === cache.getRequestScope().key) {
        cache.setCachedForum(refId, view, data); setConversation(data); setPostPage(page);
      }
    } catch (e) { if (sequence === read.current) throw e; }
    finally { if (sequence === read.current) setLoading(false); setSyncCount(value => Math.max(0, value - 1)); }
  }, [refId]);
  useLayoutEffect(() => {
    const update = () => {
      if (!root.current || !workspace.current) return;
      setCompact(root.current.clientWidth < 640);
      const top = workspace.current.getBoundingClientRect().top;
      const bottom = Math.min(window.visualViewport?.height || innerHeight, root.current.closest('main')?.getBoundingClientRect().bottom || innerHeight);
      workspace.current.style.height = `${Math.min(928, Math.max(280, bottom - top - 16))}px`;
    };
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    update(); window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); };
  }, [editPage, overview?.intro_html, error, notice]);
  useEffect(() => {
    ++owner.current; const sequence = owner.current;
    void loadOverview().catch(e => { if (sequence === owner.current) setError(e.message); });
    return () => { ++owner.current; ++read.current; ++draftRequest.current; };
  }, [loadOverview]);
  const refresh = async () => {
    setError('');
    if (editPage) setPageRefresh(value => value + 1);
    try { await Promise.all([loadOverview(overview?.page || 0, true), ...(!editPage && selected ? [loadThread(selected, postPage, true)] : [])]); }
    catch (e: any) { setError(e.message || t('forum.load_failed')); }
  };
  useConnectionRetry(() => { void refresh(); });
  const choose = async (id: string | null, trigger?: HTMLButtonElement) => {
    if (busy || !await navigationGuard.confirmNavigation()) return false;
    ++draftRequest.current;
    setDraft(null); setUncertain(false); setError(''); setNotice(''); setEditPage(false);
    setSelected(id); setConversation(null);
    setHighlighted(null);
    if (trigger) selectedButton.current = trigger;
    if (id) {
      paneTitle.current?.focus();
      try { await loadThread(id); requestAnimationFrame(() => paneTitle.current?.focus()); }
      catch (e: any) { setError(e.message || t('forum.load_failed')); }
    } else requestAnimationFrame(() => selectedButton.current?.focus());
    return true;
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
      requestAnimationFrame(() => { if (composer.current) composer.current.scrollTop = 0; composer.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true }); });
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
      cache.invalidateForum(refId);
      setDraft(null); setUncertain(false); setSelected(result.thread_id); setNotice(t('forum.saved'));
      try { await loadOverview(0, true); await loadThread(result.thread_id, 0, true); }
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
    const scope = cache.getRequestScope().key; const sequence = owner.current;
    setBusy(true); setError('');
    try {
      const data = await forumApi.moderate(refId, selected, action);
      if (scope !== cache.getRequestScope().key || sequence !== owner.current) return;
      cache.invalidateForum(refId); cache.setCachedForum(refId, 'overview:0', data); setOverview(data); setNotice(t('forum.saved'));
      if (action === 'delete') { setSelected(null); setConversation(null); }
      else await loadThread(selected, postPage, true);
    } catch (e: any) { if (scope === cache.getRequestScope().key && sequence === owner.current) setError(e.message || t('forum.write_uncertain')); }
    finally { setBusy(false); }
  };
  const selectedThread = overview?.threads.find(thread => thread.id === selected);
  const filtered = overview?.threads.filter(thread => `${thread.title} ${thread.author}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || [];
  const showConversation = !!selected || !!draft;
  const ordered = [...filtered].sort((a,b) => Number(b.sticky) - Number(a.sticky));
  const highlightPost = (id: string) => {
    setHighlighted(id);
    requestAnimationFrame(() => {
      const post = messages.current?.querySelector<HTMLElement>(`[id="forum-post-${id}"]`);
      if (post && messages.current) {
        messages.current.scrollTop += post.getBoundingClientRect().top - messages.current.getBoundingClientRect().top - 12;
        post.focus({ preventScroll: true });
      }
    });
  };
  const navigatePostLink = async (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest('a[href]');
    if (!anchor) return;
    let url: URL;
    try { url = new URL(anchor.getAttribute('href') || '', window.location.href); }
    catch { return; }
    const id = url.searchParams.get('pos_pk') || url.hash.match(/^#(?:forum-post-)?(\d+)$/)?.[1];
    const thread = url.searchParams.get('thr_pk') || selected;
    const internal = url.origin === location.origin && url.hash.startsWith('#forum-post-') ||
      url.hostname === 'ilias.unibe.ch' && url.searchParams.get('ref_id') === refId &&
      ['viewthread', 'selectpost'].includes((url.searchParams.get('cmd') || '').toLowerCase());
    if (!internal || !id || !/^\d+$/.test(id) || !thread || !/^\d+$/.test(thread)) return;
    event.preventDefault();
    if (thread !== selected && !await choose(thread)) return;
    highlightPost(id);
  };
  const ancestors = breadcrumbs.filter(crumb => crumb.ref_id !== refId);
  if (courseRefId && courseRefId !== refId && !ancestors.some(crumb => crumb.ref_id === courseRefId)) ancestors.push({ ref_id: courseRefId, title: courseTitle });
  const crumbs = [...ancestors, { ref_id: refId, title: overview?.title || title }];

  return <section ref={root} data-compact={compact} className="forum-view mx-auto w-full max-w-[1600px] p-3 sm:p-5" aria-label={t('forum.title')}>
    <div className="forum-topbar mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
      <CompactBreadcrumbs rawBreadcrumbs={crumbs} courseNickname={courseTitle} courseRefId={courseRefId} currentFolderRefId={refId}
        onNavigateHome={onNavigateHome || onBack} onNavigateCourse={onNavigateCourse || onBack} onNavigateFolder={onNavigateFolder || onBack}
        onNavigateRepository={onNavigateRepository || onBack} onNavigateSemester={onNavigateSemester} />
      <div className="flex flex-wrap items-center gap-2">
        {(overview?.can_edit_page || editPage) && <button type="button" className={button} disabled={busy} aria-label={t(editPage ? 'management.done' : 'management.enter')} title={t(editPage ? 'management.done' : 'management.enter')} aria-pressed={editPage} onClick={async () => {
          if (await navigationGuard.confirmNavigation()) { setDraft(null); setEditPage(!editPage); }
        }}><Pencil className="h-4 w-4" /><span className="forum-manage-label">{t(editPage ? 'management.done' : 'management.enter')}</span></button>}
        <SyncRefreshControl isSyncing={syncCount > 0 || pageSyncing} disabled={busy} onRefresh={() => void refresh()} title={t('Neu von ILIAS abrufen')} />
      </div>
    </div>
    <header className="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy} onClick={async () => { if (await navigationGuard.confirmNavigation()) onBack(); }} aria-label={t('forum.back_course')}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{courseTitle}</span></button>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-teal-700 dark:text-teal-300">{t('forum.title')}</p><h1 className="break-words text-xl font-bold text-slate-900 dark:text-white">{overview?.title || title}</h1></div>
    </header>
    {error && <div className="mb-4"><ErrorNotice message={error} onRetry={uncertain ? () => void submit() : () => void refresh()} retryDisabled={busy} onDismiss={() => setError('')} /></div>}
    {notice && <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-teal-50 p-3 text-sm text-teal-900 dark:bg-teal-950/40 dark:text-teal-200"><Check className="h-4 w-4" />{notice}</p>}
    {!editPage && overview?.intro_html && <div className="forum-prose ilias-rich-content mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900" dangerouslySetInnerHTML={{ __html: forumMarkup(overview.intro_html) }} />}
    {editPage ? <ForumPageEditor refId={refId} refreshToken={pageRefresh} onSyncingChange={setPageSyncing} onSaved={() => { void loadOverview(0, true).catch(() => setError(t('forum.saved_refresh_failed'))); }} /> : <div ref={workspace} data-composing={Boolean(draft)} data-new-thread={draft?.thread === null} data-selected={showConversation} className="forum-workspace grid min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
      <aside className="forum-thread-list flex min-h-0 min-w-0 flex-col border-slate-200 dark:border-slate-700 md:border-r" aria-label={t('forum.threads')}>
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
      <div className="forum-thread-pane flex min-h-0 min-w-0 flex-col">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-b border-slate-200 p-3 dark:border-slate-700 md:flex">
          <button type="button" className={`${button} phone-only forum-thread-back`} disabled={busy} onClick={() => void choose(null)} aria-label={t('forum.back_threads')}><ArrowLeft className="h-4 w-4" /></button>
          <h2 ref={paneTitle} tabIndex={-1} className="col-start-2 row-start-1 min-w-0 flex-1 break-words py-2 text-base font-bold text-slate-900 outline-none dark:text-slate-100">{draft?.thread === null ? t('forum.new_thread') : conversation?.title || selectedThread?.title || t('forum.select_thread')}</h2>
          {selectedThread && selectedThread.actions.length > 0 && <details className="relative col-span-2 justify-self-end"><summary className={`${button} cursor-pointer`}>{t('forum.actions')}</summary><div className="absolute right-0 z-10 mt-1 min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">{selectedThread.actions.map(action => <button key={action} type="button" className={`${button} w-full border-0 justify-start`} disabled={busy} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); void moderate(action); }}>{t(`forum.action.${action}`)}</button>)}</div></details>}
        </div>
        <div ref={messages} onClick={event => void navigatePostLink(event)} className="forum-message-list min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5" aria-busy={loading}>
          {!showConversation && <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400"><MessageSquare className="h-10 w-10 text-teal-600" /><p>{t('forum.select_thread')}</p></div>}
          {loading && <p role="status" className="mb-3 text-sm text-slate-500">{t('forum.loading')}</p>}
          {conversation?.closed && <p className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Lock className="h-4 w-4 shrink-0" />{t('forum.closed_hint')}</p>}
          {draft?.thread !== null && <div className="space-y-5">{conversation?.posts.map(post => <article key={post.id} id={`forum-post-${post.id}`} tabIndex={-1} data-highlighted={highlighted === post.id} className="forum-post flex min-w-0 gap-2 rounded-xl p-1 sm:gap-3" aria-label={t('forum.post_by', { name: post.author })}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200" aria-hidden="true">{post.avatar_url ? <img src={post.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement?.append(post.author.slice(0,2).toUpperCase()); }} /> : post.author.slice(0,2).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><header className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="break-words text-sm font-bold text-slate-900 dark:text-slate-100">{post.author}</h3><span className="text-xs text-slate-500 dark:text-slate-400">{forumDate(post.date)}</span>{post.depth > 1 && <span className="text-xs text-teal-700 dark:text-teal-300">{t('forum.reply')}</span>}</header>
              {post.subject && <button type="button" className="mb-1 min-h-11 text-left text-sm font-semibold text-teal-800 underline decoration-dotted dark:text-teal-200" onClick={() => highlightPost(post.id)}>{post.subject}</button>}
              {forumPlainText(post.html) || /<(img|table|hr)\b/i.test(post.html) ? <div className="forum-prose ilias-rich-content w-full max-w-[72ch] min-w-0 rounded-2xl rounded-tl-sm bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-800/70 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: forumMarkup(post.html) }} /> : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">{t('forum.empty_post')}</p>}
              {Boolean(post.attachments?.length) && <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('forum.attachments')}>{post.attachments?.map(file => <li key={file.url}><a className={`${button} max-w-full text-xs`} href={file.url} download><Paperclip className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{file.title}</span></a></li>)}</ul>}
              {post.edited && <p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">{t('forum.edited')} {forumDate(post.edited)}</p>}
              <div className="mt-1 flex flex-wrap gap-1">{post.can_reply && !conversation.closed && <button type="button" className={`${button} border-0 bg-transparent text-xs`} disabled={busy} onClick={() => void begin(post)}>{t('forum.reply')}</button>}{post.can_edit && <button type="button" className={`${button} border-0 bg-transparent text-xs`} disabled={busy} onClick={() => void begin(post, true)}><Pencil className="h-3 w-3" />{t('forum.edit_post')}</button>}</div>
            </div>
          </article>)}</div>}
          {conversation && (conversation.has_more || conversation.page > 0) && <div className="my-4 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || loading || postPage === 0} onClick={() => void loadThread(conversation.thread_id, postPage - 1).catch(e => setError(e.message))}>{t('forum.previous')}</button><button type="button" className={button} disabled={busy || loading || !conversation.has_more} onClick={() => void loadThread(conversation.thread_id, postPage + 1).catch(e => setError(e.message))}>{t('forum.next')}</button></div>}
        </div>
          {draft && <div ref={composer} className="forum-composer min-h-0 overflow-y-auto border-t border-teal-300 p-3 dark:border-teal-800">
            <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 bg-white pb-2 dark:bg-slate-900"><h3 className="flex-1 text-sm font-bold text-slate-900 dark:text-slate-100">{t(draft.thread === null ? 'forum.new_thread' : draft.payload.edit_post_id ? 'forum.edit_post' : 'forum.reply')}</h3><button type="button" className={button} disabled={busy} aria-label={t('forum.cancel_draft')} onClick={async () => { if (await navigationGuard.confirmNavigation()) { setDraft(null); setUncertain(false); } }}><X className="h-4 w-4" /></button></div>
            <fieldset disabled={busy || uncertain} className="min-w-0 space-y-3 disabled:opacity-70"><label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{t('forum.subject')}<input maxLength={255} value={draft.payload.subject} onChange={e => patch({ subject: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 text-base text-slate-900 dark:border-slate-600 dark:text-white" /></label>
              <InstructionEditor value={draft.payload.message} onChange={message => patch({ message })} label={t('forum.message')} sanitize={forumMarkup} disabled={busy || uncertain} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={draft.payload.notify} onChange={e => patch({ notify: e.target.checked })} className="h-5 w-5" />{t('forum.notify')}</label>
              {!draft.payload.edit_post_id && <FileDropzone compact disabled={busy || uncertain} onFiles={files => setDraft(current => current ? { ...current, files: [...current.files, ...files] } : current)} />}
              <ul className="space-y-1">{draft.files.map((file,index) => <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span className="min-w-0 flex-1 break-words">{file.name}</span><button type="button" className={button} aria-label={t('forum.remove_file', { name: file.name })} onClick={() => setDraft(current => current ? { ...current, files: current.files.filter((_,i) => i !== index) } : current)}><X className="h-4 w-4" /></button></li>)}</ul>
            </fieldset>
            <div className="forum-compose-actions sticky bottom-0 z-10 mt-3 flex justify-end border-t border-slate-100 bg-white py-2 dark:border-slate-800 dark:bg-slate-900"><button type="button" className={`${button} border-teal-600 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-700 dark:text-white`} disabled={busy || !draft.payload.subject.trim() || !draft.payload.message.replace(/<[^>]*>/g, '').trim()} onClick={() => void submit()}><Send className="h-4 w-4" />{t(busy ? 'forum.sending' : uncertain ? 'forum.check_result' : draft.payload.edit_post_id ? 'forum.save_post' : 'forum.send')}</button></div>
          </div>}
      </div>
    </div>}
  </section>;
}
