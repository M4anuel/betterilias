import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { browserStatisticsId, setBrowserStatistics } from '../lib/browserStatistics';
import { ToggleSwitch } from './ToggleSwitch';

export function BrowserStatisticsSettings() {
  useLanguage();
  const [enabled, setEnabled] = useState(() => !!browserStatisticsId());
  const [failed, setFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!detailsOpen) return;
    const dialog = detailsDialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, [detailsOpen]);
  useEffect(() => {
    const update = () => setEnabled(!!browserStatisticsId());
    window.addEventListener('storage', update);
    window.addEventListener('betterilias-browser-statistics', update);
    const timer = window.setInterval(update, 60000);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('betterilias-browser-statistics', update);
      window.clearInterval(timer);
    };
  }, []);
  return <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800" aria-labelledby="browser-statistics-title">
    <div className="flex items-center gap-1">
      <h3 id="browser-statistics-title" className="min-w-0 flex-1 text-xs font-bold text-slate-700 dark:text-slate-300">{t('statistics.title')}</h3>
      <button type="button" onClick={() => setDetailsOpen(true)} aria-label={t('statistics.details')} title={t('statistics.details')}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <ToggleSwitch checked={enabled} label={t('statistics.enable')} onChange={() => {
        const saved = setBrowserStatistics(!enabled);
        setFailed(!saved);
        setEnabled(!!browserStatisticsId());
      }} />
    </div>
    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{t('statistics.short_hint')}</p>
    {failed && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('statistics.storage_error')}</p>}
    {detailsOpen && createPortal(<dialog ref={detailsDialog} data-settings-owned aria-labelledby="browser-statistics-details-title"
      onCancel={event => { event.stopPropagation(); setDetailsOpen(false); }}
      className="m-auto flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/60 open:flex dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/50">
        <h2 id="browser-statistics-details-title" className="min-w-0 text-sm font-bold">{t('statistics.title')}</h2>
        <button type="button" aria-label={t('Schliessen')} onClick={() => setDetailsOpen(false)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div role="region" aria-label={t('statistics.details')} tabIndex={0} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        <p>{t('statistics.disclosure')}</p><p>{t('statistics.withdrawal')}</p>
      </div>
      <div className="flex shrink-0 justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
        <button type="button" onClick={() => setDetailsOpen(false)} className="min-h-11 rounded-xl bg-slate-200 px-4 py-1.5 text-xs font-bold dark:bg-slate-700">{t('Schliessen')}</button>
      </div>
    </dialog>, document.body)}
  </section>;
}
