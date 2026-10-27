import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, FileText, FolderPlus, Layers, Plus, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import { t, useLanguage } from '../lib/i18n';
import { objectCategories, supportedCreationTypes } from '../lib/iliasObjects';
import { useNavigationGuard } from '../lib/navigationGuard';
import { describeFileLicense } from '../lib/fileLicenses';
import { FileUploadProgress, type FileUploadState } from './FileUploadProgress';
import type { AuthoringContext, FileLicense } from '../types';

type QueueItem = { id: number; file: File; status: FileUploadState; progress: number; error?: string };
type CompletionKey = 'authoring.created' | 'authoring.files_saved';
const fieldClass = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-slate-900 dark:text-slate-100';
const buttonClass = 'rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 disabled:opacity-50';

export function CourseAuthoring({ context, onRefresh, editorUrl }: { context: AuthoringContext; onRefresh: () => void; editorUrl?: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<CompletionKey | ''>('');
  if (!context.can_create && !editorUrl) return null;
  return <>
    {notice && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{t(notice)}</span>}
    <button className="flex items-center gap-1 rounded-lg bg-[#0AACA5] px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400"
      onClick={() => { setNotice(''); setOpen(true); }}><Plus size={16} />{t('authoring.add')}</button>
    {open && <AddObjectModal refId={context.ref_id} editorUrl={editorUrl} onClose={() => setOpen(false)} onRefresh={onRefresh}
      onComplete={key => { setNotice(key); setOpen(false); onRefresh(); }} />}
  </>;
}

function AddObjectModal({ refId, onClose, onComplete, onRefresh, editorUrl }: {
  refId: string; onClose: () => void; onComplete: (key: CompletionKey) => void; onRefresh: () => void; editorUrl?: string;
}) {
  useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [context, setContext] = useState<AuthoringContext | null>(null);
  const [step, setStep] = useState<'catalogue' | 'fold' | 'file'>('catalogue');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'materials' | 'page'>('materials');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [templates, setTemplates] = useState<FileLicense[] | null>(null);
  const [template, setTemplate] = useState('');
  const [licenses, setLicenses] = useState<FileLicense[] | null>(null);
  const [license, setLicense] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const nextId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const hasFailedUploads = queue.some(item => item.status === 'failed');
  const selectedLicense = licenses?.find(option => option.value === license);
  // The whole queue remains pending between individual native file saves.
  useNavigationGuard({ isPending: busy });
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    api.getAuthoringContext(refId).then(value => { if (active) setContext(value); })
      .catch(() => { if (active) setError(t('authoring.load_failed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refId]);

  async function choose(type: 'fold' | 'file') {
    setError(''); setStep(type);
    {
      setLoading(true); setLicenses(null); setTemplates(null);
      try {
        if (type === 'file') {
          const options = await api.getFileCreationOptions(refId);
          setLicenses(options.licenses);
          setLicense(options.licenses.find(option => option.selected)?.value || options.licenses[0]?.value || '');
        } else {
          const options = await api.getFolderCreationOptions(refId);
          setTemplates(options.templates);
          setTemplate(options.templates.find(option => option.selected)?.value || options.templates[0]?.value || '');
        }
      } catch (e) { setError(e instanceof Error ? e.message : t('authoring.load_failed')); }
      finally { setLoading(false); }
    }
  }
  function addFiles(files: FileList | null) {
    if (!files || busy || uncertain) return;
    const additions = Array.from(files);
    if (queue.length + additions.length > 100 || additions.some(file => file.size >= 900_000_000)) {
      setError(t('authoring.select_limit')); return;
    }
    setQueue(previous => [...previous, ...additions.map(file => ({ id: nextId.current++, file, status: 'pending' as const, progress: 0 }))]);
    setError('');
  }
  function update(id: number, values: Partial<QueueItem>) {
    setQueue(previous => previous.map(item => item.id === id ? { ...item, ...values } : item));
  }
  async function save() {
    if (busy || uncertain) return;
    setError('');
    if (step === 'fold' && !title.trim()) { setError(t('authoring.title_required')); return; }
    setBusy(true);
    try {
      if (step === 'fold') {
        await api.createFolder(refId, { title: title.trim(), description, template_id: template });
        onComplete('authoring.created');
      } else {
        const pending = queue.filter(item => item.status === 'pending');
        let next = 0;
        let failed = hasFailedUploads;
        // Limit parallel uploads to avoid saturating memory/connections for big lectures.
        const worker = async () => {
          while (next < pending.length) {
            const item = pending[next++];
            update(item.id, { status: 'saving' });
            try {
              await api.uploadCourseFile(refId, item.file, license, progress => update(item.id, { progress }));
              update(item.id, { status: 'saved', progress: 100 });
            } catch (e) {
              failed = true;
              update(item.id, { status: 'failed', error: e instanceof Error ? e.message : t('authoring.uncertain') });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
        onRefresh();
        if (failed) setError(t('authoring.uploads_partial'));
        else onComplete('authoring.files_saved');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('authoring.uncertain'));
      setUncertain(true); onRefresh();
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="add-object-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[min(48rem,95vw)] max-h-[90dvh] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 shadow-xl backdrop:bg-black/50">
    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-5">
      <h2 id="add-object-title" className="text-lg font-bold">{t(step === 'catalogue' ? 'authoring.add' : step === 'fold' ? 'authoring.create' : 'authoring.upload')}</h2>
      <button disabled={busy} onClick={onClose} aria-label={t('authoring.close')} className={buttonClass}><X size={18} /></button>
    </div>
    <div className="space-y-4 p-5" aria-busy={busy || loading}>
      {error && <div role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-950/40 p-3 text-rose-800 dark:text-rose-200">{error}</div>}
      {(uncertain || hasFailedUploads) && <a className="block text-teal-700 dark:text-teal-300 underline" target="_blank" rel="noreferrer"
        href={`https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&ref_id=${encodeURIComponent(refId)}`}>{t('authoring.open_ilias')}</a>}
      {step === 'catalogue' ? <>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('management.content_kind')}>
          <button className={`${buttonClass} ${category === 'materials' ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : ''}`} aria-pressed={category === 'materials'} onClick={() => setCategory('materials')}>{t('management.materials')}</button>
          <button className={`${buttonClass} ${category === 'page' ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : ''}`} aria-pressed={category === 'page'} onClick={() => setCategory('page')}>{t('management.page_elements')}</button>
        </div>
        {category === 'page' ? <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('management.page_explanation')}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(['text', 'media', 'tables', 'sections', 'accordions', 'columns', 'resources', 'code', 'lists', 'maps', 'interactive', 'snippets'] as const).map(type =>
              <li key={type} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">{t(`management.elements.${type}`)}</li>)}
          </ul>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('management.editor_handoff')}</p>
          {editorUrl ? <a href={editorUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg bg-[#0AACA5] px-4 py-2 text-sm font-semibold text-slate-950">{t('management.open_editor')}</a> : <p className="text-sm text-slate-500 dark:text-slate-400">{t('management.editor_unavailable')}</p>}
        </div> : <>
        <label className="block">{t('authoring.search')}<input autoFocus className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} /></label>
        {objectCategories.map(category => {
          const types = category.types.filter(type => t(`objects.${type}`).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
          if (!types.length) return null;
          return <section key={category.id} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t(`objects.category.${category.id}`)}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{types.map(type => {
              const supported = supportedCreationTypes.has(type);
              const enabled = supported && context?.creatable_types.includes(type);
              const Icon = type === 'fold' ? FolderPlus : type === 'file' ? FileText : Layers;
              return <button key={type} disabled={!enabled} title={!supported ? t('authoring.soon') : !enabled ? t('authoring.unavailable') : undefined}
                onClick={() => { if (type === 'fold' || type === 'file') void choose(type); }}
                className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-left hover:enabled:border-teal-500 disabled:text-slate-500 dark:disabled:text-slate-400">
                <Icon size={20} className={enabled ? 'text-teal-700 dark:text-teal-300' : ''} />
                <span>{t(`objects.${type}`)}{!enabled && <small className="block text-xs">{t(supported ? 'authoring.unavailable' : 'authoring.soon')}</small>}</span>
              </button>;
            })}</div>
          </section>;
        })}
        {!objectCategories.some(category => category.types.some(type => t(`objects.${type}`).toLocaleLowerCase().includes(search.toLocaleLowerCase()))) && <p>{t('authoring.empty')}</p>}
        </>}
      </> : <form id="object-creation-form" onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
        <fieldset disabled={busy || uncertain} className="min-w-0 space-y-4">
          {step === 'fold' ? <>
            <label className="block">{t('authoring.title')}<input autoFocus required maxLength={200} className={fieldClass} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label className="block">{t('authoring.description')}<textarea maxLength={4000} className={fieldClass} value={description} onChange={e => setDescription(e.target.value)} /></label>
            <label className="block">{t('authoring.view')}<select required disabled={!templates} className={fieldClass} value={template} onChange={e => setTemplate(e.target.value)}>
              {templates?.map(option => <option key={option.value} value={option.value}>{/^(default|standard)$/i.test(option.label) ? t('authoring.standard') : /^(hidden folder|versteckter ordner)$/i.test(option.label) ? t('authoring.hidden') : option.label}</option>)}
            </select></label>
          </> : <>
            <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-6 text-center"
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <Upload aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-teal-700 dark:text-teal-300" />
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t('authoring.drop_files')}</p>
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg border border-teal-600 dark:border-teal-400 px-4 py-2 text-sm font-semibold text-teal-800 dark:text-teal-200 hover:bg-teal-50 dark:hover:bg-teal-950/50">{t('authoring.browse_files')}</button>
              <input ref={fileInput} type="file" multiple hidden aria-label={t('authoring.browse_files')} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('authoring.select_limit')}</p>
            {queue.length > 0 && <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">{t('authoring.queue')}</span>
                <span role="status" className="tabular-nums text-slate-500 dark:text-slate-400">{t('authoring.queue_saved', { saved: queue.filter(item => item.status === 'saved').length, total: queue.length })}</span>
              </div>
              <ul className="space-y-2">{queue.map(item => {
                const Icon = item.status === 'saved' ? Check : item.status === 'failed' ? CircleAlert : FileText;
                return <li key={item.id} className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-700/80 dark:bg-slate-800/50">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.status === 'failed' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'}`}><Icon aria-hidden="true" size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span title={item.file.name} className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.file.name}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{(item.file.size / 1_000_000).toFixed(1)} MB</span>
                        {item.status === 'pending' && <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100" aria-label={t('authoring.remove', { name: item.file.name })}
                          onClick={() => setQueue(previous => previous.filter(other => other.id !== item.id))}><X size={14} /></button>}
                      </div>
                      <FileUploadProgress filename={item.file.name} status={item.status} progress={item.progress} />
                      {item.error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{item.error}</p>}
                    </div>
                  </div>
                </li>;
              })}</ul>
            </div>}
            <label className="block">{t('authoring.license')}<select required disabled={!licenses} aria-describedby="file-license-description" className={`${fieldClass} text-sm`} value={license} onChange={e => setLicense(e.target.value)}>
              {licenses?.map(option => {
                const info = describeFileLicense(option);
                return <option key={option.value} value={option.value}>{info.label}</option>;
              })}
            </select></label>
            {selectedLicense && <p id="file-license-description" className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{describeFileLicense(selectedLicense).description}</p>}
          </>}
        </fieldset>
      </form>}
    </div>
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 dark:border-slate-700 p-4">
      {step !== 'catalogue' && !uncertain && <button disabled={busy || loading} className={buttonClass} onClick={() => { setStep('catalogue'); setError(''); }}>{t('authoring.change_object')}</button>}
      <button disabled={busy} className={buttonClass} onClick={onClose}>{t('authoring.cancel')}</button>
      {step !== 'catalogue' && <span className="group relative inline-flex" tabIndex={busy || loading ? 0 : undefined}>
        <button type="submit" form="object-creation-form" className="rounded-lg bg-[#0AACA5] px-4 py-2 font-semibold text-slate-950 disabled:pointer-events-none disabled:opacity-50"
        disabled={busy || loading || uncertain || (step === 'file' && (!license || !queue.some(item => item.status === 'pending')))}>
        {t(step === 'fold' ? 'authoring.create' : 'authoring.upload')}</button>
        {(busy || loading) && <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-md bg-slate-900 dark:bg-slate-100 px-3 py-2 text-xs text-white dark:text-slate-900 shadow-lg group-hover:block group-focus:block">{t('authoring.busy')}</span>}
      </span>}
    </div>
  </dialog>;
}
