import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Compass, Dumbbell, Heart, LayoutGrid, LoaderCircle, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportCompanion, unisportCredential, unisportFetch } from '../lib/unisport';
import { Button, IconButton } from './ui/Button';
import { ErrorNotice } from './ErrorNotice';
import { UnisportCatalogue } from './UnisportCatalogue';
import { clearPrivate, readPrivate, writePrivate } from '../lib/unisportCache';
import { applicationStart, instant, type SportRoute, type SportView, type UnisportApplication as Application, UnisportOffer, unisportDate } from '../lib/unisportOffers';
import { RegistrationAction } from './UnisportSession';
import { navigationGuard } from '../lib/navigationGuard';
import { UnisportParticipants } from './UnisportParticipants';
import { UnisportWebsiteLogin } from './UnisportWebsiteLogin';
import { UnisportIliasConnection } from './UnisportIliasConnection';

type Connection = { phase: 'disconnected' | 'pending' | 'exchanging' | 'connected'; affiliation: string | null; scope?: string | null };
const views = [
  ['overview', LayoutGrid], ['explore', Compass], ['schedule', CalendarDays], ['my_sport', Heart],
] as const;

/** UniSport owns its capability, loading/error state and explicit affiliation draft. */
export function UnisportView({ route, onNavigate }: { route?: SportRoute; onNavigate?: (route: SportRoute) => void }) {
  const legacyLogin = new URLSearchParams(location.search).has('legacy-unisport-login');
  const language = useLanguage();
  const [localRoute, setLocalRoute] = useState<SportRoute>({ view: 'overview' });
  const { view, selection } = route ?? localRoute;
  const navigate = onNavigate ?? setLocalRoute;
  const setView = (view: SportView) => navigate({ view });
  const [credential, setCredential] = useState(unisportCredential);
  const [connection, setConnection] = useState<Connection>({ phase: 'disconnected', affiliation: null });
  useEffect(() => {
    const selected = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'UNIBE_CONNECTION_SELECTED') {
        const selected = unisportCredential();
        if (selected !== credential) {
          ++generation.current;
          clearPrivate();setConnection({ phase: 'disconnected', affiliation: null });
          setChoices([]);setChoice('');setApplications(null);setCredential(selected);
        }
      }
    };
    window.addEventListener('message', selected);
    const loggedOut=()=>{
      ++generation.current;clearPrivate();setConnection({phase:'disconnected',affiliation:null});
      setChoices([]);setChoice('');setApplications(null);setCredential(unisportCredential());
    };
    window.addEventListener('betterilias-logged-out',loggedOut);
    return () => {window.removeEventListener('message', selected);window.removeEventListener('betterilias-logged-out',loggedOut);};
  }, [credential]);
  const [choices, setChoices] = useState<string[]>([]);
  const [choice, setChoice] = useState('');
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [applicationsScope, setApplicationsScope] = useState('');
  const [applicationsAt, setApplicationsAt] = useState<number | null>(null);
  const [applicationError, setApplicationError] = useState('');
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationRefresh, setApplicationRefresh] = useState(0);
  const [applicationsChanged, setApplicationsChanged] = useState(false);
  const [catalogueOffers, setCatalogueOffers] = useState<UnisportOffer[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const mounted = useRef(false);
  const waiting = connection.phase === 'pending' || connection.phase === 'exchanging';
  const locale = language === 'de' ? 'de' : 'en';
  const personalScope = JSON.stringify([connection.scope, connection.affiliation, locale]);
  const visibleApplications = personalScope === applicationsScope ? applications : null;
  const previousAccount = useRef<string | null>(null);
  const officialOffers = useMemo(() => new Map(catalogueOffers.map(offer => [offer.id, offer.url])), [catalogueOffers]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.scope !== connection.scope || detail?.affiliation !== connection.affiliation) return;
      // Preserve the mounted cancellation dialog and its confirmation/draft.
      // Confirmed operations refresh after the dialog closes.
      setApplicationsAt(null); setApplicationsChanged(true);
    };
    window.addEventListener('unisport-booking-changed', listener);
    return () => window.removeEventListener('unisport-booking-changed', listener);
  }, [personalScope]);

  useEffect(() => {
    if (previousAccount.current && connection.scope && previousAccount.current !== connection.scope) clearPrivate();
    previousAccount.current = connection.scope || null;
  }, [personalScope]);

  useEffect(() => {
    const scope = connection.scope, affiliation = connection.affiliation;
    if (connection.phase !== 'connected' || !scope || !affiliation) return;
    const controller = new AbortController();
    setApplicationError('');
    setApplicationLoading(true);
    const cached = !applicationRefresh ? readPrivate<Application[]>(scope, affiliation, 'applications', locale) : null;
    const read = cached ? Promise.resolve({ items: cached.data, fetched_at: cached.fetched_at })
      : unisportFetch<Application[] | { items: Application[]; fetched_at: number }>(
        '/applications?metadata=true' + (applicationRefresh ? '&refresh=true' : ''), credential, 'GET',
        undefined, controller.signal, scope, affiliation,
      );
    void read.then(result => {
      if (controller.signal.aborted) return;
      const snapshot = Array.isArray(result) ? { items: result, fetched_at: Date.now() / 1000 } : result;
      if (!Array.isArray(snapshot.items)) throw new Error(t('unisport.read_failed'));
      setApplications(snapshot.items);
      setApplicationsScope(personalScope);
      setApplicationsChanged(false);
      setApplicationsAt(writePrivate(scope, affiliation, 'applications', locale, snapshot.items, snapshot.fetched_at));
    }).catch(failure => {
      if (!controller.signal.aborted) setApplicationError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
    }).finally(() => { if (!controller.signal.aborted) setApplicationLoading(false); });
    return () => controller.abort();
  }, [personalScope, credential, connection.phase, applicationRefresh]);

  async function refresh(sequence = generation.current) {
    const next = await unisportFetch<Connection>('/connection', credential);
    if (!mounted.current || sequence !== generation.current) return;
    setConnection(next);
    if (next.phase === 'connected') {
      if (legacyLogin) {
        const result = await unisportFetch<{ affiliations: string[] }>('/affiliations', credential);
        if (!mounted.current || sequence !== generation.current) return;
        setChoices(result.affiliations);
        setChoice(previous => previous && result.affiliations.includes(previous) ? previous : next.affiliation || '');
      }
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
  }, [credential, language, legacyLogin]);

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

  const refreshApplications = () => setApplicationRefresh(value => value + 1);
  const registrations = connection.phase === 'connected' && connection.affiliation ? <section className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold">{t('unisport.applications')}</h2>
      <IconButton label={t('unisport.refresh_applications')} loading={applicationLoading} onClick={refreshApplications}><RefreshCw size={18} aria-hidden="true" /></IconButton>
    </div>
    {applicationError && <ErrorNotice message={applicationError} connectionInline onRetry={refreshApplications} retryDisabled={applicationLoading} />}
    {applicationLoading && !visibleApplications && <p role="status" className="text-sm">{t('unisport.loading_applications')}</p>}
    {applicationsChanged && <p role="status" className="text-sm">{t('unisport.applications_changed')}</p>}
    {visibleApplications && applicationsAt && <p className="text-xs text-slate-500 dark:text-slate-400">{t('unisport.cached_at', {
      time: unisportDate(new Date(applicationsAt * 1000).toISOString(), locale),
    })}</p>}
    {visibleApplications?.length === 0 && <p className="text-sm">{t('unisport.no_applications')}</p>}
    {visibleApplications && [false, true].map(past => {
      const items = visibleApplications.filter(item => past === (instant(item.end || item.offerNextDate?.end || applicationStart(item)) < Date.now()))
        .sort((first, second) => (instant(applicationStart(first)) - instant(applicationStart(second))) * (past ? -1 : 1));
      if (!items.length) return null;
      return <section key={String(past)} className="space-y-2">
        <h3 className="font-semibold">{t(past ? 'unisport.past_activities' : 'unisport.current_registrations')}</h3>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {items.map((item, index) => {
            const begin = applicationStart(item);
            return <li key={JSON.stringify([item.id, begin, index])} className="space-y-1 break-words py-2">
              <h4 className="font-semibold">{item.title || t('unisport.offer')}</h4>
              {begin && <p className="text-sm">{unisportDate(begin, locale)}</p>}
              <p className="text-sm">{item.registration || t(item.status === 4 ? 'unisport.user_cancelled' : 'unisport.on_registration_list')}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {!past && item.id && item.status === 8 && <RegistrationAction offer={{
                  id: item.id, title: item.title || t('unisport.offer'), begin, end: '', sport: '', opens: '', closes: '',
                  level: '', location: '', address: '', status: '', free_places: '', cancelled: false, url: null,
                }} actions={{
                  account: { credential, scope: connection.scope, affiliation: connection.affiliation },
                  now: Date.now(), registered: true, canCancel: true, favourite: false, reminded: false,
                  toggleFavourite: () => {}, toggleReminder: () => {}, onBookingClosed: refreshApplications,
                }} />}
                {item.id && item.status !== 4 && connection.scope && <UnisportParticipants
                  offerUrl={officialOffers.get(item.id)} scope={connection.scope} affiliation={connection.affiliation!} />}
              </div>
            </li>;
          })}
        </ul>
      </section>;
    })}
  </section> : null;

  return <section className="mx-auto w-full min-w-0 max-w-7xl space-y-4 p-3 text-slate-800 sm:p-6 dark:text-slate-100" aria-labelledby="unisport-title">
    <header className="space-y-2 !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="unisport-title" className="flex items-center gap-2 text-2xl font-bold"><Dumbbell aria-hidden="true" />{t('unisport.title')}</h1>
      </div>

      <nav aria-label={t('unisport.title')} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 min-[540px]:flex dark:bg-slate-800">
        {views.map(([name, Icon]) => <Button key={name} variant={view === name ? 'primary' : 'ghost'}
          aria-current={view === name ? 'page' : undefined} onClick={() => {
            if (view !== name) void navigationGuard.confirmNavigation().then(allowed => { if (allowed) setView(name); });
          }} className="!shrink !px-1.5 max-[539px]:!justify-start">
          <Icon size={17} className="shrink-0" aria-hidden="true" />{t(`unisport.${name}`)}
        </Button>)}
      </nav>
    </header>
    {error && <ErrorNotice message={error} connectionInline onRetry={() => void run(sequence => refresh(sequence))} retryDisabled={busy} />}
    {(view === 'my_sport' || legacyLogin) && <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p role="status" className="flex items-center gap-2 font-semibold">
        {(waiting || busy) && <LoaderCircle size={18} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
        {t(waiting ? 'unisport.waiting' : connection.phase === 'connected' ? 'unisport.connected' : 'unisport.disconnected')}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">{legacyLogin ? t('unisport.login_hint') : t('unibe.extension_hint')}</p>
      {!legacyLogin && connection.affiliation && <p className="text-sm">
        {t('unisport.affiliation')}: {connection.affiliation.slice(connection.affiliation.lastIndexOf('@') + 1)}
      </p>}
      {legacyLogin && <>
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
            {choices.map(value => <option key={value} value={value}>{value.includes('@') ? value.slice(value.lastIndexOf('@') + 1) : value}</option>)}
          </select>
        </div>
        {!choices.length && <p className="text-sm">{t('unisport.no_affiliations')}</p>}
        <Button type="submit" loading={busy}>{t('unisport.save_affiliation')}</Button>
      </form>}
      {connection.phase === 'connected' && connection.scope && connection.affiliation && <UnisportIliasConnection
        credential={credential} scope={connection.scope} affiliation={connection.affiliation} />}
      </>}
      {connection.phase === 'connected' && connection.scope && connection.affiliation && <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h2 className="font-semibold">{t('unisport.website_login_title')}</h2>
        <UnisportWebsiteLogin scope={connection.scope} affiliation={connection.affiliation} />
      </div>}
    </div>}
    <UnisportCatalogue credential={credential} scope={connection.phase === 'connected' ? connection.scope : null}
      affiliation={connection.affiliation} onOffersLoaded={setCatalogueOffers} view={view} onNavigate={setView}
      focused={selection} onSelectSport={selection => navigate({ view: 'explore', selection })}
      applications={visibleApplications} registrations={registrations} onBookingClosed={refreshApplications} />
  </section>;
}
