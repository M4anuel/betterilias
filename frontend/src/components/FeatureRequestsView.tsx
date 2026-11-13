import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, LoaderCircle, Plus, X } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { confirmDialog } from '../lib/dialog';
import { navigationGuard, useNavigationGuard } from '../lib/navigationGuard';
import { requestApi, requestCategories, requestStatuses } from '../lib/featureRequests';
import type { FeatureRequest, RequestCategory, RequestComment, RequestDraft, RequestPage } from '../lib/featureRequests';
import { DiscussionComposer } from './DiscussionComposer';
import { FileDropzone } from './FileDropzone';
import { ErrorNotice } from './ErrorNotice';

const button = 'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800';
const field = 'mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-400 bg-transparent px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-500 dark:text-white';
function nickname() { try { return localStorage.getItem('betterilias_community_nickname') || ''; } catch { return ''; } }
function remember(value: string) { try { localStorage.setItem('betterilias_community_nickname', value); } catch { /* optional */ } }

export function FeatureRequestsView({ selectedId, onSelect, admin = false, initialSuccess = false }: { selectedId?: string | null; onSelect?: (id: string | null, saved?: boolean) => void; admin?: boolean; initialSuccess?: boolean }) {
  const language = useLanguage();
  const [localId, setLocalId] = useState<string | null>(null);
  const id = onSelect ? selectedId : localId;
  const [page, setPage] = useState<RequestPage>({ items: [], has_more: false });
  const [current, setCurrent] = useState<FeatureRequest | null>(null);
  const [filters, setFilters] = useState({ search: '', category: '', status: '', sort: 'top', page: '0' });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(initialSuccess ? t('requests.saved') : '');
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [files, setFiles] = useState<{ file: File; uploaded?: string }[]>([]);
  const [progress, setProgress] = useState('');
  const [reply, setReply] = useState<{ id?: string; message: string; nickname: string } | null>(null);
  const [enlarged, setEnlarged] = useState<{ url: string; alt: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const dirty = Boolean(draft || reply);
  const clear = () => { setDraft(null); setReply(null); setFiles([]); };
  useNavigationGuard({ isDirty: dirty, isPending: busy, onDiscard: clear });
  useEffect(() => { if (enlarged) dialog.current?.showModal(); else dialog.current?.close(); }, [enlarged]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (draft || reply) composer.current?.querySelector<HTMLElement>('input,textarea')?.focus(); }, [Boolean(draft), Boolean(reply)]);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setCurrent(null);
    const load = id ? requestApi.detail(id, admin) : requestApi.list(new URLSearchParams(filters).toString(), admin);
    void load.then(result => { if (version !== generation.current) return; if (id) setCurrent(result as FeatureRequest); else setPage(result as RequestPage); })
      .catch(e => { if (version === generation.current) setError(e.message); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { ++generation.current; };
  }, [id, filters, refresh, language, admin]);
  const go = (next: string | null, saved = false) => { if (onSelect) onSelect(next, saved); else setLocalId(next); };
  async function select(next: string | null) { if (await navigationGuard.confirmNavigation()) { clear(); setError(''); go(next); } }
  async function perform(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setSuccess('');
    try { await action(); setSuccess(t('requests.saved')); }
    catch (e) { setError(e instanceof Error ? e.message : t('requests.failed')); }
    finally { operation.current = false; setBusy(false); setProgress(''); }
  }
  function begin(request?: FeatureRequest) {
    setEditing(request?.id || null);
    setDraft(request ? { title: request.title, description: request.description, category: request.category, nickname: request.nickname, images: request.images.map(image => image.id) } : { title: '', description: '', category: 'feature', nickname: nickname(), images: [] });
    setReply(null); setFiles([]); setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft) return;
    if (!draft.title.trim() || !draft.description.trim()) { setError(t('requests.required')); return; }
    await perform(async () => {
      const images = [...draft.images];
      for (let i = 0; i < files.length; i++) {
        setProgress(t('requests.uploading', { current: i + 1, total: files.length }));
        const image = files[i].uploaded || (await requestApi.upload(files[i].file)).id;
        setFiles(old => old.map((file, n) => n === i ? { ...file, uploaded: image } : file)); images.push(image);
      }
      const result = await requestApi.write<FeatureRequest>(editing ? `/${editing}` : '', editing ? 'PATCH' : 'POST', { ...draft, images }, admin);
      remember(draft.nickname); clear(); setCurrent(result); go(result.id, true); setRefresh(v => v + 1);
    });
  }
  function addFiles(incoming: File[]) {
    if (!draft) return;
    if (files.length + incoming.length + draft.images.length > 5 || incoming.some(file => file.size > 8_000_000)) { setError(t('requests.image_limits')); return; }
    if (incoming.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError(t('requests.image_type')); return; }
    setFiles(old => [...old, ...incoming.map(file => ({ file }))]);
  }
  async function remove(request: FeatureRequest, comment?: RequestComment) {
    if (!await confirmDialog({ title: t('requests.delete'), message: t('requests.delete_confirm'), variant: 'danger' })) return;
    await perform(async () => {
      const result = await requestApi.write<FeatureRequest>(`/${request.id}${comment ? `/comments/${comment.id}` : ''}`, 'DELETE', undefined, admin);
      if (comment) setCurrent(result); else { setCurrent(null); go(null, true); setRefresh(v => v + 1); }
    });
  }
  const author = (name: string) => name || t('requests.anonymous');
  const date = (stamp: number) => new Date(stamp * 1000).toLocaleString(language);
  const cancel = async () => { if (await navigationGuard.confirmNavigation()) clear(); };
  const actions = <button type="submit" className={button} disabled={busy}>{busy && <LoaderCircle aria-hidden size={18} className="animate-spin motion-reduce:animate-none" />}{t(draft ? 'requests.publish' : 'forum.send')}</button>;
  const controls = (request: FeatureRequest, comment?: RequestComment) => (admin || (comment ? comment.owned : request.owned)) && <div className="flex flex-wrap gap-2">
    <button type="button" className={button} disabled={busy || dirty} onClick={() => comment ? setReply({ id: comment.id, message: comment.message, nickname: comment.nickname }) : begin(request)}>{t('forum.edit_post')}</button>
    <button type="button" className={button} disabled={busy || dirty} onClick={() => void remove(request, comment)}>{t('requests.delete')}</button>
  </div>;
  return <section data-feature-requests className="mx-auto w-full min-w-0 max-w-5xl space-y-4 p-3 text-slate-900 sm:p-6 dark:text-slate-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="break-words text-xl font-bold sm:text-2xl">{t('requests.title')}</h1><p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{t('requests.intro')}</p></div>
      {!admin && !draft && <button type="button" className={button} disabled={busy || dirty} onClick={() => begin()}><Plus size={18} />{t('requests.new')}</button>}
    </header>
    <p className="text-xs text-slate-500 dark:text-slate-400">{t('requests.cookie_hint')}</p>
    {error && <div ref={errorSummary} tabIndex={-1}><ErrorNotice connectionInline message={error} onDismiss={() => setError('')} onRetry={() => setRefresh(v => v + 1)} /></div>}
    {success && <div role="status" className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100"><Check size={18} /><span className="min-w-0 flex-1">{success}</span><button type="button" className={button} aria-label={t('Schliessen')} onClick={() => setSuccess('')}><X size={16} /></button></div>}
    {admin && page.storage && <p className="text-sm">{t('requests.storage', { used: (page.storage.used / 1e9).toFixed(2), limit: (page.storage.limit / 1e9).toFixed(2) })}</p>}
    {!id && !draft && <>
      <search className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900">
        <label className="min-w-0 text-sm font-semibold">{t('requests.search')}<input name="search" type="search" className={field} maxLength={180} value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value, page: '0' })} /></label>
        {(['sort', 'category', 'status'] as const).map(key => <label key={key} className="min-w-0 text-sm font-semibold">{t(`requests.${key}`)}<select aria-label={t(`requests.${key}`)} name={key} className={field} value={filters[key]} onChange={e => setFilters({ ...filters, [key]: e.target.value, page: '0' })}>{key !== 'sort' && <option value="">{t('requests.all')}</option>}{(key === 'sort' ? ['top', 'newest'] : key === 'category' ? requestCategories : requestStatuses).map(value => <option key={value} value={value}>{t(`requests.${key === 'sort' ? value : `${key}.${value}`}` as Parameters<typeof t>[0])}</option>)}</select></label>)}
      </search>
      {!loading && !page.items.length && <p className="p-6 text-center text-slate-500 dark:text-slate-400">{t('requests.empty')}</p>}
      <div className="space-y-3">{page.items.map(request => <article key={request.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-center dark:bg-slate-800"><span className="block font-bold">{request.score}</span><span className="text-xs">{t('requests.votes')}</span></div><div className="min-w-0 flex-1"><button type="button" className="min-h-11 w-full cursor-pointer break-words text-left font-bold text-teal-800 focus-visible:outline-2 dark:text-teal-200" onClick={() => void select(request.id)}>{request.title}</button><p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{request.description}</p><p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">{t(`requests.status.${request.status}`)} · {t(`requests.category.${request.category}`)} · {t('requests.comment_count', { count: request.comment_count })}</p></div></article>)}</div>
      <div className="flex justify-between gap-2"><button type="button" className={button} disabled={loading || filters.page === '0'} onClick={() => setFilters({ ...filters, page: String(+filters.page - 1) })}>{t('forum.previous')}</button><button type="button" className={button} disabled={loading || !page.has_more} onClick={() => setFilters({ ...filters, page: String(+filters.page + 1) })}>{t('forum.next')}</button></div>
    </>}
    {loading && <p role="status">{t('requests.loading')}</p>}
    {id && !draft && <button type="button" className={button} disabled={busy} onClick={() => void select(null)}><ArrowLeft size={18} />{t('requests.back')}</button>}
    {current && !draft && <article className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header><p className="text-xs text-teal-800 dark:text-teal-200">{t(`requests.status.${current.status}`)} · {t(`requests.category.${current.category}`)}</p><h2 className="mt-2 break-words text-xl font-bold">{current.title}</h2><p className="mt-2 break-words text-xs text-slate-500 dark:text-slate-400">{author(current.nickname)} · {date(current.created)}</p></header>
      <p className="max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-relaxed">{current.description}</p>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{current.images.map((image, n) => { const small = image.variants[0], full = image.variants.at(-1)!; const alt = t('requests.image_alt', { number: n + 1, title: current.title }); return <button type="button" key={image.id} className="min-w-0 cursor-zoom-in rounded-xl focus-visible:outline-2" onClick={() => setEnlarged({ url: full.url, alt })}><img className="h-auto max-h-72 w-full rounded-xl object-contain" src={small.url} srcSet={image.variants.map(v => `${v.url} ${v.width}w`).join(', ')} sizes="(max-width: 640px) 90vw, 400px" width={small.width} height={small.height} loading={n === 0 ? 'eager' : 'lazy'} fetchPriority={n === 0 ? 'high' : undefined} decoding="async" alt={alt} /></button>; })}</div>
      {current.images_archived && <p className="text-sm text-slate-500 dark:text-slate-400">{t('requests.images_archived')}</p>}
      <div className="flex flex-wrap items-center gap-2">{!admin && ([-1, 1] as const).map(value => <button type="button" key={value} className={button} disabled={busy} aria-pressed={current.my_vote === value} aria-label={t(value === 1 ? 'requests.upvote' : 'requests.downvote')} onClick={() => void perform(async () => { setCurrent(await requestApi.write(`/${current.id}/vote`, 'PUT', { value: current.my_vote === value ? 0 : value })); })}>{value === 1 ? <ArrowUp size={18} /> : <ArrowDown size={18} />}{current.my_vote === value && <Check size={14} />}</button>)}<span className="px-2 font-bold">{current.score} {t('requests.votes')}</span>{controls(current)}</div>
      {admin && <label className="block max-w-xs text-sm font-semibold">{t('requests.status')}<select aria-label={t('requests.status')} className={field} value={current.status} disabled={busy} onChange={e => { const status = e.target.value; void perform(async () => { setCurrent(await requestApi.write(`/${current.id}/status`, 'PUT', { status }, true)); }); }}>{requestStatuses.map(value => <option key={value} value={value}>{t(`requests.status.${value}`)}</option>)}</select></label>}
      <h3 className="border-t border-slate-200 pt-4 font-bold dark:border-slate-700">{t('requests.comments')}</h3>
      {current.comments?.map(comment => <article key={comment.id} className="min-w-0 space-y-2 border-b border-slate-200 pb-4 dark:border-slate-700"><header className="break-words text-xs text-slate-500 dark:text-slate-400">{author(comment.nickname)} · {date(comment.created)}{comment.updated > comment.created ? ` · ${t('forum.edited')}` : ''}</header><p className="max-w-[72ch] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-slate-50 p-3 text-sm dark:bg-slate-800/70">{comment.message}</p>{controls(current, comment)}</article>)}
      {!reply && !admin && <button type="button" className={button} disabled={busy} onClick={() => setReply({ message: '', nickname: nickname() })}>{t('forum.reply')}</button>}
    </article>}
    {draft && <form aria-label={t(editing ? 'requests.edit' : 'requests.new')} action="/api/feature-requests" method="post" onSubmit={save} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <DiscussionComposer containerRef={composer} title={t(editing ? 'requests.edit' : 'requests.new')} onCancel={() => void cancel()} disabled={busy} actions={actions}>
        <div className="forum-reply-message space-y-3"><label className="block text-sm font-semibold">{t('requests.request_title')}<input name="title" className={field} required maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label className="block text-sm font-semibold">{t('requests.description')}<textarea aria-label={t('requests.description')} name="description" className={`${field} min-h-40 resize-y`} required maxLength={12000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label></div>
        <div className="forum-reply-options space-y-3"><label className="block text-sm font-semibold">{t('requests.nickname')}<input name="nickname" autoComplete="nickname" className={field} maxLength={50} readOnly={Boolean(editing)} value={draft.nickname} onChange={e => setDraft({ ...draft, nickname: e.target.value })} /></label><label className="block text-sm font-semibold">{t('requests.category')}<select aria-label={t('requests.category')} className={field} name="category" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as RequestCategory })}>{requestCategories.map(value => <option key={value} value={value}>{t(`requests.category.${value}`)}</option>)}</select></label>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('requests.image_hint')}</p>{(!editing || current?.status !== 'completed') && !admin && <FileDropzone compact accept="image/jpeg,image/png,image/webp" disabled={busy} onFiles={addFiles} />}
          {draft.images.map((image, n) => <div key={image} className="flex items-center justify-between gap-2 text-sm"><span>{t('requests.image_number', { number: n + 1 })}</span><button type="button" className={button} aria-label={t('requests.remove_image', { number: n + 1 })} onClick={() => setDraft({ ...draft, images: draft.images.filter(v => v !== image) })}><X size={16} /></button></div>)}
          {files.map((item, n) => <div key={n} className="flex min-w-0 items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{item.file.name}</span><button type="button" className={button} aria-label={t('forum.remove_file', { name: item.file.name })} onClick={() => setFiles(old => old.filter((_, i) => i !== n))}><X size={16} /></button></div>)}
          {busy && <p role="status" className="text-sm">{progress || t('requests.processing')}</p>}
        </div>
      </DiscussionComposer>
    </form>}
    {reply && current && <form aria-label={t('requests.comments')} action={`/api/feature-requests/${current.id}/comments`} method="post" className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" onSubmit={e => { e.preventDefault(); if (!reply.message.trim()) { setError(t('requests.required')); return; } void perform(async () => { setCurrent(await requestApi.write(`/${current.id}/comments${reply.id ? `/${reply.id}` : ''}`, reply.id ? 'PATCH' : 'POST', reply, admin)); remember(reply.nickname); setReply(null); }); }}>
      <DiscussionComposer containerRef={composer} title={t(reply.id ? 'forum.edit_post' : 'forum.reply')} onCancel={() => void cancel()} disabled={busy} actions={actions}><div className="forum-reply-message"><label className="block text-sm font-semibold">{t('forum.message')}<textarea aria-label={t('forum.message')} name="message" className={`${field} min-h-32 resize-y`} required maxLength={6000} value={reply.message} onChange={e => setReply({ ...reply, message: e.target.value })} /></label></div><div className="forum-reply-options"><label className="block text-sm font-semibold">{t('requests.nickname')}<input name="nickname" autoComplete="nickname" className={field} maxLength={50} readOnly={Boolean(reply.id)} value={reply.nickname} onChange={e => setReply({ ...reply, nickname: e.target.value })} /></label></div></DiscussionComposer>
    </form>}
    {<dialog ref={dialog} aria-label={enlarged?.alt || t('forum.attachments')} className="m-auto max-h-[90dvh] w-[95vw] max-w-6xl overflow-auto rounded-2xl border-0 bg-white p-3 text-slate-900 backdrop:bg-slate-950/70 dark:bg-slate-900 dark:text-white" onCancel={() => setEnlarged(null)} onClick={e => { if (e.target === e.currentTarget) setEnlarged(null); }}><div className="sticky top-0 flex justify-end"><button type="button" className={button} aria-label={t('Schliessen')} onClick={() => setEnlarged(null)}><X size={20} /></button></div><img src={enlarged?.url} alt={enlarged?.alt || ''} hidden={!enlarged} className="h-auto max-w-full" /></dialog>}
  </section>;
}
