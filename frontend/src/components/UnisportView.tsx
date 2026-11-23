import { useEffect, useRef, useState } from 'react';
import { Dumbbell, LoaderCircle } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportCompanion, unisportCredential, unisportFetch } from '../lib/unisport';
import { Button } from './ui/Button';
import { ErrorNotice } from './ErrorNotice';
import { UnisportCatalogue } from './UnisportCatalogue';
import { clearPrivate, readPrivate, writePrivate } from '../lib/unisportCache';
import { unisportDate } from '../lib/unisportOffers';

type Connection = { phase: 'disconnected' | 'pending' | 'exchanging' | 'connected'; affiliation: string | null; scope?: string | null };
type Application = { id?: number; title?: string; registration?: string; begin?: string; end?: string; offerNextDate?: { begin?: string; end?: string } };

/** UniSport owns its capability, loading/error state and explicit affiliation draft. */
export function UnisportView() {
  const language = useLanguage();
  const [credential] = useState(unisportCredential);
  const [connection, setConnection] = useState<Connection>({ phase: 'disconnected', affiliation: null });
  const [choices, setChoices] = useState<string[]>([]);
  const [choice, setChoice] = useState('');
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [applicationsScope, setApplicationsScope] = useState('');
  const [applicationsAt, setApplicationsAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const mounted = useRef(false);
  const waiting = connection.phase === 'pending' || connection.phase === 'exchanging';
  const locale = language === 'de' ? 'de' : 'en';
  const personalScope = JSON.stringify([connection.scope, connection.affiliation, locale]);
  const visibleApplications = personalScope === applicationsScope ? applications : null;
  const previousAccount = useRef<string | null>(null);

  useEffect(() => {
    if (previousAccount.current && connection.scope && previousAccount.current !== connection.scope) clearPrivate();
    previousAccount.current = connection.scope || null;
    setApplications(null); setApplicationsAt(null); setApplicationsScope(personalScope);
    if (connection.scope && connection.affiliation) {
      const cached = readPrivate<Application[]>(connection.scope, connection.affiliation, 'applications', locale);
      if (cached && Array.isArray(cached.data)) { setApplications(cached.data); setApplicationsAt(cached.fetched_at); }
    }
  }, [personalScope]);

  async function refresh(sequence = generation.current) {
    const next = await unisportFetch<Connection>('/connection', credential);
    if (!mounted.current || sequence !== generation.current) return;
    setConnection(next);
    if (next.phase === 'connected') {
      const result = await unisportFetch<{ affiliations: string[] }>('/affiliations', credential);
      if (!mounted.current || sequence !== generation.current) return;
      setChoices(result.affiliations);
      setChoice(previous => previous && result.affiliations.includes(previous) ? previous : next.affiliation || '');
    } else { setChoices([]); setChoice(''); setApplications(null); }
  }

  async function run(action: (sequence: number) => Promise<void>) {
    const sequence = ++generation.current;
    setBusy(true); setError('');
    try { await action(sequence); }
    catch (failure) { if (mounted.current && sequence === generation.current) setError(failure instanceof Error ? failure.message : t('unisport.read_failed')); }
    finally { if (mounted.current && sequence === generation.current) setBusy(false); }
  }

  useEffect(() => {
    mounted.current = true;
    void run(sequence => refresh(sequence));
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'UNISPORT_FINISHED') return;
      void run(async sequence => {
        await refresh(sequence);
        const next = await unisportFetch<Connection>('/connection', credential);
        if (sequence === generation.current && next.phase !== 'connected') throw new Error(t('unisport.login_failed'));
      });
    };
    window.addEventListener('message', listener);
    const changed = () => { void run(sequence => refresh(sequence)); };
    window.addEventListener('unisport-connection-changed', changed);
    return () => { mounted.current = false; ++generation.current; window.removeEventListener('message', listener); window.removeEventListener('unisport-connection-changed', changed); };
  }, [credential, language]);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      const sequence = generation.current;
      void unisportFetch<Connection>('/connection', credential).then(async next => {
        if (!mounted.current || sequence !== generation.current) return;
        if (next.phase === 'connected') { setError(''); await refresh(sequence); }
        else if (next.phase === 'disconnected') { setConnection(next); setError(t('unisport.login_failed')); }
      }).catch(() => { /* Explicit retry remains available; do not erase pending state on a transient network failure. */ });
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, credential, language]);

  const connect = () => void run(async sequence => {
    await unisportCompanion({ type: 'UNISPORT_PING' });
    const transaction = await unisportFetch<{ authorization_url: string; state: string }>('/auth/start', credential, 'POST');
    if (!mounted.current || sequence !== generation.current) return;
    await unisportCompanion({ type: 'UNISPORT_START', ...transaction, credential });
    await refresh(sequence);
  });
  const disconnect = () => void run(async sequence => {
    await unisportFetch('/connection', credential, 'DELETE');
    clearPrivate();
    void unisportCompanion({ type: 'UNISPORT_CANCEL' }).catch(() => {});
    if (!mounted.current || sequence !== generation.current) return;
    setApplications(null); setChoice(''); setChoices([]);
    setConnection({ phase: 'disconnected', affiliation: null });
  });

  return <section className="mx-auto w-full max-w-4xl space-y-5 p-4 text-slate-800 sm:p-6 dark:text-slate-100" aria-labelledby="unisport-title">
    <header className="space-y-2">
      <h1 id="unisport-title" className="flex items-center gap-3 text-2xl font-bold"><Dumbbell aria-hidden="true" />{t('unisport.title')}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.prototype')}</p>
    </header>
    {error && <ErrorNotice message={error} connectionInline onRetry={() => void run(sequence => refresh(sequence))} retryDisabled={busy} />}
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p role="status" className="flex items-center gap-2 font-semibold">
        {(waiting || busy) && <LoaderCircle size={18} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
        {t(waiting ? 'unisport.waiting' : connection.phase === 'connected' ? 'unisport.connected' : 'unisport.disconnected')}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.login_hint')}</p>
      <div className="flex flex-wrap gap-2">
        {!waiting && <Button variant="primary" loading={busy} onClick={connect}>{t(connection.phase === 'connected' ? 'unisport.reconnect' : 'unisport.connect')}</Button>}
        {(waiting || connection.phase === 'connected') && <Button disabled={busy} onClick={disconnect}>{t(waiting ? 'unisport.cancel' : 'unisport.disconnect')}</Button>}
      </div>
      {connection.phase === 'connected' && <form className="space-y-3" action="/api/unisport/affiliation" method="post" onSubmit={event => {
        event.preventDefault();
        void run(async sequence => {
          await unisportFetch('/affiliation', credential, 'PUT', { affiliation: choice });
          if (!mounted.current || sequence !== generation.current) return;
          setApplications(null); await refresh(sequence);
        });
      }}>
        <div className="space-y-1 text-sm">
          <label className="block font-semibold" htmlFor="unisport-affiliation">{t('unisport.affiliation')}</label>
          <select id="unisport-affiliation" name="affiliation" required value={choice} onChange={event => setChoice(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-600 dark:bg-slate-950">
            <option value="">{t('unisport.choose_affiliation')}</option>
            {choices.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {!choices.length && <p className="text-sm">{t('unisport.no_affiliations')}</p>}
        <Button type="submit" loading={busy}>{t('unisport.save_affiliation')}</Button>
      </form>}
    </div>
    <UnisportCatalogue credential={credential} scope={connection.phase === 'connected' ? connection.scope : null} affiliation={connection.affiliation} />
    {connection.phase === 'connected' && connection.affiliation && <div className="space-y-3">
      <h2 className="text-lg font-bold">{t('unisport.applications')}</h2>
      <Button loading={busy} onClick={() => void run(async sequence => {
        const result = await unisportFetch<Application[]>('/applications', credential, 'GET', undefined, undefined, connection.scope || undefined);
        if (mounted.current && sequence === generation.current) {
          setApplications(result); setApplicationsScope(personalScope);
          setApplicationsAt(connection.scope && connection.affiliation
            ? writePrivate(connection.scope, connection.affiliation, 'applications', locale, result) : Date.now() / 1000);
        }
      })}>{t('unisport.load_applications')}</Button>
      {visibleApplications !== null && applicationsAt && <p className="text-xs text-slate-500 dark:text-slate-400">{t('unisport.cached_at', { time: unisportDate(new Date(applicationsAt * 1000).toISOString(), locale) })}</p>}
      {visibleApplications !== null && (visibleApplications.length ? <ul className="space-y-2">{visibleApplications.map((item, index) => <li key={`${item.id}-${index}`}
        className="space-y-1 break-words rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="font-semibold">{item.title || t('unisport.offer')}</h3>
        {(item.begin || item.offerNextDate?.begin) && <p className="text-sm">{unisportDate(item.begin || item.offerNextDate?.begin || '', locale)}</p>}
        {typeof item.registration === 'string' && item.registration && <p className="text-sm">{item.registration}</p>}
      </li>)}</ul> : <p className="text-sm">{t('unisport.no_applications')}</p>)}
    </div>}
  </section>;
}
