import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, FileText, Folder, GripVertical, RefreshCw, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { t, useLanguage } from '../lib/i18n';
import { useNavigationGuard } from '../lib/navigationGuard';
import type { AuthoringContext, DeleteReview, DeleteReviewItem, ManagementResponse } from '../types';
import { CourseAuthoring } from './AddObjectModal';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:enabled:bg-slate-50 dark:hover:enabled:bg-slate-700';

function affectedRefs(items: DeleteReviewItem[]): string[] {
  return items.flatMap(item => [item.ref_id, ...affectedRefs(item.children)]);
}

export function CourseManagement({ context, title, courseRefId, onRefresh, onOpenFolder }: {
  context: AuthoringContext; title: string; courseRefId: string; onRefresh: () => void; onOpenFolder: (ref: string) => void;
}) {
  useLanguage();
  const [data, setData] = useState<ManagementResponse | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<DeleteReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<'management.deleted' | 'management.order_saved' | ''>('');
  const [uncertain, setUncertain] = useState(false);
  const dirty = !!data && JSON.stringify(order) !== JSON.stringify(data.order);
  useNavigationGuard({ isDirty: dirty, isPending: busy });
  const refId = context.ref_id;
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
  function changed() {
    setBusy(true);
    void refreshContents().catch(() => setError(t('management.load_failed'))).finally(() => setBusy(false));
  }
  async function prepareDelete(ids: string[]) {
    if (busy || dirty || uncertain) return;
    setBusy(true); setError(''); setNotice('');
    try { setReview(await api.reviewDeletion(refId, ids)); }
    catch (e) { setError(e instanceof Error ? e.message : t('management.inspection_incomplete')); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!review || busy) return;
    setBusy(true); setError('');
    const invalidated = [refId, courseRefId, ...affectedRefs(review.items)];
    try {
      await api.deleteMaterials(refId, review.items.map(item => item.ref_id), review.revision);
    } catch (e) {
      cache.invalidateManagedMaterials(invalidated);
      setReview(null); setUncertain(true);
      setError(e instanceof Error ? e.message : t('management.delete_uncertain'));
      try {
        const fresh = await api.getMaterials(refId);
        cache.setCachedMaterials(refId, fresh); onRefresh();
      } catch { /* Preserve the review warning until an explicit reload succeeds. */ }
      setBusy(false); return;
    }
    setReview(null); setSelected([]); setNotice('management.deleted');
    try { await refreshContents(invalidated); }
    catch { setError(t('management.load_failed')); }
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
    catch { setError(t('management.load_failed')); }
    finally { setBusy(false); }
  }
  function move(ref: string, target: number) {
    if (busy || uncertain || !data?.can_sort) return;
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
      <div><h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{t('management.intro')}</p></div>
      <fieldset disabled={busy || dirty} title={dirty ? t('management.save_first') : undefined}>
        <CourseAuthoring context={data?.authoring || context} onRefresh={changed} editorUrl={data?.editor_url} />
      </fieldset>
    </div>
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{t(notice)}</div>}
    {uncertain && <a target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-teal-700 underline dark:text-teal-300"
      href={`https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&ref_id=${refId}`}><ExternalLink size={14} />{t('authoring.open_ilias')}</a>}
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-auto flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="accent-teal-600" disabled={busy || dirty || !selectable.length}
          checked={!!selectable.length && selectable.every(item => selected.includes(item.ref_id))}
          onChange={e => setSelected(e.target.checked ? selectable.map(item => item.ref_id) : [])} />{t('management.select_all')}
      </label>
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{t('management.selected', { count: selected.length })}</span>
      <button className={button} disabled={busy || dirty || uncertain || !selected.length} onClick={() => void prepareDelete(selected)}><Trash2 size={15} />{t('management.delete_selected')}</button>
      {data?.can_sort && <button className={button} disabled={busy || !dirty || uncertain} onClick={() => void saveOrder()}><Save size={15} />{t('management.save_order')}</button>}
      <button className={button} disabled={busy || (dirty && !uncertain)} onClick={() => void reload()} aria-label={t('management.reload')}><RefreshCw size={15} /></button>
    </div>
    {dirty && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span>{t('management.order_draft')}</span><button className={button} disabled={busy} onClick={() => setOrder(data?.order || [])}>{t('management.discard_order')}</button>
    </div>}
    {loading ? <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{t('authoring.busy')}</p> : data &&
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
        {items.map(item => {
          const index = order.indexOf(item.ref_id);
          const Icon = item.item_type === 'fold' ? Folder : FileText;
          return <li key={item.ref_id} draggable={!!data?.can_sort && index >= 0 && !busy && !uncertain}
            onDragStart={e => e.dataTransfer.setData('text/plain', item.ref_id)}
            onDragOver={e => { if (index >= 0) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/plain'), index); }}
            className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <input type="checkbox" className="accent-teal-600" aria-label={t('management.select_item', { name: item.title })}
              disabled={busy || dirty || !item.can_delete} checked={selected.includes(item.ref_id)}
              onChange={e => setSelected(previous => e.target.checked ? [...previous, item.ref_id] : previous.filter(ref => ref !== item.ref_id))} />
            {data?.can_sort && index >= 0 && <GripVertical aria-hidden="true" size={16} className="hidden text-slate-400 sm:block" />}
            <Icon aria-hidden="true" size={20} className="shrink-0 text-teal-600 dark:text-teal-300" />
            <div className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
              {item.file_size && <span className="text-xs text-slate-500 dark:text-slate-400">{item.file_size}</span>}</div>
            {item.item_type === 'fold' && <button disabled={busy} className={button} onClick={() => onOpenFolder(item.ref_id)}>{t('management.open_folder')}</button>}
            <div className="flex items-center gap-1">
              {data?.can_sort && index >= 0 && <>
                <button className={button} disabled={busy || uncertain || index === 0} onClick={() => move(item.ref_id, index-1)} aria-label={t('management.move_up', { name: item.title })}><ArrowUp size={14} /></button>
                <button className={button} disabled={busy || uncertain || index === order.length-1} onClick={() => move(item.ref_id, index+1)} aria-label={t('management.move_down', { name: item.title })}><ArrowDown size={14} /></button>
              </>}
              <button className={button} disabled={busy || dirty || uncertain || !item.can_delete} onClick={() => void prepareDelete([item.ref_id])} aria-label={t('management.delete_item', { name: item.title })}><Trash2 size={14} /></button>
            </div>
          </li>;
        })}
        {!items.length && <li className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('management.empty')}</li>}
      </ul>}
    {data?.can_sort && <p className="text-xs text-slate-500 dark:text-slate-400">{t('management.order_hint')}</p>}
    {data && !data.can_sort && items.length > 1 && <p className="text-xs text-slate-500 dark:text-slate-400">{t('management.sort_unavailable')}</p>}
    {review && <DeleteReviewDialog review={review} busy={busy} onCancel={() => setReview(null)} onConfirm={() => void confirmDelete()} />}
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

function DeleteReviewDialog({ review, busy, onCancel, onConfirm }: {
  review: DeleteReview; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const folders = review.items.some(item => item.item_type === 'fold');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="delete-materials-title" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}
    className="m-auto max-h-[90dvh] w-[min(36rem,95vw)] space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <h2 id="delete-materials-title" className="text-lg font-bold">{t('management.delete_title')}</h2>
    <p className="text-sm text-slate-600 dark:text-slate-300">{t('management.delete_warning')}</p>
    <div className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800"><ReviewTree items={review.items} /></div>
    {folders && <label className="flex items-start gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <input type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 accent-rose-600" />
      {t('management.cascade_ack', { count: review.descendants })}
    </label>}
    <div className="flex justify-end gap-2"><button disabled={busy} className={button} onClick={onCancel}>{t('authoring.cancel')}</button>
      <button disabled={busy || (folders && !acknowledged)} onClick={onConfirm} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">{t('management.confirm_delete')}</button></div>
  </dialog>;
}
