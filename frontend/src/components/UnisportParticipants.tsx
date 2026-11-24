import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportParticipantsUrl, unisportDate } from '../lib/unisportOffers';
import { clearParticipantCache, filterParticipants, loadParticipants, participantContext, ParticipantSnapshot } from '../lib/unisportParticipants';
import { Button } from './ui/Button';
import { DialogShell } from './ui/DialogShell';
import { ErrorNotice } from './ErrorNotice';
import { UnisportWebsiteLogin } from './UnisportWebsiteLogin';
import { UnisportCompanionError } from '../lib/unisport';

export function UnisportParticipants({ offerUrl, scope, affiliation }: { offerUrl?: string | null; scope: string; affiliation: string }) {
  const language = useLanguage(), id = useId();
  const href = unisportParticipantsUrl(offerUrl), course = href?.split('/').at(-2);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState('');
  const [snapshot, setSnapshot] = useState<ParticipantSnapshot | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const sequence = useRef(0), identity = useRef(''), mounted = useRef(false);
  const contextKey = JSON.stringify([scope, affiliation, course]);
  const rows = useMemo(() => filterParticipants(snapshot?.items || [], query), [snapshot, query]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sequence.current; }; }, []);
  useEffect(() => { ++sequence.current; identity.current = ''; setSnapshot(null); setError(''); setBusy(false); setOpen(false); }, [contextKey]);
  async function load(force = false) {
    if (!course) return;
    const current = ++sequence.current;
    setBusy(true); setError(''); setLoginRequired(false);
    try {
      const context = await participantContext(scope, affiliation);
      if (!mounted.current || current !== sequence.current) return;
      if (identity.current !== context) setSnapshot(null);
      identity.current = context;
      const next = await loadParticipants(scope, affiliation, course, context, force);
      if (mounted.current && current === sequence.current) setSnapshot(next);
    } catch (failure) {
      if (mounted.current && current === sequence.current) { setSnapshot(null); setLoginRequired(failure instanceof UnisportCompanionError && failure.code === 'participants_login_required'); setError(failure instanceof Error ? failure.message : t('unisport.participants_read_failed')); }
    } finally { if (mounted.current && current === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    if (!open) return;
    const privateCleared = () => { ++sequence.current; setSnapshot(null); setBusy(false); setError(t('unisport.participants_session_changed')); };
    const changed = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'UNISPORT_PARTICIPANTS_COOKIES_CHANGED') return;
      const observed = sequence.current;
      void participantContext(scope, affiliation).then(context => {
        if (mounted.current && observed === sequence.current && identity.current && identity.current !== context) { clearParticipantCache(); identity.current = context; privateCleared(); }
      }).catch(() => { if (mounted.current && observed === sequence.current) privateCleared(); });
    };
    window.addEventListener('message', changed); window.addEventListener('unisport-private-cache-cleared', privateCleared);
    return () => { window.removeEventListener('message', changed); window.removeEventListener('unisport-private-cache-cleared', privateCleared); };
  }, [open, contextKey, language]);
  if (!href) return null;
  return <>
    <Button onClick={() => { setOpen(true); void load(); }}>{t('unisport.participants')}</Button>
    {open && <DialogShell title={t('unisport.participants')} onRequestClose={() => { ++sequence.current; setOpen(false); setBusy(false); }}>
      <div className="space-y-3">
        <search className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor={id} className="mb-1 block text-sm font-semibold">{t('unisport.participants_search')}</label>
            <input id={id} name="participants-search" type="search" autoFocus value={query} onChange={event => setQuery(event.target.value)} maxLength={200}
              className="min-h-12 w-full rounded-xl border border-slate-400 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-500 dark:bg-slate-950" />
          </div>
          <Button loading={busy} onClick={() => void load(true)} className="min-h-12"><RefreshCw size={16} aria-hidden="true" />{t('unisport.refresh')}</Button>
        </search>
        {busy && <p role="status" className="text-sm">{t('unisport.participants_loading')}</p>}
        {error && !loginRequired && <ErrorNotice message={error} connectionInline onRetry={() => void load(true)} retryDisabled={busy} />}
        {loginRequired && <p role="status" className="text-sm">{error}</p>}
        {loginRequired && <UnisportWebsiteLogin scope={scope} affiliation={affiliation} course={course} onComplete={() => void load(true)} />}
        {snapshot && <>
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('unisport.cached_at', { time: unisportDate(new Date(snapshot.fetched_at * 1000).toISOString(), language) })}</p>
          <p role="status" className="text-sm">{t('unisport.participants_count', { shown: rows.length, total: snapshot.items.length })}</p>
          <div role="region" aria-label={t('unisport.participants')} tabIndex={0} className="relative max-h-[min(50dvh,28rem)] overflow-auto overscroll-contain rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-700">
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">{t('unisport.participants')}</caption>
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800"><tr>
                <th scope="col" className="w-2/5 p-3">{t('unisport.participants_name')}</th><th scope="col" className="p-3">{t('unisport.offer')}</th>
              </tr></thead>
              <tbody>{rows.map((row, index) => <tr key={index}>
                <th scope="row" className="border-t border-slate-200 p-3 align-top font-normal [overflow-wrap:anywhere] dark:border-slate-700"><span className="block font-semibold">{row.last_name}</span><span className="block">{row.first_name}</span></th>
                <td className="border-t border-slate-200 p-3 align-top [overflow-wrap:anywhere] dark:border-slate-700">{row.offer}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!rows.length && <p className="text-sm">{t(snapshot.items.length ? 'unisport.participants_no_matches' : 'unisport.participants_empty')}</p>}
        </>}
        <a href={href} target="_blank" rel="noopener noreferrer" className="relative inline-flex min-h-12 items-center gap-2 rounded-lg text-sm font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 dark:text-teal-300">
          {t('unisport.participants_official')}<ExternalLink size={16} aria-hidden="true" /><span className="sr-only">{t('unisport.new_tab')}</span>
        </a>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('unisport.participants_hint')}</p>
      </div>
    </DialogShell>}
  </>;
}
