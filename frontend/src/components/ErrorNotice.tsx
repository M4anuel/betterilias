import { AlertCircle, X } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { authFailure, retryConnection, sharedFailure, useConnectionFailureSeq } from '../lib/connection';
import { useState, useEffect } from 'react';

/** Connection/auth failures have one persistent recovery action in the app shell. */
export function ErrorNotice({ message, onRetry, onDismiss, connectionInline = false, retryDisabled = false }: {
  message: string; onRetry?: () => void; onDismiss?: () => void; connectionInline?: boolean; retryDisabled?: boolean;
}) {
  useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const failureSeq = useConnectionFailureSeq();

  useEffect(() => {
    setDismissed(false);
  }, [message, failureSeq]);

  if (dismissed) return null;
  if (sharedFailure(message) && !connectionInline) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
    <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
    <div className="min-w-0 flex-1 break-words"><p className="font-semibold">{t('errors.title')}</p><p className="mt-1">{message}</p>
      {(onRetry || sharedFailure(message)) && <button type="button" disabled={retryDisabled} onClick={authFailure(message) ? () => window.dispatchEvent(new Event('betterilias-connect')) : onRetry || (() => { void retryConnection(); })} className="mt-2 min-h-11 rounded-lg px-3 font-semibold underline focus-visible:outline-2 disabled:opacity-60">{t(authFailure(message) ? 'connection.connect' : 'Erneut versuchen')}</button>}
    </div>
    <button type="button" onClick={handleDismiss} aria-label={t('Schliessen')} title={t('Schliessen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900 focus-visible:outline-2 cursor-pointer"><X aria-hidden="true" className="h-4 w-4" /></button>
  </div>;
}
