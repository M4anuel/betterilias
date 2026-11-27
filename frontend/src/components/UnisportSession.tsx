import { Bell, CalendarPlus, ExternalLink, Heart, MapPin } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { downloadSportCalendar, instant, registrationState, sportClock, sportDay, unisportDate, type UnisportOffer } from '../lib/unisportOffers';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { UnisportBooking } from './UnisportBooking';

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

export function RegistrationAction({ offer, actions }: { offer: UnisportOffer; actions: SessionActions }) {
  const { account, registered, canCancel, now } = actions;
  const state = registrationState(offer, now);
  const start = instant(offer.begin);
  if (state === 'drop_in' && Number.isFinite(start)) {
    return <Button onClick={() => downloadSportCalendar(offer.title, start, instant(offer.end), offer.location)}>
      <CalendarPlus size={16} aria-hidden="true" />{t('unisport.add_calendar')}
    </Button>;
  }
  if (state === 'opening' && !registered) {
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
      offerId={offer.id} begin={offer.begin} kind={kind} quick={quick}
      onBookingClosed={actions.onBookingClosed} />;
  }
  if (bookingAllowed && !account.affiliation) {
    return <span className="text-sm text-slate-600 dark:text-slate-400">{t('unisport.booking_login')}</span>;
  }
  return null;
}

export function SportSession({ offer, actions, onDetails, compact = false, conflict = false, showOpeningTime = true }: {
  offer: UnisportOffer; actions: SessionActions; onDetails?: () => void; compact?: boolean; conflict?: boolean; showOpeningTime?: boolean;
}) {
  const language = useLanguage();
  const state = registrationState(offer, actions.now);
  const start = instant(offer.begin), end = instant(offer.end);
  const duration = Math.round((end - start) / 60_000);
  const day = sportDay(start);
  const status = actions.registered ? actions.personalStatus || t('unisport.on_registration_list')
    : state === 'check' ? offer.status : t(`unisport.state_${state}`);
  const tone = state === 'cancelled' ? 'danger' : actions.registered ? 'info'
    : state === 'drop_in' || state === 'available' ? 'success' : state === 'opening' || state === 'full' ? 'warning' : 'neutral';

  return <article className={`min-w-0 rounded-xl border px-3 pb-3 pt-1.5 dark:bg-slate-900 ${actions.registered
    ? 'border-teal-400 bg-teal-50 dark:border-teal-600' : 'border-slate-200 bg-white dark:border-slate-700'}`}>
    <div className="flex items-start justify-between gap-1">
      <div className="min-w-0 break-words pt-2">
        {offer.sport && offer.sport !== offer.title && <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">{offer.sport}</p>}
        <h3 className="font-semibold">{onDetails
          ? <button type="button" onClick={onDetails} className="min-h-11 cursor-pointer rounded text-left underline decoration-slate-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-teal-500">{offer.title}</button>
          : offer.title}</h3>
      </div>
      <SportFavourite label={offer.title} active={actions.favourite} toggle={actions.toggleFavourite} />
    </div>
    <div className="space-y-1 break-words text-sm">
      {offer.begin && <p><time dateTime={offer.begin}>{compact && day ? sportClock(start) : unisportDate(offer.begin, language)}</time>
        {end > start && <> – <time dateTime={offer.end}>{sportDay(end) === day ? sportClock(end) : unisportDate(offer.end, language)}</time> · {t('unisport.duration', { count: duration })}</>}
      </p>}
      {(offer.location || offer.level) && <p className="flex items-start gap-1 text-slate-600 dark:text-slate-300">
        {offer.location && <MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
        <span>{[offer.location, offer.level].filter(Boolean).join(' · ')}</span>
      </p>}
      {(offer.date_range || (!compact && offer.offer_type === 'training' && offer.schedule_day)) && <p className="text-slate-600 dark:text-slate-300">
        {offer.date_range || [offer.schedule_day, offer.schedule_time].filter(Boolean).join(' · ')}
      </p>}
      <div className="flex flex-wrap gap-1.5">
        {offer.offer_type && <Badge tone="neutral">{t(`unisport.offer_type_${offer.offer_type}`)}</Badge>}
        {status && <Badge tone={tone}>{status}</Badge>}
        {actions.registered && state === 'cancelled' && <Badge tone="danger">{t('unisport.state_cancelled')}</Badge>}
        {offer.free_places && state !== 'cancelled' && <Badge tone="neutral">{offer.free_places}</Badge>}
        {conflict && <Badge tone="warning">{t('unisport.timetable_conflict')}</Badge>}
      </div>
      {state === 'opening' && showOpeningTime && <p>{t('unisport.registration_opens', { time: unisportDate(offer.opens, language) })}</p>}
      {(state === 'opening' || state === 'available' || state === 'check') && offer.closes && <p>{t('unisport.registration_closes', { time: unisportDate(offer.closes, language) })}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RegistrationAction offer={offer} actions={actions} />
        {!onDetails && offer.url && <OfficialSportLink url={offer.url} />}
      </div>
    </div>
  </article>;
}
