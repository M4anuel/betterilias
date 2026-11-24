import { t } from './i18n';
import { readPrivate, writePrivate, prunePrivateKind } from './unisportCache';
import { unisportCompanionRequest, UnisportCompanionError } from './unisport';

export type Participant = { last_name: string; first_name: string; offer: string };
export type ParticipantSnapshot = { items: Participant[]; fetched_at: number; context: string };
export const PARTICIPANTS_TTL = 5 * 60 * 1000;
const pending = new Map<string, Promise<ParticipantSnapshot>>();
let generation = 0;
window.addEventListener('unisport-private-cache-cleared', () => { ++generation; });

export function clearParticipantCache(): void { ++generation; prunePrivateKind('participants:'); }

export async function participantContext(scope: string, affiliation: string): Promise<string> {
  const result = await unisportCompanionRequest<{ context: string }>({ type: 'UNISPORT_PARTICIPANTS_CONTEXT', scope, affiliation }, 5000);
  if (!/^[a-f0-9]{64}$/.test(result?.context || '')) throw new Error(t('unisport.participants_read_failed'));
  return result.context;
}

/** Parse in an inert template, never the live page or an iframe. No HTML is rendered. */
export function parseParticipants(html: string): Participant[] {
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error(t('unisport.participants_read_failed'));
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,template').forEach(node => node.remove());
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
  for (const table of template.content.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')];
    const heading = rows.find(row => {
      const labels = [...row.querySelectorAll(':scope > th')].map(th => normalize(th.textContent || ''));
      return ['nachname', 'vorname', 'angebot'].every(label => labels.includes(label));
    });
    if (!heading) continue;
    const labels = [...heading.querySelectorAll(':scope > th')].map(th => normalize(th.textContent || ''));
    const columns = ['nachname', 'vorname', 'angebot'].map(label => labels.indexOf(label));
    const items: Participant[] = [];
    for (const row of rows) {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (!cells.length) continue;
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan')) >= 3
          && /^(keine (anmeldungen|teilnehmenden|teilnehmer|daten)|no (participants|registrations|data))/i.test(cells[0].textContent?.trim() || '')) continue;
      if (columns.some(index => index >= cells.length) || items.length >= 5000) throw new Error(t('unisport.participants_read_failed'));
      const values = columns.map(index => cells[index].textContent?.trim() || '');
      if ((!values[0] && !values[1]) || values.some(value => value.length > 2000)) throw new Error(t('unisport.participants_read_failed'));
      items.push({ last_name: values[0], first_name: values[1], offer: values[2] });
    }
    return items;
  }
  throw new UnisportCompanionError('participants_login_required', 'unisport.participants_login_required');
}

export async function loadParticipants(scope: string, affiliation: string, course: string, context: string, force = false): Promise<ParticipantSnapshot> {
  const kind = `participants:${course}:${context}`;
  const cached = !force && readPrivate<Participant[]> (scope, affiliation, kind, 'website-de', PARTICIPANTS_TTL);
  if (cached && Array.isArray(cached.data) && cached.data.length <= 5000 && cached.data.every(row => row
      && [row.last_name, row.first_name, row.offer].every(value => typeof value === 'string' && value.length <= 2000)))
    return { items: cached.data, fetched_at: cached.fetched_at, context };
  const key = JSON.stringify([scope, affiliation, course, context, generation]);
  const existing = pending.get(key);
  if (existing) return existing;
  const sequence = generation;
  const promise = (async () => {
    try {
      const result = await unisportCompanionRequest<{ context: string; html: string }>({ type: 'UNISPORT_PARTICIPANTS_READ', scope, affiliation, course, context });
      if (!result || typeof result.html !== 'string') throw new Error(t('unisport.participants_read_failed'));
      if (sequence !== generation || result.context !== context) throw new UnisportCompanionError('participants_session_changed', 'unisport.participants_session_changed');
      const items = parseParticipants(result.html);
      const fetched_at = writePrivate(scope, affiliation, kind, 'website-de', items);
      prunePrivateKind('participants:', 20);
      return { items, fetched_at, context };
    } catch (error) {
      if (error instanceof UnisportCompanionError && ['participants_login_required', 'participants_session_changed'].includes(error.code)) clearParticipantCache();
      throw error;
    }
  })();
  pending.set(key, promise);
  try { return await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
}

export function filterParticipants(items: Participant[], query: string): Participant[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return items.filter(item => tokens.every(token => normalize([item.last_name, item.first_name, item.offer].join(' ')).includes(token)));
}
