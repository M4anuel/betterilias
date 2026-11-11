import { PlugZap, WifiOff, X } from 'lucide-react';
import { AuthStatus } from '../types';
import { t, useLanguage } from '../lib/i18n';
import { retryConnection, useConnectionIssue } from '../lib/connection';
import { useState, useEffect } from 'react';

export function ConnectionNotice({ auth, landing, onConnect }: { auth: AuthStatus | null; landing: boolean; onConnect: () => void }) {
  useLanguage();
  const issue = useConnectionIssue();
  const [retrying, setRetrying] = useState(false);
  const [dismissedReason, setDismissedReason] = useState<string | null>(null);
  const inactive = auth && !auth.authenticated;
  const reason = issue || (inactive ? auth.cookies_present ? 'expired' : 'signed_out' : null);

  useEffect(() => {
    if (!reason) {
      setDismissedReason(null);
    }
  }, [reason]);

  // Signing in is an expected first-visit action, not a landing-page warning.
  const visible = reason && (!landing || issue) && dismissedReason !== reason;
  return <><div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{visible ? `${t(`connection.${reason}.title`)}. ${t(`connection.${reason}.hint`)}` : ''}</div>
    {visible && <div data-connection-notice className="shrink-0 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1 sm:items-center">
        {issue ? <WifiOff aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-300" /> : <PlugZap aria-hidden="true" className="h-5 w-5 shrink-0 text-teal-700 dark:text-teal-300" />}
        <div><p className="text-sm font-semibold">{t(`connection.${reason}.title`)}</p><p className="text-xs text-slate-600 dark:text-slate-300">{t(`connection.${reason}.hint`)}</p></div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <button type="button" disabled={retrying} onClick={issue ? async () => { setRetrying(true); try { await retryConnection(); } finally { setRetrying(false); } } : onConnect} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-60 dark:text-teal-200 dark:hover:bg-teal-950">{t(retrying ? 'connection.retrying' : issue ? 'Erneut versuchen' : 'connection.connect')}</button>
        <button type="button" onClick={() => setDismissedReason(reason)} aria-label={t('Schliessen')} title={t('Schliessen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer focus-visible:outline-2">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>}</>;
}
