/** Public data persists in IndexedDB; private data only in account-scoped tab storage. */
export type Snapshot<T> = T & { fetched_at: number; stale: boolean };
export const CATALOGUE_TTL = 15 * 60 * 1000;
export const OFFER_TTL = 5 * 60 * 1000;
const PRIVATE_PREFIX = 'betterilias_unisport_private_v1:';
const memory = new Map<string, Snapshot<unknown>>();
let opening: Promise<IDBDatabase | null> | undefined;

function database(): Promise<IDBDatabase | null> {
  if (!opening) opening = new Promise(resolve => {
    try {
      const request = indexedDB.open('betterilias-unisport-public-v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('public', { keyPath: 'key' });
        store.createIndex('fetched', 'fetched_at');
      };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
      request.onerror = request.onblocked = () => { opening = undefined; resolve(null); };
    } catch { resolve(null); }
  });
  return opening;
}

export function fresh(snapshot: { fetched_at: number; stale?: boolean } | null, ttl: number): boolean {
  const age = snapshot ? Date.now() - snapshot.fetched_at * 1000 : Infinity;
  return Boolean(snapshot && !snapshot.stale && age >= 0 && age < ttl);
}

export async function readPublic<T>(key: string): Promise<Snapshot<T> | null> {
  const cached = memory.get(key) as Snapshot<T> | undefined;
  if (cached) return cached;
  try {
    const db = await database();
    if (!db) return null;
    return await new Promise(resolve => {
      const request = db.transaction('public').objectStore('public').get(key);
      request.onsuccess = () => {
        const value = request.result?.payload;
        resolve(value && typeof value.fetched_at === 'number' && Number.isFinite(value.fetched_at) ? value : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function writePublic<T>(key: string, payload: Snapshot<T>): Promise<void> {
  memory.set(key, payload);
  // Bound the fallback too; catalogue entries remain alongside recent details.
  while (memory.size > 130) {
    const oldest = [...memory.keys()].find(value => value.startsWith('offer:'));
    if (!oldest) break;
    memory.delete(oldest);
  }
  try {
    const db = await database();
    if (!db) return;
    await new Promise<void>(resolve => {
      const transaction = db.transaction('public', 'readwrite');
      const store = transaction.objectStore('public');
      store.put({ key, fetched_at: payload.fetched_at, payload });
      const count = store.count();
      count.onsuccess = () => {
        let remaining = count.result - 130;
        if (remaining <= 0) return;
        const cursor = store.index('fetched').openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current || remaining <= 0) return;
          if (String(current.primaryKey).startsWith('offer:')) { current.delete(); --remaining; }
          current.continue();
        };
      };
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  } catch { /* A full/disabled browser store must not prevent browsing. */ }
}

export function readPrivate<T>(scope: string, affiliation: string, kind: string, language: string, ttl = 60000): { data: T; fetched_at: number } | null {
  try {
    const raw = sessionStorage.getItem(PRIVATE_PREFIX + JSON.stringify([scope, affiliation, kind, language]));
    const value = raw ? JSON.parse(raw) : null;
    return value && fresh(value, ttl) ? value : null;
  } catch { return null; }
}

export function writePrivate<T>(scope: string, affiliation: string, kind: string, language: string, data: T, fetched_at = Date.now() / 1000): number {
  try { sessionStorage.setItem(PRIVATE_PREFIX + JSON.stringify([scope, affiliation, kind, language]), JSON.stringify({ data, fetched_at })); }
  catch { /* Private results remain available in the mounted component. */ }
  return fetched_at;
}

export function clearPrivate(): void {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PRIVATE_PREFIX)) sessionStorage.removeItem(key); }
  catch { /* Browser storage may be disabled. */ }
  window.dispatchEvent(new Event('unisport-private-cache-cleared'));
}

export function prunePrivateKind(kindPrefix: string, keep = 0): void {
  try {
    const entries = Object.keys(sessionStorage).filter(key => key.startsWith(PRIVATE_PREFIX)
      && String(JSON.parse(key.slice(PRIVATE_PREFIX.length))[2]).startsWith(kindPrefix));
    entries.sort((a, b) => JSON.parse(sessionStorage.getItem(b) || '{}').fetched_at - JSON.parse(sessionStorage.getItem(a) || '{}').fetched_at);
    for (const key of entries.slice(keep)) sessionStorage.removeItem(key);
  } catch { /* Storage is optional; no participant data is written elsewhere. */ }
}
