export type UnisportOffer = {
  id: number; title: string; sport: string; begin: string; end: string;
  opens: string; closes: string; level: string; location: string; address: string;
  status: string; free_places: string; cancelled: boolean; url: string | null;
  infos?: { title: string; content: string }[]; important?: string; special?: string; outage?: string;
};
export type UnisportCatalogue = { items: UnisportOffer[]; sports: string[] };

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
