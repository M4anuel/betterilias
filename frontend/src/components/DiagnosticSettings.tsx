import { useEffect, useState } from 'react';
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
  return <section className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700" aria-labelledby="reporting-settings-title">
    <h3 id="reporting-settings-title" className="text-sm font-bold">{t('reports.settings_title')}</h3>
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.settings_hint')}</p>
    {disclosure && !disclosure.available && <p role="status" className="text-xs">{t('reports.not_configured')}</p>}
    {disclosure?.available && <>
      <p className="text-xs leading-relaxed">{t('reports.operator', { name: disclosure.operator_name || t('reports.local_operator') })}</p>
      {disclosure.privacy_url && <a href={disclosure.privacy_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-xs font-semibold text-teal-700 underline dark:text-teal-300">{t('reports.privacy_notice')}</a>}
      <details className="text-xs leading-relaxed"><summary className="min-h-11 cursor-pointer py-3 font-semibold">{t('reports.details')}</summary>
        <p className="mb-2">{t('reports.included')}</p><p className="mb-2">{t('reports.excluded')}</p><p>{t('reports.retention')}</p>
      </details>
    </>}
    <label htmlFor="diagnostic-sharing" className="block text-xs font-semibold">{t('reports.sharing')}</label>
    <select id="diagnostic-sharing" disabled={loading || busy || !disclosure} value={mode} onChange={event => void change(event.target.value as ReportingMode)}
      className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-base dark:border-slate-600 dark:bg-slate-800">
      <option value="ask">{t('reports.mode_ask')}</option><option value="always" disabled={!disclosure?.available}>{t('reports.mode_always')}</option><option value="never">{t('reports.mode_never')}</option>
    </select>
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.preference_hint')}</p>
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.delete_hint')}</p>
    {confirmDelete ? <div className="space-y-2 rounded-xl border border-amber-200 p-3 dark:border-amber-800">
      <p className="text-xs">{t('reports.delete_confirm')}</p><div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-600">{t('reports.delete_now')}</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg px-3 text-xs">{t('Abbrechen')}</button>
      </div></div> : <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600">{t('reports.delete_button')}</button>}
    {loading && <p role="status" className="text-xs">{t('reports.loading')}</p>}
    {busy && <p role="status" className="text-xs">{t('reports.sending')}</p>}
    {message && <p role={message === 'reports.unavailable' ? 'alert' : 'status'} className="text-xs leading-relaxed">{t(message as TranslationKey)}</p>}
  </section>;
}
