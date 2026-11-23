import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportFetch } from '../lib/unisport';
import { CATALOGUE_TTL, OFFER_TTL, fresh, readPublic, writePublic, readPrivate, writePrivate, Snapshot } from '../lib/unisportCache';
import { UnisportCatalogue as Catalogue, UnisportOffer, unisportDate } from '../lib/unisportOffers';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { ErrorNotice } from './ErrorNotice';
import { FeedbackBanner } from './ui/FeedbackBanner';
import { UnisportBooking } from './UnisportBooking';
import { navigationGuard } from '../lib/navigationGuard';

type Saved = { id: number; title: string };
type Filter = { query: string; sport: string; saved: boolean };

function CacheTime({ snapshot, language, ttl }: { snapshot: { fetched_at: number; stale?: boolean }; language: string; ttl: number }) {
  return <p className="text-xs text-slate-500 dark:text-slate-400">{t(fresh(snapshot, ttl) ? 'unisport.cached_at' : 'unisport.stale_at', {
    time: unisportDate(new Date(snapshot.fetched_at * 1000).toISOString(), language),
  })}</p>;
}

export function UnisportCatalogue({ credential, scope, affiliation, onOffersLoaded }: {
  credential: string; scope?: string | null; affiliation: string | null; onOffersLoaded?: (offers: UnisportOffer[]) => void;
}) {
  const language = useLanguage();
  const locale = language === 'de' ? 'de' : 'en';
  const [catalogue, setCatalogue] = useState<Snapshot<Catalogue> | null>(null);
  const [draft, setDraft] = useState<Filter>({ query: '', sport: '', saved: false });
  const [filter, setFilter] = useState(draft);
  const [limit, setLimit] = useState(20);
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [savedScope, setSavedScope] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedLoading, setSavedLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedError, setSavedError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Snapshot<{ offer: UnisportOffer }> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const publicSequence = useRef(0), privateSequence = useRef(0), detailSequence = useRef(0);
  const catalogueController = useRef<AbortController | null>(null), detailController = useRef<AbortController | null>(null);
  const canReadSaved = Boolean(scope && affiliation);
  const accountKey = JSON.stringify([scope, affiliation, locale]);
  const currentSaved = savedScope === accountKey ? saved : null;

  useEffect(() => {
    // Reuse the complete cached snapshot for registration links: no per-card
    // detail fetches or additional upstream catalogue reads.
    onOffersLoaded?.(catalogue?.items || []);
  }, [catalogue, onOffersLoaded]);

  async function loadCatalogue(force = false) {
    const sequence = ++publicSequence.current;
    catalogueController.current?.abort();
    const controller = new AbortController(); catalogueController.current = controller;
    const key = 'catalogue:' + locale;
    setLoading(true); setError('');
    try {
      const cached = await readPublic<Catalogue>(key);
      if (sequence !== publicSequence.current) return;
      if (cached && Array.isArray(cached.items) && Array.isArray(cached.sports)) {
        setCatalogue(cached);
        if (!force && fresh(cached, CATALOGUE_TTL)) return;
      }
      const result = await unisportFetch<Snapshot<Catalogue>>('/catalogue' + (force ? '?refresh=true' : ''), credential, 'GET', undefined, controller.signal);
      if (!Array.isArray(result.items) || !Array.isArray(result.sports)) throw new Error(t('unisport.read_failed'));
      if (sequence !== publicSequence.current) return;
      setCatalogue(result); await writePublic(key, result);
      if (result.stale) setError(t('unisport.stale_warning'));
    } catch (failure) {
      if (sequence === publicSequence.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
    } finally { if (sequence === publicSequence.current) setLoading(false); }
  }

  async function loadSaved(force = false) {
    if (!scope || !affiliation) return;
    const sequence = ++privateSequence.current;
    setSavedLoading(true); setSavedError(''); setSavedScope(accountKey);
    try {
      const cached = readPrivate<Saved[]>(scope, affiliation, 'bookmarks', locale);
      if (!force && cached && Array.isArray(cached.data)) { setSaved(cached.data); setSavedAt(cached.fetched_at); return; }
      const result = await unisportFetch<{ items: Saved[] }>('/bookmarks', credential, 'GET', undefined, undefined, scope);
      if (sequence !== privateSequence.current) return;
      setSaved(result.items); setSavedAt(writePrivate(scope, affiliation, 'bookmarks', locale, result.items));
    } catch (failure) {
      if (sequence === privateSequence.current) setSavedError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
    } finally { if (sequence === privateSequence.current) setSavedLoading(false); }
  }

  async function loadDetail(id: number, force = false) {
    const sequence = ++detailSequence.current;
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setDetailLoading(true); setDetailError('');
    const key = `offer:${locale}:${id}`;
    try {
      const cached = await readPublic<{ offer: UnisportOffer }>(key);
      if (sequence !== detailSequence.current) return;
      if (cached?.offer?.id === id) {
        setDetail(cached);
        if (!force && fresh(cached, OFFER_TTL)) return;
      }
      const result = await unisportFetch<Snapshot<{ offer: UnisportOffer }>>(`/offers/${id}` + (force ? '?refresh=true' : ''), credential, 'GET', undefined, controller.signal);
      if (sequence !== detailSequence.current) return;
      setDetail(result); await writePublic(key, result);
      if (result.stale) setDetailError(t('unisport.stale_warning'));
    } catch (failure) {
      if (sequence === detailSequence.current && !controller.signal.aborted) setDetailError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
    } finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  }

  useEffect(() => {
    setCatalogue(null);
    setDraft(previous => ({ ...previous, sport: '' })); setFilter(previous => ({ ...previous, sport: '' }));
    void loadCatalogue();
    return () => { ++publicSequence.current; catalogueController.current?.abort(); };
  }, [locale, credential]);
  useEffect(() => {
    setSaved(null); setSavedAt(null); setSavedError(''); setSavedLoading(false);
    setSavedScope(accountKey);
    if (scope && affiliation) {
      const cached = readPrivate<Saved[]>(scope, affiliation, 'bookmarks', locale);
      if (cached && Array.isArray(cached.data)) { setSaved(cached.data); setSavedAt(cached.fetched_at); }
    } else {
      setDraft(previous => ({ ...previous, saved: false }));
      setFilter(previous => ({ ...previous, saved: false }));
    }
    return () => { ++privateSequence.current; };
  }, [scope, affiliation, locale]);
  useEffect(() => {
    if (selected === null) { opener.current?.focus(); return; }
    setDetail(null); void loadDetail(selected);
    detailHeading.current?.focus();
    return () => { ++detailSequence.current; detailController.current?.abort(); };
  }, [selected, locale]);

  const shown = useMemo(() => {
    if (!catalogue) return [];
    const byId = new Map(catalogue.items.map(item => [item.id, item]));
    const source = filter.saved ? (currentSaved || []).map(item => byId.get(item.id) || {
      id: item.id, title: item.title || t('unisport.offer'), sport: '', begin: '', end: '', opens: '', closes: '',
      level: '', location: '', address: '', status: '', free_places: '', cancelled: false, url: null,
    }) : catalogue.items;
    const query = filter.query.trim().toLocaleLowerCase(locale);
    return source.filter(item => (!filter.sport || item.sport === filter.sport) && (!query ||
      [item.title, item.sport, item.level, item.location, item.address].some(value => value.toLocaleLowerCase(locale).includes(query))));
  }, [catalogue, currentSaved, filter, locale]);

  const metadata = (offer: UnisportOffer) => <>
    <div className="flex flex-wrap gap-2">
      {offer.cancelled && <Badge tone="danger">{t('unisport.cancelled')}</Badge>}
      {offer.status && <Badge tone={offer.cancelled ? 'danger' : 'neutral'}>{offer.status}</Badge>}
      {offer.free_places && <Badge tone="info">{offer.free_places}</Badge>}
    </div>
    {offer.begin && <p className="text-sm"><time dateTime={offer.begin}>{unisportDate(offer.begin, locale)}</time>{offer.end && <> – <time dateTime={offer.end}>{unisportDate(offer.end, locale)}</time></>}</p>}
    {(offer.sport || offer.level) && <p className="text-sm text-slate-600 dark:text-slate-400">{[offer.sport, offer.level].filter(Boolean).join(' · ')}</p>}
    {offer.location && <p className="text-sm">{offer.location}</p>}
  </>;

  return <section className="space-y-4" aria-labelledby="unisport-catalogue-title">
    <div hidden={selected !== null} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="unisport-catalogue-title" className="text-xl font-bold">{t('unisport.catalogue')}</h2>
        <Button loading={loading} onClick={() => void loadCatalogue(true)}><RefreshCw size={16} aria-hidden="true" />{t('unisport.refresh')}</Button>
      </div>
      {catalogue && <CacheTime snapshot={catalogue} language={locale} ttl={CATALOGUE_TTL} />}
      <search>
        <form action="/api/unisport/catalogue" method="get" aria-labelledby="unisport-catalogue-title" className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault(); setFilter(draft); setLimit(20);
          if (draft.saved) void loadSaved();
        }}>
          <div className="min-w-0 basis-full sm:basis-52 sm:flex-1">
            <label htmlFor="unisport-search" className="mb-1 block text-sm font-semibold">{t('unisport.search')}</label>
            <input id="unisport-search" name="search" type="search" maxLength={200} value={draft.query} onChange={event => setDraft(previous => ({ ...previous, query: event.target.value }))}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-600 dark:bg-slate-950" />
          </div>
          <div className="min-w-0 basis-full sm:basis-48 sm:flex-1">
            <label htmlFor="unisport-sport" className="mb-1 block text-sm font-semibold">{t('unisport.sport_type')}</label>
            <select id="unisport-sport" name="sport" value={draft.sport} onChange={event => setDraft(previous => ({ ...previous, sport: event.target.value }))}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-600 dark:bg-slate-950">
              <option value="">{t('unisport.all_sports')}</option>
              {catalogue?.sports.map(sport => <option key={sport} value={sport}>{sport}</option>)}
            </select>
          </div>
          <Button type="submit" className="min-h-12"><Search size={16} aria-hidden="true" />{t('unisport.filter')}</Button>
          {canReadSaved && <label className="flex min-h-12 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="saved" checked={draft.saved} onChange={event => setDraft(previous => ({ ...previous, saved: event.target.checked }))} className="h-5 w-5 accent-teal-600" />
            <Bookmark size={16} aria-hidden="true" />{t('unisport.saved_only')}
          </label>}
        </form>
      </search>
      {error && <ErrorNotice message={error} connectionInline onRetry={() => void loadCatalogue(true)} retryDisabled={loading} />}
      {savedError && <ErrorNotice message={savedError} connectionInline onRetry={() => void loadSaved(true)} retryDisabled={savedLoading} />}
      {filter.saved && <div className="flex flex-wrap items-center gap-2">
        <Button loading={savedLoading} onClick={() => void loadSaved(true)}>{t('unisport.refresh_saved')}</Button>
        {savedAt && <CacheTime snapshot={{ fetched_at: savedAt }} language={locale} ttl={60000} />}
      </div>}
      <p role="status" className="text-sm text-slate-600 dark:text-slate-400">{t(loading && !catalogue ? 'unisport.loading_catalogue' : savedLoading ? 'unisport.loading_saved' : 'unisport.result_count', { count: shown.length })}</p>
      {catalogue && !shown.length && !savedLoading && (!filter.saved || currentSaved !== null) && <p className="text-sm">{t(filter.saved && !currentSaved?.length ? 'unisport.no_saved' : 'unisport.no_offers')}</p>}
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
        {shown.slice(0, limit).map(offer => <li key={offer.id} className="min-w-0 space-y-2 break-words rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3><button type="button" onClick={event => { opener.current = event.currentTarget; setSelected(offer.id); }}
            className="min-h-12 w-full cursor-pointer text-left text-base font-bold text-teal-800 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300">{offer.title}</button></h3>
          {metadata(offer)}
        </li>)}
      </ul>
      {shown.length > limit && <Button onClick={() => setLimit(previous => previous + 20)}>{t('unisport.show_more')}</Button>}
    </div>
    {selected !== null && <div className="space-y-4" aria-labelledby="unisport-offer-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={() => { void navigationGuard.confirmNavigation().then(allowed => { if (allowed) setSelected(null); }); }}><ArrowLeft size={16} aria-hidden="true" />{t('unisport.back_to_offers')}</Button>
        <Button loading={detailLoading} onClick={() => void loadDetail(selected, true)}>{t('unisport.refresh')}</Button>
      </div>
      <h2 id="unisport-offer-title" ref={detailHeading} tabIndex={-1} className="break-words text-xl font-bold focus:outline-none">{detail?.offer.title || t('unisport.offer')}</h2>
      {detailError && <ErrorNotice message={detailError} connectionInline onRetry={() => void loadDetail(selected, true)} retryDisabled={detailLoading} />}
      {detailLoading && !detail && <p role="status">{t('unisport.loading_offer')}</p>}
      {detail && <>
        <CacheTime snapshot={detail} language={locale} ttl={OFFER_TTL} />
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {metadata(detail.offer)}
          {detail.offer.address && <p className="text-sm">{detail.offer.address}</p>}
          {detail.offer.opens && <p className="text-sm">{t('unisport.registration_opens', { time: unisportDate(detail.offer.opens, locale) })}</p>}
          {detail.offer.closes && <p className="text-sm">{t('unisport.registration_closes', { time: unisportDate(detail.offer.closes, locale) })}</p>}
          {(detail.offer.important || detail.offer.outage) && <FeedbackBanner tone="warning" message={detail.offer.important || detail.offer.outage} />}
          {detail.offer.special && <p className="whitespace-pre-wrap break-words text-sm">{detail.offer.special}</p>}
          {scope && affiliation && detail.offer.begin ? <UnisportBooking
            key={JSON.stringify([scope, affiliation, detail.offer.id, detail.offer.begin])}
            credential={credential} scope={scope} affiliation={affiliation} offerId={detail.offer.id} begin={detail.offer.begin} />
            : <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.booking_login')}</p>}
          {detail.offer.url && <a href={detail.offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-lg font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300">
            {t('unisport.official_offer')}<ExternalLink size={16} aria-hidden="true" />
          </a>}
        </div>
        {detail.offer.infos?.map((info, index) => <section key={index} className="space-y-2 break-words rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="font-bold">{info.title}</h3><p className="whitespace-pre-wrap text-sm">{info.content}</p>
        </section>)}
      </>}
    </div>}
  </section>;
}
