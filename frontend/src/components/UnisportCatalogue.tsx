import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowDownUp, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportFetch } from '../lib/unisport';
import { CATALOGUE_TTL, OFFER_TTL, fresh, readPrivate, writePrivate } from '../lib/unisportCache';
import {
  applicationStart, autoSignInKey, cardOfferType, cardOfferTypes, downloadSportCalendar, instant, occurrenceKey, registrationState,
  sportCategories, sportCategory, sportClock, sportDay, sportDayLabel, unisportDate,
  type SportSelection, type SportView, type UnisportApplication, type UnisportCatalogue as Catalogue, type UnisportOffer,
} from '../lib/unisportOffers';
import { useUnisportPublic } from '../lib/useUnisportPublic';
import { useUnisportAutoSignIn } from '../lib/useUnisportAutoSignIn';
import { navigationGuard } from '../lib/navigationGuard';
import { Button, IconButton } from './ui/Button';
import { Badge } from './ui/Badge';
import { ErrorNotice } from './ErrorNotice';
import { FeedbackBanner } from './ui/FeedbackBanner';
import { UnisportSchedule, SportSelect, sportControl } from './UnisportSchedule';
import { SportFavourite, SportSession, type SessionActions } from './UnisportSession';

type Saved = { id: number; title: string };
type Sport = { name: string; offers: UnisportOffer[] };
type Reminder = { id: number; title: string; opens: string };
type FavouriteSport = { name: string; offerIds: number[] };
type Preferences = { sports: FavouriteSport[]; offers: number[]; reminders: Reminder[]; autoSignIn: string[] };
const emptyPreferences: Preferences = { sports: [], offers: [], reminders: [], autoSignIn: [] };
const noOffers: UnisportOffer[] = [];
const panel = 'min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700';

function readPreferences(key: string): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(data?.sports) && Array.isArray(data.offers) && Array.isArray(data.reminders)) {
      return {
        offers: data.offers,
        reminders: data.reminders,
        autoSignIn: Array.isArray(data.autoSignIn) ? data.autoSignIn.filter((key: unknown) => typeof key === 'string') : [],
        sports: (data.sports as FavouriteSport[]).filter(item => typeof item?.name === 'string' && Array.isArray(item.offerIds)),
      };
    }
  } catch { /* Preferences can still be used in memory. */ }
  return emptyPreferences;
}

function useSportPreferences(scope: string | null | undefined, affiliation: string | null) {
  const key = 'betterilias_unisport_preferences:' + JSON.stringify(scope && affiliation ? [scope, affiliation] : []);
  const [current, setCurrent] = useState(() => ({ key, data: readPreferences(key) }));
  const [error, setError] = useState(false);
  const data = current.key === key ? current.data : readPreferences(key);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (!event.key || event.key === key) setCurrent({ key, data: readPreferences(key) });
    };
    setError(false);
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);

  function update(change: (preferences: Preferences) => Preferences) {
    const next = change(data);
    setCurrent({ key, data: next });
    try { localStorage.setItem(key, JSON.stringify(next)); setError(false); }
    catch { setError(true); }
  }
  return { data, update, error };
}

function toggle<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function groupSessions(items: UnisportOffer[]) {
  const groups = new Map<string, UnisportOffer[]>();
  for (const offer of items) {
    // Only merge presentation when the provider publishes the same course URL
    // and matching visible metadata. Each booking keeps its own ID and date.
    const key = offer.url ? JSON.stringify([offer.url, offer.title, offer.location, offer.level]) : String(offer.id);
    const group = groups.get(key);
    if (group) group.push(offer);
    else groups.set(key, [offer]);
  }
  return [...groups.values()];
}

function snapshotLabel(snapshot: { fetched_at: number; stale?: boolean }, language: string, ttl: number) {
  return t(fresh(snapshot, ttl) ? 'unisport.cached_at' : 'unisport.stale_at', {
    time: unisportDate(new Date(snapshot.fetched_at * 1000).toISOString(), language),
  });
}

function OpeningCountdown({ opens }: { opens: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((opens - now) / 1000));
  return <Badge tone="warning"><span role="timer">{t('unisport.opens_countdown', {
    time: Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'),
  })}</span></Badge>;
}

function OfferDetail({ offer, credential, actions }: {
  offer: UnisportOffer; credential: string; actions: (offer: UnisportOffer) => SessionActions;
}) {
  const language = useLanguage();
  const detail = useUnisportPublic<{ offer: UnisportOffer }>('offers/' + offer.id, credential, OFFER_TTL, data => data.offer?.id === offer.id);
  const displayed = detail.data?.offer ?? offer;
  return <div className="space-y-2">
    {detail.loading && <p role="status" className="text-sm">{t('unisport.loading_offer')}</p>}
    {detail.error && <ErrorNotice message={detail.error} connectionInline onRetry={detail.refresh} />}
    <SportSession offer={displayed} actions={actions(displayed)} hideSport />
    {detail.data && <>
      <p className="text-xs text-slate-500 dark:text-slate-400">{snapshotLabel(detail.data, language, OFFER_TTL)}</p>
      {displayed.address && displayed.address !== displayed.location && <p className="text-sm">{displayed.address}</p>}
      {(displayed.important || displayed.outage) && <FeedbackBanner tone="warning" message={displayed.important || displayed.outage || ''} />}
      {displayed.special && <p className="whitespace-pre-wrap break-words text-sm">{displayed.special}</p>}
      {displayed.sport_url && <a href={displayed.sport_url} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-sm text-teal-800 underline dark:text-teal-300">{t('unisport.about_sport')}</a>}
      {displayed.infos?.map((info, index) => <details key={index} className={panel}
        open={/^(?:costs|fees|cancellation|kosten|gebühren|abmeldung|annullation|stornierung)$/i.test(info.title.trim())}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{info.title || t('unisport.more_information')}</summary>
        <p className="whitespace-pre-wrap break-words text-sm">{info.content}</p>
      </details>)}
    </>}
  </div>;
}

export function UnisportCatalogue({ credential, scope, affiliation, onOffersLoaded, view = 'explore', onNavigate,
  applications, registrations, onBookingClosed, focused, onSelectSport }: {
  credential: string; scope?: string | null; affiliation: string | null;
  onOffersLoaded?: (offers: UnisportOffer[]) => void; view?: SportView; onNavigate?: (view: SportView) => void;
  applications?: UnisportApplication[] | null; registrations?: React.ReactNode; onBookingClosed?: () => void;
  focused?: SportSelection; onSelectSport?: (selection?: SportSelection) => void;
}) {
  const language = useLanguage();
  const id = useId();
  const account = { credential, scope, affiliation };
  const catalogue = useUnisportPublic<Catalogue>('catalogue', credential, CATALOGUE_TTL, data => Array.isArray(data.items) && Array.isArray(data.sports));
  const offers = catalogue.data?.items ?? noOffers;
  const { data: preferences, update, error: preferencesError } = useSportPreferences(scope, affiliation);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [offerType, setOfferType] = useState('');
  const [reverse, setReverse] = useState(false);
  const [localSelection, setLocalSelection] = useState<SportSelection>();
  const selectionState = onSelectSport ? focused : localSelection;
  const selectedOffer = selectionState?.offerId;
  const selectedFromOffer = offers.find(offer => offer.id === selectedOffer);
  const selected = selectedFromOffer ? selectedFromOffer.sport || selectedFromOffer.title : selectionState?.sport;
  const setSelection = onSelectSport ?? setLocalSelection;
  const [now, setNow] = useState(Date.now);
  const [scheduleVisited, setScheduleVisited] = useState(view === 'schedule');
  const previousFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const bookmarksKey = JSON.stringify([scope, affiliation, language]);
  const [bookmarks, setBookmarks] = useState<{ key: string; items: Saved[] }>();
  const [bookmarksError, setBookmarksError] = useState('');
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarksRefresh, setBookmarksRefresh] = useState(0);
  const currentBookmarks = bookmarks?.key === bookmarksKey ? bookmarks.items : null;

  useEffect(() => onOffersLoaded?.(offers), [offers, onOffersLoaded]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (view === 'explore' && selected) heading.current?.focus();
    if (view === 'schedule') setScheduleVisited(true);
  }, [view, selected, selectedOffer, catalogue.data !== null]);

  useEffect(() => {
    if (!scope || !affiliation || view !== 'my_sport') return;
    const controller = new AbortController();
    setBookmarksError('');
    const cached = bookmarksRefresh === 0 ? readPrivate<Saved[]>(scope, affiliation, 'bookmarks', language) : null;
    if (cached && Array.isArray(cached.data)) {
      setBookmarks({ key: bookmarksKey, items: cached.data });
      setBookmarksLoading(false);
      return;
    }
    setBookmarksLoading(true);
    void unisportFetch<{ items: Saved[] }>('/bookmarks', credential, 'GET', undefined, controller.signal, scope, affiliation)
      .then(result => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.items)) throw new Error(t('unisport.read_failed'));
        setBookmarks({ key: bookmarksKey, items: result.items });
        writePrivate(scope, affiliation, 'bookmarks', language, result.items);
      }).catch(failure => {
        if (!controller.signal.aborted) setBookmarksError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
      }).finally(() => { if (!controller.signal.aborted) setBookmarksLoading(false); });
    return () => controller.abort();
  }, [bookmarksKey, view, credential, bookmarksRefresh]);

  const sports = useMemo(() => {
    const grouped = new Map<string, Sport>();
    for (const offer of offers) {
      const sport = offer.sport || offer.title;
      const entry = grouped.get(sport);
      if (entry) entry.offers.push(offer);
      else grouped.set(sport, { name: sport, offers: [offer] });
    }
    return grouped;
  }, [offers]);
  const autoSignInEnabled = useUnisportAutoSignIn();
  const byId = useMemo(() => new Map(offers.map(offer => [offer.id, offer])), [offers]);
  const resolvedFavourites = preferences.sports.map(saved => ({
    saved,
    name: saved.offerIds.map(id => byId.get(id)).find(offer => offer)?.sport || saved.name,
  }));
  const favouriteNames = new Set(resolvedFavourites.map(item => item.name));
  const registered = useMemo(() => new Map((applications ?? []).flatMap(item => {
    const begin = applicationStart(item);
    return item.id && item.status !== 4 && Number.isFinite(instant(begin))
      ? [[occurrenceKey(item.id, begin), item] as const] : [];
  })), [applications]);
  const personal = (offer: UnisportOffer) => registered.get(occurrenceKey(offer.id, offer.begin));
  const isFavourite = (offer: UnisportOffer) =>
    preferences.offers.includes(offer.id) || favouriteNames.has(offer.sport || offer.title);
  const toggleSport = (name: string) => update(data => {
    const existing = resolvedFavourites.filter(item => item.name === name);
    return {
      ...data,
      sports: existing.length
        ? data.sports.filter(saved => !existing.some(item => item.saved === saved))
        : [...data.sports, { name, offerIds: sports.get(name)?.offers.map(offer => offer.id) ?? [] }],
    };
  });
  const toggleOffer = (offer: UnisportOffer) => update(data => ({ ...data, offers: toggle(data.offers, offer.id) }));
  const reminderMatches = (reminder: Reminder, offer: UnisportOffer) => reminder.id === offer.id && reminder.opens === offer.opens;
  const toggleReminder = (offer: UnisportOffer) => update(data => ({
    ...data, reminders: data.reminders.some(reminder => reminderMatches(reminder, offer))
      ? data.reminders.filter(reminder => !reminderMatches(reminder, offer))
      : [...data.reminders, { id: offer.id, title: offer.title, opens: offer.opens }],
  }));
  const actions = (offer: UnisportOffer): SessionActions => ({
    now, account, favourite: preferences.offers.includes(offer.id), registered: Boolean(personal(offer)),
    canCancel: personal(offer)?.status === 8, personalStatus: personal(offer)?.registration,
    reminded: preferences.reminders.some(reminder => reminderMatches(reminder, offer)),
    toggleFavourite: () => toggleOffer(offer), toggleReminder: () => toggleReminder(offer), onBookingClosed,
    autoSignIn: autoSignInEnabled && scope && affiliation && offer.quick_candidate && Number.isFinite(instant(offer.begin)) ? {
      active: preferences.autoSignIn.includes(autoSignInKey(offer)),
      toggle: () => update(data => ({ ...data, autoSignIn: toggle(data.autoSignIn, autoSignInKey(offer)) })),
    } : undefined,
  });
  const matchingSports = [...sports.values()].filter(sport => {
    if (category && sportCategory(sport.name) !== category) return false;
    if (offerType && !sport.offers.some(offer => cardOfferType(offer) === offerType)) return false;
    const needle = query.trim().toLocaleLowerCase(language);
    return !needle || sport.name.toLocaleLowerCase(language).includes(needle)
      || sport.offers.some(offer => [offer.title, offer.level, offer.location].some(value => value.toLocaleLowerCase(language).includes(needle)));
  }).sort((a, b) => Number(favouriteNames.has(b.name)) - Number(favouriteNames.has(a.name))
    || a.name.localeCompare(b.name, language) * (reverse ? -1 : 1));
  const selection = selected ? sports.get(selected) : undefined;
  const openSport = (name: string, offerId?: number) => {
    const opener = document.activeElement;
    void navigationGuard.confirmNavigation().then(allowed => {
      if (!allowed) return;
      if (!selected || selected !== name || view !== 'explore') {
        previousFocus.current = opener instanceof HTMLElement ? opener : null;
      }
      if (!onSelectSport && view !== 'explore') onNavigate?.('explore');
      setSelection({ sport: name, offerId });
    });
  };
  const openOffer = (offer: UnisportOffer) => openSport(offer.sport || offer.title, offer.id);
  const leaveSport = () => void navigationGuard.confirmNavigation().then(allowed => {
    if (!allowed) return;
    setSelection(undefined);
    requestAnimationFrame(() => previousFocus.current?.focus());
  });
  const renderSession = (offer: UnisportOffer) => <SportSession key={occurrenceKey(offer.id, offer.begin)}
    offer={offer} actions={actions(offer)} onDetails={() => openOffer(offer)} />;

  const scheduled = [...byId.values()];
  for (const item of registered.values()) {
    const begin = applicationStart(item);
    const source = item.id ? byId.get(item.id) : undefined;
    if (source && instant(source.begin) === instant(begin)) continue;
    scheduled.push({
      id: item.id!, title: item.title || source?.title || t('unisport.offer'), sport: source?.sport || '',
      begin, end: item.end || item.offerNextDate?.end || '', opens: '', closes: '', level: source?.level || '',
      location: '', address: '', status: '', free_places: '', cancelled: false, url: source?.url ?? null,
    });
  }
  const upcoming = scheduled.filter(offer => personal(offer) && instant(offer.begin) >= now)
    .sort((a, b) => instant(a.begin) - instant(b.begin));
  const available = offers.filter(offer => !personal(offer) && instant(offer.begin) > now
    && ['available', 'drop_in'].includes(registrationState(offer, now)))
    .sort((a, b) => Number(isFavourite(b)) - Number(isFavourite(a)) || instant(a.begin) - instant(b.begin));
  const openings = new Map<string, Map<number, UnisportOffer[]>>();
  for (const offer of offers.filter(offer => !personal(offer) && registrationState(offer, now) === 'opening')
    .sort((a, b) => instant(a.opens) - instant(b.opens) || Number(isFavourite(b)) - Number(isFavourite(a)))) {
    const time = instant(offer.opens);
    const date = sportDay(time);
    const times = openings.get(date) ?? new Map<number, UnisportOffer[]>();
    const group = times.get(time) ?? [];
    group.push(offer);
    times.set(time, group);
    openings.set(date, times);
  }

  function favouriteSports() {
    return favouriteNames.size ? <ul className="flex flex-wrap gap-2">
      {[...favouriteNames].map(name => <li key={name} className="flex max-w-full items-center rounded-xl border border-slate-200 dark:border-slate-700">
        <Button variant="ghost" className="min-w-0 !shrink break-words" disabled={!sports.has(name)} onClick={() => openSport(name)}>
          <span className="min-w-0">{name}</span>
        </Button>
        <SportFavourite label={name} active toggle={() => toggleSport(name)} />
      </li>)}
    </ul> : <p className="text-sm text-slate-600 dark:text-slate-300">{t('unisport.no_favourites')}</p>;
  }

  function registrationOpenings() {
    return <section className={panel}>
      <h2 className="font-bold">{t('unisport.openings')}</h2>
      {!openings.size && <p className="text-sm">{t('unisport.no_openings')}</p>}
      {[...openings].map(([date, times]) => <details open={date === openings.keys().next().value} key={date} className="border-t border-slate-200 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          {sportDayLabel(date, language)} · {[...times.values()].reduce((count, items) => count + items.length, 0)}
        </summary>
        <div className="space-y-3 pb-2">{[...times].map(([time, items]) => <div key={time} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold"><time dateTime={items[0].opens}>{sportClock(time)}</time></h3>
            {time - now <= 900_000 && <OpeningCountdown opens={time} />}
          </div>
          {items.map(offer => <div key={offer.id} className="space-y-1">
            {isFavourite(offer) && <Badge tone="info">{t('unisport.favourites')}</Badge>}
            <SportSession offer={offer} actions={actions(offer)} onDetails={() => openOffer(offer)} />
          </div>)}
        </div>)}</div>
      </details>)}
    </section>;
  }

  return <div className="@container min-w-0 space-y-4">
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="text-xs text-slate-500 dark:text-slate-400">
        {catalogue.loading && !catalogue.data ? t('unisport.loading_catalogue') : catalogue.data
          ? snapshotLabel(catalogue.data, language, CATALOGUE_TTL) : ''}
      </p>
      <IconButton label={t('unisport.refresh')} title={t('unisport.refresh')} loading={catalogue.loading} onClick={catalogue.refresh}>
        {!catalogue.loading && <RefreshCw size={17} aria-hidden="true" />}
      </IconButton>
    </div>
    {catalogue.error && <ErrorNotice connectionInline message={catalogue.error} onRetry={catalogue.refresh} />}
    {preferencesError && <p role="alert" className="text-sm">{t('unisport.preference_write_failure')}</p>}
    {view === 'overview' && <div className="grid min-w-0 gap-4 @4xl:grid-cols-2">
      <section className={panel}>
        <h2 className="font-bold">{t('unisport.upcoming_sessions')}</h2>
        {upcoming.length ? upcoming.slice(0, 4).map(renderSession) : <p className="text-sm">{t(affiliation ? 'unisport.no_upcoming' : 'unisport.booking_login')}</p>}
        {onNavigate && <Button variant="ghost" onClick={() => onNavigate('my_sport')}>{t('unisport.my_sport')}<ChevronRight size={16} aria-hidden="true" /></Button>}
      </section>
      {registrationOpenings()}
      <section className={panel}><h2 className="font-bold">{t('unisport.favourite_sports')}</h2>{favouriteSports()}</section>
      <section className={panel}>
        <h2 className="font-bold">{t('unisport.suggested_offers')}</h2>
        {available.length ? available.slice(0, 4).map(renderSession) : <p className="text-sm">{t('unisport.no_offers')}</p>}
      </section>
    </div>}
    {view === 'explore' && <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
      <section className={`${selection ? 'hidden @4xl:block' : ''} ${panel}`} aria-labelledby={id + '-sports'}>
        <h2 id={id + '-sports'} className="font-bold">{t('unisport.catalogue')}</h2>
        <search className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
            <span>{t('unisport.search_sports')}</span>
            <span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} aria-hidden="true" />
              <input type="search" value={query} onChange={event => setQuery(event.target.value)} className={sportControl + ' pl-9'} /></span>
          </label>
          <IconButton label={t(reverse ? 'unisport.sort_az' : 'unisport.sort_za')} onClick={() => setReverse(!reverse)} className="mb-0.5"><ArrowDownUp size={17} aria-hidden="true" /></IconButton>
        </search>
        <SportSelect label={t('unisport.sport_category')} value={category} onChange={setCategory}
          options={sportCategories.map(value => [value, t(`unisport.category_${value}`)])} />
        <SportSelect label={t('unisport.offer_type')} value={offerType} onChange={setOfferType}
          options={cardOfferTypes.map(value => [value, t(`unisport.card_type_${value}`)])} />
        <p role="status" className="text-xs text-slate-600 dark:text-slate-400">{t(
          matchingSports.length === 1 ? 'unisport.one_sport' : 'unisport.sport_count', { count: matchingSports.length },
        )}</p>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {matchingSports.flatMap(({ name, offers: items }, index) => {
            const favourite = favouriteNames.has(name);
            const startsGroup = favourite && index === 0 || !favourite && index > 0 && favouriteNames.has(matchingSports[index - 1].name);
            const row = <li key={name} className="flex min-w-0 items-center gap-1">
              <Button variant="ghost" aria-label={name} aria-current={selection?.name === name ? 'true' : undefined} onClick={() => openSport(name)}
                className={`min-w-0 flex-1 !shrink !justify-start py-1 text-left ${selection?.name === name ? 'bg-teal-50 dark:bg-teal-950' : ''}`}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}<span className="block text-xs font-normal text-slate-600 dark:text-slate-400">
                  {t('unisport.result_count', { count: items.length })}</span></span>
              </Button>
              <SportFavourite label={name} active={favourite} toggle={() => toggleSport(name)} />
            </li>;
            return startsGroup ? [
              <li key={favourite ? 'favourite-heading' : 'other-heading'} role="presentation" className="py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                {t(favourite ? 'unisport.favourite_sports' : 'unisport.other_sports')}
              </li>, row,
            ] : [row];
          })}
        </ul>
        {!matchingSports.length && !catalogue.loading && <p className="text-sm">{t('unisport.no_sports')}</p>}
      </section>
      {selection ? <section className="min-w-0 space-y-3">
        <Button variant="ghost" onClick={leaveSport}><ArrowLeft size={16} aria-hidden="true" />{t('unisport.back_to_sports')}</Button>
        <div className="flex items-center justify-between gap-2">
          <h2 ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-bold focus:outline-none">{selection.name}</h2>
          <SportFavourite label={selection.name} active={favouriteNames.has(selection.name)} toggle={() => toggleSport(selection.name)} />
        </div>
        {groupSessions(selection.offers.filter(offer => !offerType || selectedOffer === offer.id || cardOfferType(offer) === offerType)).map(group => {
          const sessions = group.map(offer => selectedOffer === offer.id
            ? <OfferDetail key={offer.id} offer={offer} credential={credential} actions={actions} />
            : <SportSession key={offer.id} offer={offer} actions={actions(offer)} hideSport onDetails={() => openOffer(offer)} />);
          if (sessions.length === 1) return sessions[0];
          return <details key={group[0].id} open={group.some(offer => offer.id === selectedOffer)} className={panel}>
            <summary className="min-h-11 cursor-pointer break-words py-2 font-semibold">
              {group[0].title} · {t('unisport.session_count', { count: group.length })}
            </summary>
            {sessions}
          </details>;
        })}
      </section> : <p className="hidden rounded-xl border border-dashed border-slate-300 p-5 text-sm @4xl:block dark:border-slate-700">{t('unisport.choose_sport')}</p>}
    </div>}
    {(view === 'schedule' || scheduleVisited) && <div hidden={view !== 'schedule'}>
      <UnisportSchedule offers={scheduled} now={now} isFavourite={isFavourite}
        isRegistered={offer => Boolean(personal(offer))} getActions={actions} openOffer={offer => {
          const catalogueOffer = byId.get(offer.id);
          if (catalogueOffer && instant(catalogueOffer.begin) === instant(offer.begin)) openOffer(catalogueOffer);
          else onNavigate?.('my_sport');
        }} />
    </div>}
    {view === 'my_sport' && <div className="min-w-0 space-y-4">
      {registrations}
      <section className={panel}>
        <h2 className="font-bold">{t('unisport.favourites')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.local_preferences')}</p>
        {favouriteSports()}
        {preferences.offers.map(offerId => {
          const offer = byId.get(offerId);
          return offer ? renderSession(offer) : <div key={offerId} className="flex items-center gap-2">
            <span>{t('unisport.missing_offer')}</span>
            <Button onClick={() => update(data => ({ ...data, offers: toggle(data.offers, offerId) }))}>{t('unisport.remove')}</Button>
          </div>;
        })}
      </section>
      <section className={panel}>
        <h2 className="font-bold">{t('unisport.reminders')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.reminder_hint')}</p>
        {!preferences.reminders.length && <p className="text-sm">{t('unisport.no_reminders')}</p>}
        {[...preferences.reminders].sort((a, b) => instant(a.opens) - instant(b.opens)).map(reminder => <div key={reminder.id + reminder.opens} className="space-y-1 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h3 className="break-words font-semibold">{reminder.title}</h3>
          <p className="text-sm">{t('unisport.registration_opens', { time: unisportDate(reminder.opens, language) })}</p>
          <div className="flex flex-wrap gap-2">
            {instant(reminder.opens) > now && <Button onClick={() => downloadSportCalendar(
              t('unisport.opening_calendar_title', { name: reminder.title }), instant(reminder.opens), NaN, '', true,
            )}>{t('unisport.add_calendar')}</Button>}
            <Button variant="ghost" onClick={() => update(data => ({ ...data, reminders: data.reminders.filter(item => item.id !== reminder.id || item.opens !== reminder.opens) }))}>
              {t('unisport.remove')}
            </Button>
          </div>
        </div>)}
      </section>
      {scope && affiliation && <section className={panel}>
        <h2 className="font-bold">{t('unisport.provider_bookmarks')}</h2>
        <Button loading={bookmarksLoading} onClick={() => setBookmarksRefresh(value => value + 1)}>{t('unisport.refresh_saved')}</Button>
        {bookmarksError && <p role="alert" className="text-sm">{bookmarksError}</p>}
        {currentBookmarks?.length === 0 && <p className="text-sm">{t('unisport.no_saved')}</p>}
        {currentBookmarks?.map(item => {
          const offer = byId.get(item.id);
          return offer ? renderSession(offer) : <p key={item.id} className="break-words text-sm">{item.title || t('unisport.offer')}</p>;
        })}
      </section>}
    </div>}
  </div>;
}
