import { FeedbackBanner } from './ui/FeedbackBanner';
import { Button } from './ui/Button';
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

  return <FeedbackBanner tone="error" title={t('errors.title')} message={message} onDismiss={handleDismiss}
    actions={(onRetry || sharedFailure(message)) && <Button variant="ghost" disabled={retryDisabled}
      onClick={authFailure(message) ? () => window.dispatchEvent(new Event('betterilias-connect')) : onRetry || (() => { void retryConnection(); })}
      className="underline">{t(authFailure(message) ? 'connection.connect' : 'Erneut versuchen')}</Button>} />;
}
