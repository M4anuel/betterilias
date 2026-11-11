import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, FileText, Folder, GripVertical, LoaderCircle, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { t, useLanguage } from '../lib/i18n';
import { useNavigationGuard } from '../lib/navigationGuard';
import type { AuthoringContext, DeleteReview, DeleteReviewItem, ManagementResponse, MaterialItem } from '../types';
import { CourseAuthoring, type CompletionKey } from './AddObjectModal';

type NoticeKey = CompletionKey | 'management.deleted' | 'management.order_saved';
type Feedback = { kind: 'success' | 'warning'; key: NoticeKey } | { kind: 'error'; message: string };
type DeletionState = {
  ids: string[]; items: DeleteReviewItem[]; review?: DeleteReview;
  phase: 'loading' | 'ready' | 'failed' | 'deleting'; error?: string;
};

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:enabled:bg-slate-50 dark:hover:enabled:bg-slate-700';

function affectedRefs(items: DeleteReviewItem[]): string[] {
  return items.flatMap(item => [item.ref_id, ...affectedRefs(item.children)]);
}

export function CourseManagement({ context, title, courseRefId, isRevalidating, onRefresh, onOpenFolder }: {
  context: AuthoringContext; title: string; courseRefId: string; isRevalidating?: boolean; onRefresh: () => void; onOpenFolder: (ref: string) => void;
}) {
  useLanguage();
  const [data, setData] = useState<ManagementResponse | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<DeletionState | null>(null);
  const reviewRequest = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const setError = (message: string) => setFeedback(message ? { kind: 'error', message } : null);
  const setNotice = (key: NoticeKey | '', refreshFailed = false) => setFeedback(key ? { kind: refreshFailed ? 'warning' : 'success', key } : null);
  const [uncertain, setUncertain] = useState(false);
  const isUpdating = busy || loading || Boolean(isRevalidating);
  const dirty = !!data && JSON.stringify(order) !== JSON.stringify(data.order);
  useNavigationGuard({ isDirty: dirty, isPending: busy, onDiscard: () => { if (data) setOrder(data.order); } });
  const refId = context.ref_id;
  useEffect(() => {
    setDeletion(null);
    return () => { reviewRequest.current = null; };
  }, [refId]);
  const load = useCallback(async () => {
    const response = await api.getManagement(refId);
    cache.setCachedManagement(refId, response);
    setData(response); setOrder(response.order); setSelected([]); setUncertain(false);
  }, [refId]);
  useEffect(() => {
    let active = true;
    const cached = cache.getCachedManagement(refId);
    if (cached) {
      setData(cached);
      setOrder(cached.order);
      setLoading(false);
    }
    const isSaverFresh = cache.isIliasSaverFresh(`ilias_management_${refId}`);
    if (cached && isSaverFresh) {
      return;
    }
    api.getManagement(refId).then(response => {
      if (active) {
        cache.setCachedManagement(refId, response);
        setData(response);
        setOrder(prev => {
          const isDirty = cached && JSON.stringify(prev) !== JSON.stringify(cached.order);
          return isDirty ? prev : response.order;
        });
      }
    }).catch(e => { if (active && !cached) setError(e instanceof Error ? e.message : t('management.load_failed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refId]);
  async function reload() {
    setBusy(true); setError('');
    try { await refreshContents(); } catch (e) { setError(e instanceof Error ? e.message : t('management.load_failed')); }
    finally { setBusy(false); }
  }
  async function refreshContents(refs = [refId, courseRefId]) {
    cache.invalidateManagedMaterials(refs);
    // Refill even an empty parent before SWR refresh, preserving this panel and
    // preventing the empty-scrape cache guard from resurrecting deleted items.
    const fresh = await api.getMaterials(refId);
    cache.setCachedMaterials(refId, fresh);
    await load(); onRefresh();
  }
  function changed(createdItems: MaterialItem[] = [], completion?: CompletionKey) {
    setBusy(true); setFeedback(null);
    // Only server-confirmed objects are inserted. Permissions/order need a fresh read.
    if (createdItems.length) setData(previous => previous ? {
      ...previous, can_sort: false,
      items: [...previous.items.filter(item => !createdItems.some(created => created.ref_id === item.ref_id)),
        ...createdItems.map(item => ({ ...item, can_delete: false }))],
    } : previous);
    void refreshContents().then(() => {
      if (completion) setNotice(completion);
    }).catch(() => {
      if (completion) setNotice(completion, true);
      else setError(t('management.load_failed'));
    }).finally(() => setBusy(false));
  }
  async function prepareDelete(ids: string[]) {
    if (isUpdating || dirty || uncertain || !ids.length) return;
    setError(''); setNotice('');
    const request = {};
    reviewRequest.current = request;
    const cached = cache.getCachedDeleteReview(refId, ids);
    const preview = cached?.items || (data?.items || []).filter(item => ids.includes(item.ref_id))
      .map(item => ({ ref_id: item.ref_id, title: item.title, item_type: item.item_type, children: [] }));
    setDeletion({ ids, items: preview, phase: 'loading' });
    try {
      const fresh = await api.reviewDeletion(refId, ids);
      if (reviewRequest.current !== request) return;
      cache.setCachedDeleteReview(refId, ids, fresh);
      setDeletion({ ids, items: fresh.items, review: fresh, phase: 'ready' });
    } catch (e) {
      if (reviewRequest.current !== request) return;
      setDeletion({ ids, items: preview, phase: 'failed',
        error: e instanceof Error ? e.message : t('management.inspection_incomplete') });
    }
  }
  async function confirmDelete() {
    if (deletion?.phase !== 'ready' || !deletion.review || busy) return;
    const review = deletion.review;
    setDeletion({ ...deletion, phase: 'deleting' });
    setBusy(true); setError('');
    cache.invalidateCachedDeleteReview(refId);
    const invalidated = [refId, courseRefId, ...affectedRefs(review.items)];
    try {
      await api.deleteMaterials(refId, review.items.map(item => item.ref_id), review.revision);
    } catch (e) {
      cache.invalidateManagedMaterials(invalidated);
      setDeletion(null); setUncertain(true);
      setError(e instanceof Error ? e.message : t('management.delete_uncertain'));
      try {
        const fresh = await api.getMaterials(refId);
        cache.setCachedMaterials(refId, fresh); onRefresh();
      } catch { /* Preserve the review warning until an explicit reload succeeds. */ }
      setBusy(false); return;
    }
    setDeletion(null); setSelected([]); setNotice('management.deleted');
    try { await refreshContents(invalidated); }
    catch { setNotice('management.deleted', true); }
    finally { setBusy(false); }
  }
  async function saveOrder() {
    if (!data || !dirty || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.saveMaterialOrder(refId, order, data.order_revision);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('management.order_uncertain'));
      setUncertain(true);
      setBusy(false); return;
    }
    setNotice('management.order_saved');
    try { await refreshContents(); }
    catch { setNotice('management.order_saved', true); }
    finally { setBusy(false); }
  }
  function move(ref: string, target: number) {
    if (isUpdating || uncertain || !data?.can_sort) return;
    const from = order.indexOf(ref);
    if (from < 0 || target < 0 || target >= order.length || from === target) return;
    setOrder(previous => { const next = [...previous]; next.splice(from, 1); next.splice(target, 0, ref); return next; });
    setNotice('');
  }
  const items = data ? [...order.map(ref => data.items.find(item => item.ref_id === ref)).filter(item => !!item),
    ...data.items.filter(item => !order.includes(item.ref_id))] : [];
  const selectable = items.filter(item => item.can_delete);
  return <section aria-label={t('management.panel')} className="space-y-4" aria-busy={busy || loading}>
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-teal-200 bg-teal-50/50 p-5 dark:border-teal-900 dark:bg-teal-950/30">
      <div><h1 ref={heading} tabIndex={-1} className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{t('management.intro')}</p></div>
      <fieldset disabled={isUpdating || dirty} title={dirty ? t('management.save_first') : isUpdating ? t('Aktualisierung läuft... Bitte warten') : undefined}>
        <CourseAuthoring context={data?.authoring || context} onRefresh={changed}
          onComplete={(key, items) => changed(items, key)} onStart={() => setFeedback(null)} editorUrl={data?.editor_url} />
      </fieldset>
    </div>
    {feedback && <div data-management-feedback className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${feedback.kind === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
      : feedback.kind === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
      <p role={feedback.kind === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 self-center break-words">
        {feedback.kind === 'error' ? feedback.message : feedback.kind === 'warning'
          ? t('management.saved_refresh_failed', { result: t(feedback.key) }) : t(feedback.key)}
      </p>
      <button type="button" aria-label={t('Schliessen')} onClick={() => { setFeedback(null); heading.current?.focus({ preventScroll: true }); }}
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <X size={18} aria-hidden="true" />
      </button>
    </div>}
    {uncertain && <a target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-teal-700 underline dark:text-teal-300"
      href={`https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&ref_id=${refId}`}><ExternalLink size={14} />{t('authoring.open_ilias')}</a>}
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-auto flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="accent-teal-600" disabled={isUpdating || dirty || !selectable.length}
          checked={!!selectable.length && selectable.every(item => selected.includes(item.ref_id))}
          onChange={e => setSelected(e.target.checked ? selectable.map(item => item.ref_id) : [])} />{t('management.select_all')}
      </label>
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{t('management.selected', { count: selected.length })}</span>
      <button className={button} disabled={isUpdating || dirty || uncertain || !selected.length} onClick={() => void prepareDelete(selected)}><Trash2 size={15} />{t('management.delete_selected')}</button>
      {data?.can_sort && <button className={button} disabled={isUpdating || !dirty || uncertain} onClick={() => void saveOrder()}><Save size={15} />{t('management.save_order')}</button>}
      <button className={button} disabled={busy || (dirty && !uncertain)} onClick={() => void reload()} aria-label={t('management.reload')}><RefreshCw size={15} /></button>
    </div>
    {dirty && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span>{t('management.order_draft')}</span><button className={button} disabled={isUpdating} onClick={() => setOrder(data?.order || [])}>{t('management.discard_order')}</button>
    </div>}
    {loading ? <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{t('authoring.busy')}</p> : data &&
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
        {items.map(item => {
          const index = order.indexOf(item.ref_id);
          const Icon = item.item_type === 'fold' ? Folder : FileText;
          return <li key={item.ref_id} draggable={!!data?.can_sort && index >= 0 && !isUpdating && !uncertain}
            onDragStart={e => e.dataTransfer.setData('text/plain', item.ref_id)}
            onDragOver={e => { if (index >= 0) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/plain'), index); }}
            className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:flex sm:flex-wrap">
            <input type="checkbox" className="accent-teal-600" aria-label={t('management.select_item', { name: item.title })}
              disabled={isUpdating || dirty || !item.can_delete} checked={selected.includes(item.ref_id)}
              onChange={e => setSelected(previous => e.target.checked ? [...previous, item.ref_id] : previous.filter(ref => ref !== item.ref_id))} />
            {data?.can_sort && index >= 0 && <GripVertical aria-hidden="true" size={16} className="hidden text-slate-400 sm:block" />}
            <Icon aria-hidden="true" size={20} className="shrink-0 text-teal-600 dark:text-teal-300" />
            <div className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
              {item.file_size && <span className="text-xs text-slate-500 dark:text-slate-400">{item.file_size}</span>}</div>
            <div className="col-span-full flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
              {item.item_type === 'fold' && <button disabled={busy} className={button} onClick={() => onOpenFolder(item.ref_id)}>{t('management.open_folder')}</button>}
              <div className="flex items-center gap-1">
              {data?.can_sort && index >= 0 && <>
                <button className={button} disabled={busy || uncertain || index === 0} onClick={() => move(item.ref_id, index-1)} aria-label={t('management.move_up', { name: item.title })}><ArrowUp size={14} /></button>
                <button className={button} disabled={busy || uncertain || index === order.length-1} onClick={() => move(item.ref_id, index+1)} aria-label={t('management.move_down', { name: item.title })}><ArrowDown size={14} /></button>
              </>}
              <button className={button} disabled={busy || dirty || uncertain || !item.can_delete} onClick={() => void prepareDelete([item.ref_id])} aria-label={t('management.delete_item', { name: item.title })}><Trash2 size={14} /></button>
              </div>
            </div>
          </li>;
        })}
        {!items.length && <li className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('management.empty')}</li>}
      </ul>}
    {data?.can_sort && <p className="text-xs text-slate-500 dark:text-slate-400">{t('management.order_hint')}</p>}
    {data && !data.can_sort && items.length > 1 && <p className="text-xs text-slate-500 dark:text-slate-400">{t('management.sort_unavailable')}</p>}
    {deletion && <DeleteReviewDialog state={deletion}
      onCancel={() => { reviewRequest.current = null; setDeletion(null); }}
      onRetry={() => void prepareDelete(deletion.ids)} onConfirm={() => void confirmDelete()} />}
  </section>;
}

function ReviewTree({ items }: { items: DeleteReviewItem[] }) {
  return <ul className="space-y-2">{items.map(item => <li key={item.ref_id}>
    <span className="break-words font-medium">{item.title}</span>
    {!!item.children.length && <details className="ml-3 mt-1 border-l border-slate-300 pl-3 dark:border-slate-600">
      <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">{t('management.show_contents', { count: item.children.length })}</summary>
      <ReviewTree items={item.children} />
    </details>}
  </li>)}</ul>;
}

function DeleteReviewDialog({ state, onCancel, onRetry, onConfirm }: {
  state: DeletionState; onCancel: () => void; onRetry: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const deleting = state.phase === 'deleting';
  const pending = state.phase === 'loading' || deleting;
  const folders = state.review?.items.some(item => item.item_type === 'fold');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  function cancel() {
    if (deleting) return;
    // Close while still mounted so the browser restores focus to the invoker.
    dialog.current?.close();
    onCancel();
  }
  return <dialog ref={dialog} aria-labelledby="delete-materials-title" aria-describedby="delete-materials-warning"
    closedby={deleting ? 'none' : 'closerequest'}
    onCancel={e => { e.preventDefault(); cancel(); }}
    className="confirmation-dialog m-auto max-h-[90dvh] w-[min(36rem,95vw)] space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <h2 id="delete-materials-title" className="text-lg font-bold">{t('management.delete_title')}</h2>
    <p id="delete-materials-warning" className="text-sm text-slate-600 dark:text-slate-300">{t('management.delete_warning')}</p>
    <div className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800"><ReviewTree items={state.items} /></div>
    {state.error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <p>{state.error}</p><button type="button" className={`${button} mt-2 min-h-11`} onClick={onRetry}>{t('Erneut versuchen')}</button>
    </div>}
    {folders && <label className="flex items-start gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <input type="checkbox" disabled={deleting} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 accent-rose-600" />
      {t('management.cascade_ack', { count: state.review?.descendants || 0 })}
    </label>}
    <div className="flex flex-wrap justify-end gap-2"><button autoFocus disabled={deleting} className={`${button} min-h-11`} onClick={cancel}>{t('authoring.cancel')}</button>
      <button disabled={state.phase !== 'ready' || (folders && !acknowledged)} aria-busy={pending} onClick={onConfirm}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:enabled:bg-rose-700 disabled:opacity-40">
        <LoaderCircle size={16} aria-hidden="true" className={pending ? 'animate-spin motion-reduce:animate-none' : 'invisible'} />
        {t('management.confirm_delete')}
      </button></div>
  </dialog>;
}
