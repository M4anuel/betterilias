import { useId, useState, type ReactNode } from 'react';
import { Bell, CalendarDays, CalendarPlus, Clock, ExternalLink, Heart, MapPin, Star, Users } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { cardOfferType, downloadSportCalendar, instant, offerAvailability, registrationDate, registrationState, skillLevels, sportClock, type UnisportOffer } from '../lib/unisportOffers';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { UnisportBooking } from './UnisportBooking';
import { DialogShell } from './ui/DialogShell';
import { UnisportAutosignIn } from './UnisportAutosignIn';

export type SportAccount = { credential: string; scope?: string | null; affiliation: string | null };
export type SessionActions = {
  account: SportAccount;
  now: number;
  favourite: boolean;
  registered: boolean;
  canCancel: boolean;
  personalStatus?: string;
  reminded: boolean;
  toggleFavourite: () => void;
  toggleReminder: () => void;
  autoSignIn?: { active: boolean; toggle: () => void };
  onBookingClosed?: () => void;
};

const actionLink = 'inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300';

export function OfficialSportLink({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className={actionLink}>
    {t('unisport.official_offer')}<ExternalLink size={15} aria-hidden="true" />
  </a>;
}

export function SportFavourite({ label, active, toggle }: { label: string; active: boolean; toggle: () => void }) {
  return <IconButton variant="ghost" label={t('unisport.favourite_named', { name: label })} aria-pressed={active} onClick={toggle}
    className={active ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}>
    <Heart size={18} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
  </IconButton>;
}

export function RegistrationAction({ offer, actions, cardAction = false }: { offer: UnisportOffer; actions: SessionActions; cardAction?: boolean }) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const { account, registered, canCancel, now } = actions;
  const state = registrationState(offer, now);
  const start = instant(offer.begin);
  if (cardAction && state === 'drop_in') return null;
  if (state === 'drop_in' && Number.isFinite(start)) {
    return <Button onClick={() => downloadSportCalendar(offer.title, start, instant(offer.end), offer.location)}>
      <CalendarPlus size={16} aria-hidden="true" />{t('unisport.add_calendar')}
    </Button>;
  }
  if ((state === 'opening' || cardAction && reminderOpen) && !registered) {
    if (cardAction) return <>
      <Button variant="ghost" disabled={offerAvailability(offer).kind === 'full'}
        className="w-full !rounded-none !px-1 text-slate-500 dark:text-slate-400"
        aria-haspopup="dialog" onClick={() => setReminderOpen(true)}>{t('unisport.card_register')}</Button>
      {reminderOpen && <DialogShell title={t('unisport.card_opening_later')} size="small" onRequestClose={() => setReminderOpen(false)}
        description={t('unisport.card_reminder_question')} className="unisport-booking-dialog">
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button variant="primary" onClick={() => {
            if (!actions.reminded) actions.toggleReminder();
            setReminderOpen(false);
          }}><Bell size={16} aria-hidden="true" />{t(actions.reminded ? 'unisport.reminder_saved' : 'unisport.save_reminder')}</Button>
          <Button onClick={() => setReminderOpen(false)}>{t('Schliessen')}</Button>
        </div>
        <p className="mt-2 text-sm">{t('unisport.card_reminder_local')}</p>
      </DialogShell>}
    </>;
    return <Button aria-pressed={actions.reminded} onClick={actions.toggleReminder}>
      <Bell size={16} fill={actions.reminded ? 'currentColor' : 'none'} aria-hidden="true" />
      {t(actions.reminded ? 'unisport.reminder_saved' : 'unisport.save_reminder')}
    </Button>;
  }
  const bookingAllowed = state !== 'cancelled' && (registered ? canCancel : state === 'available' || state === 'check');
  if (bookingAllowed && account.scope && account.affiliation && Number.isFinite(start)) {
    const kind = registered ? 'cancel' : state === 'available' ? 'apply' : 'auto';
    const quick = kind === 'apply' && offer.offer_type === 'training' && offer.requires_confirmation === false;
    return <UnisportBooking key={JSON.stringify([account.scope, account.affiliation, offer.id, offer.begin, registered])}
      credential={account.credential} scope={account.scope} affiliation={account.affiliation}
      offerId={offer.id} begin={offer.begin} kind={kind} quick={quick} cardAction={cardAction}
      onBookingClosed={actions.onBookingClosed} />;
  }
  if (bookingAllowed && !account.affiliation) {
    if (cardAction) return <Button variant="ghost" disabled className="w-full !rounded-none !px-1"
      title={t('unisport.booking_login')}>{t('unisport.card_register')}</Button>;
    return <span className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.booking_login')}</span>;
  }
  return cardAction && !registered
    ? <Button variant="ghost" disabled className="w-full !rounded-none !px-1">{t('unisport.card_register')}</Button> : null;
}

const typeTone = {
  daily: 'border-[#65A30D] text-lime-800 dark:text-lime-300',
  date_range: 'border-[#EAB308] text-yellow-800 dark:text-yellow-300',
  training: 'border-[#0284C7] text-sky-800 dark:text-sky-300',
  dated: 'border-[#9333EA] text-purple-800 dark:text-purple-300',
};

function InfoRow({ icon: Icon, children }: { icon: typeof Clock; children: ReactNode }) {
  return <p className="flex min-w-0 items-start gap-1.5">
    <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 break-words">{children}</span>
  </p>;
}

export function SportSession({ offer, actions, onDetails, conflict = false, hideSport = false }: {
  offer: UnisportOffer; actions: SessionActions; onDetails?: () => void;
  conflict?: boolean; hideSport?: boolean;
}) {
  const language = useLanguage();
  const tooltip = useId();
  const state = registrationState(offer, actions.now);
  const type = cardOfferType(offer);
  const levels = skillLevels(offer.level);
  const availability = offerAvailability(offer);
  const start = instant(offer.begin), end = instant(offer.end);
  const weekday = Number.isFinite(start) ? new Intl.DateTimeFormat(language === 'de' ? 'de-CH' : 'en-GB', {
    weekday: 'short', timeZone: 'Europe/Zurich',
  }).format(start) : offer.schedule_day;
  const clock = Number.isFinite(start) ? [sportClock(start), end > start && sportClock(end)].filter(Boolean).join('–') : offer.schedule_time;
  const date = offer.date_range || (offer.offer_type !== 'training' && Number.isFinite(start) ? new Intl.DateTimeFormat(language === 'de' ? 'de-CH' : 'en-GB', {
    dateStyle: 'short', timeZone: 'Europe/Zurich',
  }).format(start) : '');
  const countLabel = availability.kind === 'places'
    ? t(availability.count === 1 ? 'unisport.card_one_place' : 'unisport.card_places', { count: availability.count })
    : t(`unisport.card_capacity_${availability.kind}`);
  const countTone = availability.kind === 'full' ? 'text-rose-700 dark:text-rose-300' : availability.kind === 'places'
    ? availability.count <= 3 ? 'text-amber-800 dark:text-amber-300' : 'text-green-800 dark:text-green-300'
    : 'text-slate-600 dark:text-slate-300';
  const showRegistration = state !== 'drop_in' && (!actions.registered || actions.canCancel && state !== 'cancelled');
  const showAuto = actions.autoSignIn && state !== 'drop_in' && state !== 'cancelled';
  const location = offer.location || offer.address;
  const openingTime = Number.isFinite(instant(offer.opens));
  const closingTime = Number.isFinite(instant(offer.closes));
  const status = state === 'cancelled' ? t('unisport.state_cancelled')
    : actions.registered ? actions.canCancel ? t('unisport.card_registered')
      : actions.personalStatus || t('unisport.on_registration_list')
    : state === 'check' ? t('unisport.card_unavailable')
    : state === 'opening' ? t('unisport.card_opening_later')
    : state === 'full' ? t('unisport.card_unavailable')
    : t(`unisport.state_${state}`);

  return <article aria-labelledby={tooltip} className="relative mt-2 flex min-w-0 flex-col rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
    {!hideSport && offer.sport && <span className="absolute -top-2.5 left-2 max-w-[calc(100%-1rem)] truncate rounded px-1.5 text-xs font-semibold text-teal-800 bg-white dark:bg-slate-900 dark:text-teal-300" title={offer.sport}>
      {offer.sport}
    </span>}
    <div className="flex flex-1 flex-col gap-2 px-3 pb-2 pt-3">
      <header className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <h3 id={tooltip} className="min-w-0 flex-1 basis-32 break-words text-base font-bold leading-snug">{onDetails
          ? <button type="button" onClick={onDetails} className="relative -my-2 min-h-11 w-full rounded py-2 text-left underline decoration-slate-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-teal-500">{offer.title}</button>
          : offer.title}</h3>
        {(offer.level || type) && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-xs">
          {offer.level && <span className="flex min-w-0 items-center gap-1 break-words font-semibold">
            {levels.length > 0 && <span aria-hidden="true" className="flex shrink-0 -space-x-1">
              {levels.map(level => <span key={level} className="size-3 rounded-full border border-white dark:border-slate-900"
                style={{ backgroundColor: `var(--sport-level-${level})` }} />)}
            </span>}
            {offer.level}
          </span>}
          {type && <span className={`rounded-md border px-1.5 py-0.5 font-semibold ${typeTone[type]}`}>{t(`unisport.card_type_${type}`)}</span>}
        </div>}
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-start gap-2 text-sm">
        <div className="min-w-0 space-y-1">
          {(weekday || clock) && <InfoRow icon={Clock}>{weekday}{weekday && clock && ' '}
            {clock && <span className={Number.isFinite(start) ? 'inline-block' : undefined}>{clock}</span>}
          </InfoRow>}
          {location && <InfoRow icon={MapPin}>{location}</InfoRow>}
          {date && <InfoRow icon={CalendarDays}>{date}</InfoRow>}
        </div>
        <div className={`justify-self-end ${countTone}`}><InfoRow icon={Users}>{countLabel}</InfoRow></div>
      </div>
      {conflict && <div><Badge tone="warning">{t('unisport.timetable_conflict')}</Badge></div>}
      {!onDetails && offer.url && <div><OfficialSportLink url={offer.url} /></div>}
      <div className="mt-auto space-y-0.5 pt-1 text-center text-xs text-slate-700 dark:text-slate-300" aria-live="polite">
        <p className={actions.canCancel && state !== 'cancelled' ? 'font-semibold text-green-800 dark:text-green-300' : 'font-semibold'}>{status}</p>
        {state !== 'drop_in' && <>
          {openingTime && <p>{type === 'daily'
            ? t('unisport.card_previous_day', { time: sportClock(instant(offer.opens)) })
            : t('unisport.registration_opens', { time: registrationDate(offer.opens, language) })}</p>}
          {closingTime && <p>{t('unisport.registration_closes', { time: registrationDate(offer.closes, language) })}</p>}
        </>}
        {actions.registered && actions.personalStatus && (actions.canCancel || state === 'cancelled') && <p>{actions.personalStatus}</p>}
        {showRegistration && !actions.registered && (state === 'available' || state === 'check') && !actions.account.affiliation &&
          <p>{t('unisport.booking_login')}</p>}
      </div>
    </div>
    <div className="flex min-w-0 divide-x divide-slate-200 border-t border-slate-200 dark:divide-slate-700 dark:border-slate-700">
      <div className={showRegistration || showAuto ? 'w-11 shrink-0' : 'min-w-11 flex-1'}>
        <Button variant="ghost" title={t('unisport.favourite_named', { name: offer.title })}
          aria-label={t('unisport.favourite_named', { name: offer.title })} aria-pressed={actions.favourite} onClick={actions.toggleFavourite}
          className={`w-full !rounded-none !px-1 ${actions.favourite ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>
          <Star size={19} fill={actions.favourite ? 'currentColor' : 'none'} aria-hidden="true" className="motion-safe:transition-transform active:scale-90" />
        </Button>
      </div>
      {showRegistration && <div className="min-w-11 flex-1"><RegistrationAction offer={offer} actions={actions} cardAction /></div>}
      {showAuto && actions.autoSignIn && <div className="min-w-0 flex-[1.25]"><UnisportAutosignIn {...actions.autoSignIn} /></div>}
    </div>
  </article>;
}
