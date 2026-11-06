import { useEffect, useState } from 'react';
import { Info, X, ExternalLink } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { cache } from '../lib/cache';
import { reportingRequest, setReportingMode } from '../lib/diagnosticReports';
import type { ReportingMode, ReportingDisclosure } from '../lib/diagnosticReports';

export function DiagnosticSettings() {
  useLanguage();
  const [mode, setMode] = useState<ReportingMode>('ask');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [disclosure, setDisclosure] = useState<ReportingDisclosure | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const owner = cache.getSessionId();

  useEffect(() => {
    let live = true;
    const load = () => {
      if (!owner) { setLoading(false); return; }
      setLoading(true);
      void reportingRequest<ReportingDisclosure>('preference').then(result => { if (live) { setMode(result.mode); setDisclosure(result); } })
        .catch(() => { if (live) setMessage('reports.unavailable'); })
        .finally(() => { if (live) setLoading(false); });
    };
    load(); window.addEventListener('diagnostic-preference-changed', load);
    return () => { live = false; window.removeEventListener('diagnostic-preference-changed', load); };
  }, [owner]);

  if (!owner) return null;

  async function change(value: ReportingMode) {
    setBusy(true); setMessage('');
    try { const result = await setReportingMode(value); setMode(result.mode); setMessage('reports.preference_saved'); }
    catch { setMessage('reports.unavailable'); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setMessage('');
    try { await reportingRequest('reports', { method: 'DELETE' }); setConfirmDelete(false); setMessage('reports.deleted'); }
    catch { setMessage('reports.unavailable'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
      {/* Title with full width and info button */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor="diagnostic-sharing" className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {t('reports.settings_title')}
          </label>
          <button
            type="button"
            onClick={() => setIsDetailsOpen(true)}
            className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition shrink-0 cursor-pointer"
            aria-label={t('reports.details')}
            title={t('reports.details')}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Full width dropdown */}
      <select
        id="diagnostic-sharing"
        aria-label={t('reports.sharing')}
        disabled={loading || busy || !disclosure}
        value={mode}
        onChange={event => void change(event.target.value as ReportingMode)}
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:border-[#0AACA5] focus:outline-hidden transition cursor-pointer"
      >
        <option value="ask">{t('reports.mode_ask')}</option>
        <option value="always" disabled={!disclosure?.available}>{t('reports.mode_always')}</option>
        <option value="never">{t('reports.mode_never')}</option>
      </select>

      {/* Short description */}
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {t('reports.settings_hint')}
      </p>

      {loading && <p role="status" className="text-[11px] text-slate-400">{t('reports.loading')}</p>}
      {busy && <p role="status" className="text-[11px] text-slate-400">{t('reports.sending')}</p>}
      {message && (
        <p role={message === 'reports.unavailable' ? 'alert' : 'status'} className="text-[11px] leading-tight text-teal-600 dark:text-teal-400">
          {t(message as TranslationKey)}
        </p>
      )}

      {/* Info Dialog */}
      {isDetailsOpen && (
        <dialog
          open
          aria-labelledby="diagnostic-details-title"
          onCancel={() => setIsDetailsOpen(false)}
          className="app-overlay fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-slate-900/60 p-4 backdrop-blur-xs flex z-50"
        >
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-[#0AACA5]" />
                <h3 id="diagnostic-details-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('reports.settings_title')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                aria-label={t('Schliessen')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {disclosure && !disclosure.available && (
                <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {t('reports.not_configured')}
                </p>
              )}
              {disclosure?.available && (
                <div className="space-y-1">
                  <p>{t('reports.operator', { name: disclosure.operator_name || t('reports.local_operator') })}</p>
                  {disclosure.privacy_url && (
                    <a
                      href={disclosure.privacy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-teal-600 dark:text-teal-400 underline"
                    >
                      <span>{t('reports.privacy_notice')}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-100 dark:border-slate-700/80 space-y-2">
                <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                  {t('reports.details')}
                </h4>
                <p>{t('reports.included')}</p>
                <p>{t('reports.excluded')}</p>
                <p>{t('reports.retention')}</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('reports.delete_hint')}
                </p>
                {confirmDelete ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 dark:border-amber-800 p-3 bg-amber-50/50 dark:bg-amber-950/20">
                    <p className="text-xs text-amber-900 dark:text-amber-200 font-semibold">{t('reports.delete_confirm')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove()}
                        className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 transition cursor-pointer"
                      >
                        {t('reports.delete_now')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      >
                        {t('Abbrechen')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                    className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                  >
                    {t('reports.delete_button')}
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition cursor-pointer"
              >
                {t('Schliessen')}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
