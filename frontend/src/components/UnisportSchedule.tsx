import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, List, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { t, useLanguage } from '../lib/i18n';
import { navigationGuard } from '../lib/navigationGuard';
import { cardOfferType, cardOfferTypes, changeDay, instant, registrationState, sportCategories, sportCategory, sportClock, sportDay, sportDayLabel, type UnisportOffer } from '../lib/unisportOffers';
import type { CalendarEvent } from '../types';
import { Button, IconButton } from './ui/Button';
import { SportSession, type SessionActions } from './UnisportSession';

export const sportControl = 'min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-600 dark:bg-slate-950';

export function SportSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: [string, string][];
}) {
  const id = useId();
  return <div className="min-w-0 space-y-1 text-sm font-medium">
    <label htmlFor={id} className="block">{label}</label>
    <select id={id} value={value} onChange={event => onChange(event.target.value)} className={sportControl}>
      <option value="">{t('unisport.any')}</option>
      {options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
    </select>
  </div>;
}

function Toggle({ label, shortLabel, active, toggle }: { label: string; shortLabel?: string; active: boolean; toggle: () => void }) {
  return <Button variant={active ? 'primary' : 'outline'} aria-label={label} aria-pressed={active} onClick={toggle} className="!shrink py-1.5 text-center">
    {shortLabel ?? label}
  </Button>;
}

function weekday(day: string) {
  return new Date(day + 'T12:00:00Z').getUTCDay();
}

function changeSchedule(change: () => void) {
  if (!navigationGuard.getWarningMessage()) {
    change();
    return;
  }
  void navigationGuard.confirmNavigation().then(allowed => { if (allowed) change(); });
}

export function UnisportSchedule({ offers, now, isFavourite, isRegistered, getActions, openOffer, openSport }: {
  offers: UnisportOffer[]; now: number; isFavourite: (offer: UnisportOffer) => boolean;
  isRegistered: (offer: UnisportOffer) => boolean; getActions: (offer: UnisportOffer) => SessionActions;
  openOffer: (offer: UnisportOffer) => void;
  openSport: (name: string) => void;
}) {
  const language = useLanguage();
  const today = sportDay(now);
  const [day, setDay] = useState(today);
  const [weekly, setWeekly] = useState(false);
  const [favourites, setFavourites] = useState(false);
  const [available, setAvailable] = useState(false);
  const [dropIn, setDropIn] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [sport, setSport] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [offerType, setOfferType] = useState('');
  const [location, setLocation] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [startAfter, setStartAfter] = useState('');
  const [startBefore, setStartBefore] = useState('');
  const [overlay, setOverlay] = useState(false);
  const [calendar, setCalendar] = useState<{ owner: string; events: CalendarEvent[] }>();
  const [calendarError, setCalendarError] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const weekRegion = useRef<HTMLDivElement>(null);
  const owner = cache.getRequestScope().key;
  const monday = changeDay(day, -((weekday(day) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => changeDay(monday, index));
  const schedule = useMemo(() => offers.flatMap(offer => {
    const start = instant(offer.begin);
    return Number.isFinite(start) ? [{ offer, start, end: instant(offer.end), day: sportDay(start), clock: sportClock(start) }] : [];
  }).sort((a, b) => a.start - b.start), [offers]);
  const filtered = schedule.filter(item => {
    const state = registrationState(item.offer, now);
    return (!sport || item.offer.sport === sport) && (!category || sportCategory(item.offer.sport || item.offer.title) === category)
      && (!level || item.offer.level === level) && (!offerType || cardOfferType(item.offer) === offerType)
      && (!location || item.offer.location === location) && (!dayOfWeek || String(weekday(item.day)) === dayOfWeek)
      && (!startAfter || item.clock >= startAfter) && (!startBefore || item.clock <= startBefore)
      && (!favourites || isFavourite(item.offer)) && (!registered || isRegistered(item.offer))
      && (!(available || dropIn) || available && state === 'available' || dropIn && state === 'drop_in');
  });
  const dateRange = weekly ? days : [day];
  const visible = filtered.filter(item => dateRange.includes(item.day));
  const next = filtered.find(item => item.day > day)?.day;
  const timetable = overlay && calendar?.owner === owner ? calendar.events : [];
  const conflicts = ({ start, end }: (typeof schedule)[number]) =>
    timetable.some(event => instant(event.start_iso) < end && instant(event.end_iso) > start);

  useEffect(() => {
    const region = weekRegion.current;
    const selected = region?.querySelector<HTMLTableCellElement>('[data-selected-day]');
    if (region && selected) region.scrollLeft = Math.max(0, selected.offsetLeft - 64);
  }, [weekly, day]);

  useEffect(() => {
    if (!overlay) return;
    let active = true;
    const requestedOwner = cache.getRequestScope().key;
    const clear = () => { active = false; setCalendar(undefined); setOverlay(false); setCalendarLoading(false); };
    window.addEventListener('betterilias-logged-out', clear);
    window.addEventListener('betterilias-session-changed', clear);
    setCalendarLoading(true);
    setCalendarError(false);
    void api.getCalendar('ALL').then(result => {
      if (active && cache.getRequestScope().key === requestedOwner) {
        setCalendar({ owner: requestedOwner, events: (result.events ?? []).filter(event =>
          !event.all_day && !event.cancelled && !event.is_cancelled && event.kind !== 'deadline') });
      }
    }).catch(() => { if (active) setCalendarError(true); }).finally(() => { if (active) setCalendarLoading(false); });
    return () => {
      active = false;
      window.removeEventListener('betterilias-logged-out', clear);
      window.removeEventListener('betterilias-session-changed', clear);
    };
  }, [overlay, owner]);

  const options = (key: 'sport' | 'level' | 'location'): [string, string][] =>
    [...new Set(offers.map(offer => offer[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, language)).map(value => [value, value]);
  const setDirection = (direction: number) => changeSchedule(() => setDay(changeDay(day, direction * (weekly ? 7 : 1))));
  const weekEntries = days.map(date => [
    ...visible.filter(item => item.day === date).map(item => ({ ...item, label: item.offer.title, event: undefined })),
    ...timetable.filter(event => sportDay(instant(event.start_iso)) === date).map(event => ({
      offer: undefined, start: instant(event.start_iso), end: instant(event.end_iso), day: date,
      clock: sportClock(instant(event.start_iso)), label: event.title || event.course_title, event,
    })),
  ].sort((a, b) => a.start - b.start));
  const activeHours = weekEntries.flat().flatMap(item => [item.clock, sportDay(item.end) === item.day ? sportClock(item.end) : ''])
    .filter(Boolean).map(clock => Number(clock.slice(0, 2)));
  const firstHour = activeHours.length ? Math.max(0, Math.min(...activeHours) - 1) : 7;
  const lastHour = activeHours.length ? Math.min(23, Math.max(firstHour + 5, Math.max(...activeHours) + 1)) : 22;
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, hour) => String(hour + firstHour).padStart(2, '0'));

  return <section className="min-w-0 space-y-4" aria-labelledby="unisport-schedule-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="unisport-schedule-title" className="text-xl font-bold">{t('unisport.schedule')}</h2>
      <div className="flex flex-wrap gap-1">
        <Button aria-pressed={!weekly} variant={weekly ? 'outline' : 'primary'} onClick={() => changeSchedule(() => setWeekly(false))}>
          <List size={16} className="hidden @sm:block" aria-hidden="true" />{t('unisport.agenda')}
        </Button>
        <Button aria-pressed={weekly} variant={weekly ? 'primary' : 'outline'} onClick={() => changeSchedule(() => setWeekly(true))}>
          <CalendarDays size={16} className="hidden @sm:block" aria-hidden="true" />{t('unisport.week')}
        </Button>
      </div>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 basis-full space-y-1 text-sm font-medium @sm:basis-auto">
        <span>{t('unisport.date')}</span>
        <input type="date" value={day} onChange={event => {
          const date = event.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))) changeSchedule(() => setDay(date));
        }} className={sportControl} />
      </label>
      <IconButton label={t(weekly ? 'unisport.previous_week' : 'unisport.previous_day')} onClick={() => setDirection(-1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <IconButton label={t(weekly ? 'unisport.next_week' : 'unisport.next_day')} onClick={() => setDirection(1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
      <Button onClick={() => changeSchedule(() => setDay(today))}>{t('unisport.today')}</Button>
    </div>
    <div className="grid grid-cols-2 gap-2 @xl:flex @xl:flex-wrap">
      <Toggle label={t('unisport.favourites')} active={favourites} toggle={() => changeSchedule(() => setFavourites(!favourites))} />
      <Toggle label={t('unisport.state_available')} shortLabel={t('unisport.open_short')} active={available}
        toggle={() => changeSchedule(() => setAvailable(!available))} />
      <Toggle label={t('unisport.state_drop_in')} active={dropIn} toggle={() => changeSchedule(() => setDropIn(!dropIn))} />
      <Toggle label={t('unisport.applications')} active={registered} toggle={() => changeSchedule(() => setRegistered(!registered))} />
      {cache.getSessionId() && <Toggle label={t('unisport.show_timetable')} shortLabel={t('unisport.timetable_short')}
        active={overlay} toggle={() => setOverlay(!overlay)} />}
    </div>
    {calendarLoading && <p role="status">{t('unisport.loading_timetable')}</p>}
    {overlay && calendarError && <p role="alert">{t('calendar.load_failed')}</p>}
    <details className="rounded-xl border border-slate-200 px-3 dark:border-slate-700">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold"><SlidersHorizontal size={16} className="mr-2 inline" aria-hidden="true" />{t('unisport.advanced_filters')}</summary>
      <div className="grid gap-3 pb-3 @lg:grid-cols-2 @3xl:grid-cols-3">
        <SportSelect label={t('unisport.sport_type')} value={sport} onChange={value => changeSchedule(() => setSport(value))} options={options('sport')} />
        <SportSelect label={t('unisport.sport_category')} value={category} onChange={value => changeSchedule(() => setCategory(value))}
          options={sportCategories.map(value => [value, t(`unisport.category_${value}`)])} />
        <SportSelect label={t('unisport.level')} value={level} onChange={value => changeSchedule(() => setLevel(value))} options={options('level')} />
        <SportSelect label={t('unisport.offer_type')} value={offerType} onChange={value => changeSchedule(() => setOfferType(value))}
          options={cardOfferTypes.map(value => [value, t(`unisport.card_type_${value}`)])} />
        <SportSelect label={t('unisport.location')} value={location} onChange={value => changeSchedule(() => setLocation(value))} options={options('location')} />
        <SportSelect label={t('unisport.weekday')} value={dayOfWeek} onChange={value => changeSchedule(() => setDayOfWeek(value))}
          options={Array.from({ length: 7 }, (_, index) => [String((index + 1) % 7),
            new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + index)))])} />
        <label className="min-w-0 space-y-1 text-sm font-medium">{t('unisport.starts_after')}
          <input type="time" className={sportControl} value={startAfter} onChange={event => {
            const value = event.currentTarget.value;
            changeSchedule(() => setStartAfter(value));
          }} />
        </label>
        <label className="min-w-0 space-y-1 text-sm font-medium">{t('unisport.starts_before')}
          <input type="time" className={sportControl} value={startBefore} onChange={event => {
            const value = event.currentTarget.value;
            changeSchedule(() => setStartBefore(value));
          }} />
        </label>
      </div>
    </details>
    {!weekly ? <>
      <h3 className="font-semibold">{sportDayLabel(day, language)}</h3>
      <div className="grid gap-3 @4xl:grid-cols-2">
        {visible.map(item => <SportSession key={item.offer.id + ':' + item.offer.begin} offer={item.offer}
          actions={getActions(item.offer)} conflict={conflicts(item)} onDetails={() => openOffer(item.offer)}
          onSport={() => openSport(item.offer.sport)} />)}
      </div>
      {!visible.length && <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
        <p>{t('unisport.no_sessions')}</p>
        {next && <Button onClick={() => setDay(next)}>{t('unisport.next_session_day', { date: sportDayLabel(next, language, 'short') })}</Button>}
      </div>}
    </> : <div ref={weekRegion} role="region" aria-label={t('unisport.week')} tabIndex={0} className="relative overflow-x-auto rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-700">
      <table className="relative w-full min-w-[52rem] table-fixed border-collapse text-left text-sm">
        <thead className="bg-slate-100 dark:bg-slate-800"><tr>
          <th scope="col" className="sticky left-0 z-10 w-16 bg-slate-100 p-2 dark:bg-slate-800">{t('unisport.time')}</th>
          {days.map(date => <th key={date} scope="col" data-selected-day={day === date ? '' : undefined}
            className={`p-2 ${day === date ? 'bg-teal-100 dark:bg-teal-950' : ''}`}>{sportDayLabel(date, language, 'short')}</th>)}
        </tr></thead>
        <tbody>{hours.map(hour => <tr key={hour} className="border-t border-slate-200 dark:border-slate-700">
          <th scope="row" className="sticky left-0 z-10 bg-white px-2 py-2 align-top font-medium dark:bg-slate-900">{hour}:00</th>
          {weekEntries.map((entries, index) => <td key={days[index]} className="space-y-1 border-l border-slate-200 p-1 align-top dark:border-slate-700">
            {entries.filter(item => item.clock.startsWith(hour)).map(item => item.offer
              ? <Button key={item.offer.id + ':' + item.offer.begin} variant="ghost" onClick={() => openOffer(item.offer)}
                className={`w-full !justify-start break-words !rounded-md !px-1.5 text-left ${isRegistered(item.offer)
                  ? 'bg-teal-100 dark:bg-teal-900' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <span className="min-w-0"><span className="block text-xs">{item.clock} · {sportClock(item.end)}{conflicts({ ...item, offer: item.offer }) && ' ⚠'}</span>{item.label}
                  {isRegistered(item.offer) && <span className="block text-xs">{t('unisport.on_registration_list')}</span>}
                  {conflicts({ ...item, offer: item.offer }) && <span className="block text-xs">{t('unisport.timetable_conflict')}</span>}</span>
              </Button>
              : <div key={item.event.uid} className="break-words rounded-md bg-indigo-100 p-1.5 dark:bg-indigo-950">
                <span className="block text-xs">{item.clock} · {sportClock(item.end)}</span><span className="block">{item.label}</span>
                <span className="block text-xs">{t('unisport.timetable_entry')}</span>
              </div>)}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    {weekly && !visible.length && <p role="status">{t('unisport.no_sessions')}</p>}
  </section>;
}
