import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { t } from '../lib/i18n';
import { unisportCompanionRequest } from '../lib/unisport';
import { clearParticipantCache } from '../lib/unisportParticipants';
import { Button } from './ui/Button';
import { ErrorNotice } from './ErrorNotice';

/** The API affiliation and SWITCH's website identity are separate service choices. */
export function UnisportWebsiteLogin({ scope, affiliation, course, onComplete }: {
  scope: string; affiliation: string; course?: string; onComplete?: () => void;
}) {
  const [waiting, setWaiting] = useState(false), [returned, setReturned] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), generation = useRef(0), complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    ++generation.current; pending.current = false; setWaiting(false); setReturned(false); setError('');
    const reset = () => { ++generation.current; pending.current = false; setWaiting(false); setReturned(false); };
    const listener = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || message?.type !== 'UNISPORT_PARTICIPANTS_LOGIN_FINISHED'
          || message.scope !== scope || message.affiliation !== affiliation || !pending.current) return;
      pending.current = false; setWaiting(false);
      if (!message.success) { setError(t('unisport.website_login_cancelled')); return; }
      clearParticipantCache(); setError(''); setReturned(true); complete.current?.();
    };
    window.addEventListener('message', listener); window.addEventListener('unisport-private-cache-cleared', reset);
    return () => { ++generation.current; pending.current = false; window.removeEventListener('message', listener); window.removeEventListener('unisport-private-cache-cleared', reset); };
  }, [scope, affiliation, course]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => { pending.current = false; setWaiting(false); setError(t('unisport.website_login_cancelled')); }, 600000);
    return () => clearTimeout(timer);
  }, [waiting]);
  async function start() {
    const sequence = ++generation.current;
    pending.current = true; setWaiting(true); setReturned(false); setError('');
    try {
      await unisportCompanionRequest({ type: 'UNISPORT_PARTICIPANTS_LOGIN', scope, affiliation, ...(course ? { course } : {}) }, 5000);
    } catch (failure) {
      if (sequence === generation.current) { pending.current = false; setWaiting(false); setError(failure instanceof Error ? failure.message : t('unisport.participants_unavailable')); }
    }
  }
  return <div className="space-y-2">
    <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.website_login_hint')}</p>
    <Button loading={waiting} onClick={() => void start()} className="min-h-12"><ExternalLink size={16} aria-hidden="true" />{t('unisport.website_login')}</Button>
    {waiting && <p role="status" className="text-sm">{t('unisport.website_login_waiting')}</p>}
    {returned && <p role="status" className="text-sm">{t('unisport.website_login_returned')}</p>}
    {error && <ErrorNotice message={error} connectionInline />}
  </div>;
}
