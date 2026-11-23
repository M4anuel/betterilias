import { cache } from './cache';
import type { FeedbackFilesResponse } from '../types';

const PREFIX = 'betterilias_feedback_files:';
type Entry = { data: FeedbackFilesResponse; timestamp: number };
const entries = new Map<string, Entry>();
const flights = new Map<string, Promise<FeedbackFilesResponse>>();
const revisions = new Map<string, number>();
function remember(key: string, entry: Entry) {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > 512) entries.delete(entries.keys().next().value!);
}
const metadata = (data: FeedbackFilesResponse): FeedbackFilesResponse => ({
  member_id: data.member_id,
  files: data.files.map(({ id, title, size, created_on, file_type, download_url }) =>
    ({ id, title, size, created_on, file_type, download_url })),
});
const aborted = () => new DOMException('Feedback request superseded', 'AbortError');
export const feedbackFilesKey = (exercise: string, member: string, assignment?: string) =>
  JSON.stringify([exercise, assignment || '', member]);

async function storageKey(resource: string, scope: ReturnType<typeof cache.getRequestScope>) {
  const owner = cache.getSessionId();
  if (!owner || !cache.getIliasSaverEnabled() || !globalThis.crypto?.subtle) return null;
  // No additional copy of the credential in browser storage. Persistence lasts
  // only for this tab; private file lists never enter localStorage.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner));
  if (scope.signal.aborted || cache.getRequestScope().key !== scope.key) throw aborted();
  const ownerPrefix = PREFIX + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') + ':';
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(PREFIX) && !key.startsWith(ownerPrefix)) sessionStorage.removeItem(key);
  }
  return ownerPrefix + resource;
}

function current(scope: ReturnType<typeof cache.getRequestScope>) {
  return !scope.signal.aborted && cache.getRequestScope().key === scope.key;
}

export const feedbackFilesCache = {
  async read(resource: string, load: () => Promise<FeedbackFilesResponse>): Promise<FeedbackFilesResponse> {
    const scope = cache.getRequestScope();
    if (!cache.getSessionId()) {
      const data = await load();
      if (!current(scope)) throw aborted();
      return data;
    }
    const key = scope.key + ':' + resource;
    const flight = flights.get(key);
    if (flight) return flight;
    const revision = revisions.get(key) || 0;
    const valid = () => current(scope) && (revisions.get(key) || 0) === revision;
    const ttl = cache.getIliasSaverEnabled() ? cache.getIliasSaverTtl() * 60000 : 30000;
    const promise = Promise.resolve().then(async () => {
      let persisted: string | null = null;
      try { persisted = await storageKey(resource, scope); } catch { /* Private browsing can disable storage. */ }
      if (!valid()) throw aborted();
      let entry = entries.get(key);
      if (!entry && persisted) {
        try {
          const parsed = JSON.parse(sessionStorage.getItem(persisted) || 'null');
          if (parsed && Array.isArray(parsed.data?.files) && Number.isFinite(parsed.timestamp)) entry = parsed;
        } catch { /* Ignore invalid or unavailable storage. */ }
      }
      if (entry && Date.now() - entry.timestamp < ttl) {
        remember(key, entry);
        return entry.data;
      }
      const data = metadata(await load());
      if (!valid()) throw aborted();
      remember(key, { data, timestamp: Date.now() });
      if (persisted && cache.getIliasSaverEnabled()) {
        try { sessionStorage.setItem(persisted, JSON.stringify(entries.get(key))); } catch { /* Memory caching still works. */ }
      }
      return data;
    }).catch(error => {
      if (!valid()) throw aborted();
      throw error;
    }).finally(() => { if (flights.get(key) === promise) flights.delete(key); });
    flights.set(key, promise);
    return promise;
  },

  invalidate(exercise: string, assignment?: string, member?: string) {
    const scope = cache.getRequestScope();
    const matches = (resource: string) => {
      try {
        const [ex, ass, id] = JSON.parse(resource);
        return ex === exercise && (assignment === undefined || ass === assignment) && (member === undefined || id === member);
      } catch { return false; }
    };
    for (const key of new Set([...entries.keys(), ...flights.keys(), ...revisions.keys()])) {
      const prefix = scope.key + ':';
      if (key.startsWith(prefix) && matches(key.slice(prefix.length))) {
        entries.delete(key); flights.delete(key);
        revisions.set(key, (revisions.get(key) || 0) + 1);
      }
    }
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(PREFIX) && matches(key.slice(key.indexOf(':', PREFIX.length) + 1))) sessionStorage.removeItem(key);
      }
    } catch { /* Storage may be disabled. */ }
  },

  async write(resource: string, data: FeedbackFilesResponse, scope = cache.getRequestScope()) {
    if (!current(scope) || !cache.getSessionId()) return;
    const key = scope.key + ':' + resource;
    revisions.set(key, (revisions.get(key) || 0) + 1);
    flights.delete(key);
    const entry = { data: metadata(data), timestamp: Date.now() };
    remember(key, entry);
    try {
      const persisted = await storageKey(resource, scope);
      if (persisted && current(scope) && cache.getIliasSaverEnabled() && entries.get(key) === entry) sessionStorage.setItem(persisted, JSON.stringify(entry));
    } catch { /* Memory caching still works. */ }
  },
};

function clearStoredLists() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
}
window.addEventListener('betterilias-session-changed', () => {
  entries.clear(); flights.clear(); revisions.clear();
  clearStoredLists();
});
window.addEventListener('betterilias-saver-changed', () => {
  if (!cache.getIliasSaverEnabled()) clearStoredLists();
});
