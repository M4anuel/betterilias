import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { cache } from '../lib/cache';
import { confirmDialog } from '../lib/dialog';
import { unisportFetch } from '../lib/unisport';
import { Button } from './ui/Button';
import { ErrorNotice } from './ErrorNotice';

export function UnisportIliasConnection({ credential, scope, affiliation }: { credential: string; scope: string; affiliation: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [user, setUser] = useState('');
  const generation = useRef(0), pending = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => {
    ++generation.current; pending.current = false; setBusy(false); setError(''); setUser('');
    return () => { ++generation.current; pending.current = false; request.current?.abort(); };
  }, [credential, scope, affiliation]);
  async function connect() {
    if (pending.current) return;
    pending.current = true;
    const sequence = ++generation.current, previousSession = cache.getSessionId();
    setBusy(true); setError(''); setUser('');
    try {
      if (sequence !== generation.current) return;
      if (cache.getSessionId() !== previousSession) throw new Error(t('unisport.ilias_context_changed'));
      const controller = new AbortController(); request.current = controller;
      const result = await unisportFetch<{ authenticated: boolean; session_id: string; user_name: string; renewed: boolean }>('/ilias-connection',
        credential, 'POST', undefined, controller.signal, scope, affiliation, previousSession);
      if (sequence !== generation.current) return;
      if (cache.getSessionId() !== previousSession) throw new Error(t('unisport.ilias_context_changed'));
      if (result.authenticated !== true || !/^[A-Za-z0-9_-]{43}$/.test(result.session_id || '') || typeof result.user_name !== 'string')
        throw new Error(t('unisport.ilias_connect_failed'));
      if (previousSession && result.session_id !== previousSession && !await confirmDialog({ title: t('unisport.ilias_connect'),
          message: t('unisport.ilias_replace_confirm', { name: result.user_name }),
          confirmLabel: t('unisport.ilias_connect'), variant: 'warning' })) return;
      if (sequence !== generation.current) return;
      if (cache.getSessionId() !== previousSession) throw new Error(t('unisport.ilias_context_changed'));
      try { localStorage.setItem('betterilias_ilias_source', 'unisport'); }
      catch { throw new Error(t('unisport.ilias_connect_failed')); }
      setUser(result.user_name);
      // Verified renewals retain the same cache owner; actual account switches
      // keep the existing isolation path. Provider credentials stay server-side.
      document.dispatchEvent(new CustomEvent('BETTERILIAS_SESSION_SYNCED', { detail: { sessionId: result.session_id, source: 'unisport', renewed: result.renewed === true } }));
    } catch (failure) {
      if (sequence === generation.current) setError(failure instanceof Error && !(failure instanceof DOMException) && !(failure instanceof TypeError)
        ? failure.message : t('unisport.ilias_connect_failed'));
    } finally {
      if (sequence === generation.current) { pending.current = false; request.current = null; setBusy(false); }
    }
  }
  return <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
    <h2 className="font-semibold">{t('unisport.ilias_connect')}</h2>
    <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.ilias_connect_hint')}</p>
    <Button loading={busy} onClick={() => void connect()} className="min-h-12">{t('unisport.ilias_connect')}</Button>
    {busy && <p role="status" className="text-sm">{t('unisport.ilias_connect_pending')}</p>}
    {user && <p role="status" className="text-sm">{t('unisport.ilias_connect_success', { name: user })}</p>}
    {error && <ErrorNotice message={error} connectionInline />}
  </div>;
}
