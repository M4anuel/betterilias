import { useEffect, useRef } from 'react';
import { FileSearch, X } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { clearDiagnosticNotice, decideDiagnostic, dismissDiagnostic, useDiagnosticConsent } from '../lib/diagnosticReports';

export function DiagnosticConsent() {
  useLanguage();
  const state = useDiagnosticConsent();
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!state.capture) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [state.capture?.capture_id]);
  const button = 'min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  if (!state.capture) return state.saved ? <div role="status" className="fixed bottom-5 left-1/2 z-[70] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-teal-200 bg-white p-4 text-sm text-slate-800 shadow-lg dark:border-teal-800 dark:bg-slate-900 dark:text-slate-100">
    <span className="min-w-0 flex-1">{t('reports.saved')}</span><button type="button" onClick={clearDiagnosticNotice} aria-label={t('Schliessen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"><X size={18} /></button>
  </div> : null;
  return <dialog ref={dialog} aria-labelledby="diagnostic-consent-title" aria-describedby="diagnostic-consent-description"
    onCancel={event => { event.preventDefault(); dismissDiagnostic(); }}
    className="m-auto max-h-[90dvh] w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-black/60 open:flex open:flex-col dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-2"><FileSearch className="mt-1 shrink-0 text-teal-600 dark:text-teal-400" size={24} aria-hidden="true" />
      <h2 id="diagnostic-consent-title" className="min-w-0 flex-1 text-lg font-bold">{t('reports.prompt_title')}</h2>
      <button type="button" disabled={state.busy} onClick={dismissDiagnostic} aria-label={t('Schliessen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
    </div>
    <div tabIndex={0} role="region" aria-label={t('reports.details')} className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
    <p id="diagnostic-consent-description" className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('reports.prompt_intro')}</p>
    <p className="mt-3 text-sm leading-relaxed">{t('reports.operator', { name: state.capture.disclosure.operator_name || t('reports.local_operator') })}</p>
    <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.pending_hint')}</p>
    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300"><li>{t('reports.included')}</li><li>{t('reports.excluded')}</li><li>{t('reports.retention')}</li></ul>
    <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.preference_hint')}</p>
    {state.capture.disclosure.privacy_url && <a href={state.capture.disclosure.privacy_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-teal-700 underline dark:text-teal-300">{t('reports.privacy_notice')}</a>}
    <p className="mt-3 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{t('reports.code', { code: state.capture.code })}</p>
    </div>
    <div className="shrink-0 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    {state.error && <p role="alert" className="mt-4 text-sm text-amber-700 dark:text-amber-300">{t(state.error as TranslationKey)}</p>}
    {state.busy && <p role="status" className="mt-4 text-sm">{t('reports.sending')}</p>}
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <button type="button" autoFocus disabled={state.busy} className={button} onClick={dismissDiagnostic}>{t('reports.no')}</button>
      <button type="button" disabled={state.busy} className={button} onClick={() => void decideDiagnostic('once')}>{t('reports.once')}</button>
      <button type="button" disabled={state.busy} className={button + ' col-span-2 sm:col-span-1'} onClick={() => void decideDiagnostic('always')}>{t('reports.always')}</button>
    </div>
    </div>
  </dialog>;
}
