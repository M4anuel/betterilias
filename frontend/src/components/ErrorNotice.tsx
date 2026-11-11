import { AlertCircle, X } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { authFailure, retryConnection, sharedFailure } from '../lib/connection';

/** Connection/auth failures have one persistent recovery action in the app shell. */
export function ErrorNotice({ message, onRetry, onDismiss, connectionInline = false, retryDisabled = false }: {
  message: string; onRetry?: () => void; onDismiss?: () => void; connectionInline?: boolean; retryDisabled?: boolean;
}) {
  useLanguage();
  if (sharedFailure(message) && !connectionInline) return null;
  return <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
    <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
    <div className="min-w-0 flex-1 break-words"><p className="font-semibold">{t('errors.title')}</p><p className="mt-1">{message}</p>
      {(onRetry || sharedFailure(message)) && <button type="button" disabled={retryDisabled} onClick={authFailure(message) ? () => window.dispatchEvent(new Event('betterilias-connect')) : onRetry || (() => { void retryConnection(); })} className="mt-2 min-h-11 rounded-lg px-3 font-semibold underline focus-visible:outline-2 disabled:opacity-60">{t(authFailure(message) ? 'connection.connect' : 'Erneut versuchen')}</button>}
    </div>
    {onDismiss && <button type="button" onClick={onDismiss} aria-label={t('Schliessen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900 focus-visible:outline-2"><X aria-hidden="true" className="h-4 w-4" /></button>}
  </div>;
}
