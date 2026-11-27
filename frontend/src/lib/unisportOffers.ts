export type UnisportOffer = {
  id: number; title: string; sport: string; begin: string; end: string;
  opens: string; closes: string; level: string; location: string; address: string;
  status: string; free_places: string; cancelled: boolean; url: string | null;
  registration_state?: number | null;
  requires_confirmation?: boolean | null;
  schedule_day?: string; schedule_time?: string; date_range?: string; sport_url?: string | null;
  offer_type?: SportOfferType | null;
  infos?: { title: string; content: string }[]; important?: string; special?: string; outage?: string;
};
export type UnisportCatalogue = { items: UnisportOffer[]; sports: string[] };
export const sportOfferTypes = ['training', 'date_range', 'dated'] as const;
export type SportOfferType = (typeof sportOfferTypes)[number];
// Discovery categories curated from the public English and German names.
// New sports remain discoverable under Other until categorised.
const categoryNames = {
  ball: ['badminton', 'basketball', 'beach tennis', 'beach volleyball', 'beachvolleyball', 'burner games®',
    'darts', 'flag football', 'floorball', 'fussball', 'futsal', 'handball', 'soccer', 'squash', 'table tennis',
    'tennis', 'tischtennis', 'ultimate frisbee', 'unihockey', 'volleyball'],
  fitness: ['35+', 'advice on training', 'antara', 'bodyforming', 'box-fitness', 'bungee workout', 'calisthenics',
    'cardio step', 'cardio workout', 'circuit', 'deepwork', 'fit ins weekend', 'fitboxe', 'hot iron', 'indoor cycling',
    'kondi', 'krafttraining', 'online-fitness', 'strength training', 'trainingsberatung'],
  dance: ['acrobatics', 'aerial lyra', 'aerial silk', 'afro dance', 'akrobatik', 'apparatus gymnastics', 'bachata',
    'ballet', 'ballett', 'bodymovement', 'breakdance', 'bungee dance', 'circus arts', 'contemporary dance',
    'dance', 'flamenco', 'flow arts', 'geräteturnen', 'handstand', 'hiphop', 'jazz dance', 'jazzdance',
    'lindy hop', 'manege', 'salsa', 'standard- und lateintänze', 'vertikaltuchakrobatik'],
  outdoor: ['archery', 'bogenschiessen', 'bouldering', 'bouldern', 'cross country skiing', 'curling', 'eishockey',
    'eiskunstlauf', 'figure skating', 'freestyle off-snow training', 'high-altitude mountain tours', 'hochtouren',
    'ice hockey', 'indoor climbing', 'indoorklettern', 'langlauf', 'laufsport', 'outdoor climbing', 'outdoorklettern',
    'racing bike', 'rennvelo', 'running', 'ski', 'ski/snowboard', 'ski-/snowboard tours', 'ski-/snowboardtouren',
    'skiing', 'slackline', 'snowboard', 'wandern/trekking'],
  water: ['hydro-gym', 'kajak', 'kayaking', 'sailing', 'schwimmen', 'scuba-diving', 'segeln', 'swimming',
    'underwater rugby', 'unterwasserrugby', 'wasserfitness'],
  combat: ['boxen', 'boxing', 'brazilian jiu-jitsu', 'capoeira', 'fechten', 'fencing', 'jodo', 'judo', 'karate',
    'kendo', 'kick boxing', 'kickboxen', 'krav maga', 'kungfu', 'taekwondo'],
  wellbeing: ['acro yoga', 'atem und bewegung', 'breathing and movement', 'feldenkrais', 'flying yoga',
    'forest bathing «shinrin yoku»', 'mental health', 'mentale gesundheit', 'pilates', 'self-hypnosis',
    'selbsthypnose', 'yoga'],
} satisfies Record<string, string[]>;

type SportCategory = keyof typeof categoryNames | 'other';
const categoryBySport = new Map<string, SportCategory>();
for (const category of Object.keys(categoryNames) as (keyof typeof categoryNames)[]) {
  for (const name of categoryNames[category]) categoryBySport.set(name, category);
}
export const sportCategories = [...Object.keys(categoryNames) as (keyof typeof categoryNames)[], 'other'] as const;
export function sportCategory(name: string): SportCategory {
  return categoryBySport.get(name.trim().toLowerCase()) ?? 'other';
}

export type SportView = 'overview' | 'explore' | 'schedule' | 'my_sport';
export type SportSelection = { sport: string; offerId?: number };
export type SportRoute = { view: SportView; selection?: SportSelection };

export function readSportRoute(params: URLSearchParams): SportRoute {
  const view = params.get('sportView');
  if (view !== 'explore') return { view: view === 'schedule' || view === 'my_sport' ? view : 'overview' };
  const sport = params.get('sport');
  const offer = Number(params.get('offer'));
  return {
    view,
    ...(sport && sport.length <= 512 ? {
      selection: { sport, ...(Number.isSafeInteger(offer) && offer > 0 ? { offerId: offer } : {}) },
    } : {}),
  };
}

export type UnisportApplication = {
  id?: number; title?: string; status?: number; registration?: string; begin?: string;
  end?: string; offerNextDate?: { begin?: string; end?: string };
};

const zone = 'Europe/Zurich';
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short' });
const clockFormat = new Intl.DateTimeFormat('de-CH', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function instant(value?: string): number {
  return value && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

export function sportDay(time: number): string {
  return Number.isFinite(time) ? dayFormat.format(time) : '';
}

export function sportClock(time: number): string {
  return Number.isFinite(time) ? clockFormat.format(time) : '';
}

export function changeDay(day: string, delta: number): string {
  const time = Date.parse(day);
  return Number.isFinite(time) ? new Date(time + delta * 86_400_000).toISOString().slice(0, 10) : day;
}

export function sportDayLabel(day: string, language: string, weekday: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(language === 'de' ? 'de-CH' : 'en-GB', {
    timeZone: 'UTC', weekday, month: 'short', day: 'numeric',
  }).format(new Date(day + 'T12:00:00Z'));
}

export function applicationStart(item: UnisportApplication): string {
  return item.begin || item.offerNextDate?.begin || '';
}

export function occurrenceKey(id: number | undefined, begin: string): string {
  return JSON.stringify([id, instant(begin)]);
}

export function registrationState(offer: UnisportOffer, now: number) {
  const opens = instant(offer.opens), closes = instant(offer.closes);
  if (offer.cancelled) return 'cancelled';
  if (offer.registration_state === 7) return 'drop_in';
  if (closes <= now || instant(offer.begin) <= now || offer.registration_state === 3) return 'closed';
  if (opens > now) return 'opening';
  if (offer.registration_state === 6) return 'full';
  if (offer.registration_state === 1) return 'available';
  return 'check';
}

export function downloadSportCalendar(title: string, start: number, end: number, location: string, reminder = false) {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/[;,]/g, '\\$&');
  const format = (time: number) => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BetterIlias//Unisport//EN', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@betterilias`, `DTSTAMP:${format(Date.now())}`, `DTSTART:${format(start)}`,
    ...(end > start ? [`DTEND:${format(end)}`] : []), `SUMMARY:${escape(title)}`, `LOCATION:${escape(location)}`,
    ...(reminder ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', `DESCRIPTION:${escape(title)}`, 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'unisport.ics';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Website course IDs differ from UniApp IDs; derive only from known ZSSW offers. */
export function unisportParticipantsUrl(offerUrl?: string | null): string | null {
  if (!offerUrl || /[\\\x00-\x20\x7f]/.test(offerUrl)) return null;
  try {
    const parsed = new URL(offerUrl);
    if (parsed.origin !== 'https://www.zssw.unibe.ch' || parsed.username || parsed.password) return null;
    const course = /^\/usp\/zms\/(?:angebot|program|offre)\/([1-9]\d*)\/index_(?:ger|eng|fra)\.html$/.exec(parsed.pathname);
    return course ? `https://www.zssw.unibe.ch/usp/zms/aii/anmeldeliste/${course[1]}/index_ger.html` : null;
  } catch { return null; }
}

/** UniSport dates refer to Bern; preserve unknown formats instead of guessing. */
export function unisportDate(value: string, language: string): string {
  if (!value) return '';
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'de' ? 'de-CH' : 'en-GB', {
    timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}
