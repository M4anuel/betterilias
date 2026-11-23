import { getLanguage, t } from './i18n';

const KEY = 'betterilias_unisport_session';
export function unisportCredential(): string {
  let credential = localStorage.getItem(KEY);
  if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential)) {
    credential = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    localStorage.setItem(KEY, credential);
  }
  return credential;
}

export async function unisportFetch<T>(path: string, credential: string, method = 'GET', body?: unknown, signal?: AbortSignal, scope?: string, affiliation?: string): Promise<T> {
  const response = await fetch('/api/unisport' + path, {
    method, credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Unisport-Session': credential, 'Accept-Language': getLanguage(),
      ...(scope ? { 'X-Unisport-Scope': scope } : {}), ...(affiliation ? { 'X-Unisport-Affiliation': affiliation } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.headers.get('X-Unisport-Connection-Changed') === '1') window.dispatchEvent(new Event('unisport-connection-changed'));
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : t('unisport.read_failed'));
  return data as T;
}

export function unisportCompanion(message: Record<string, unknown>): Promise<void> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(false), 5000);
    const listener = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'UNISPORT_REPLY' && event.data.requestId === requestId) finish(event.data.success === true);
    };
    function finish(success: boolean) {
      clearTimeout(timeout); window.removeEventListener('message', listener);
      if (success) resolve(); else reject(new Error(t('unisport.companion_required')));
    }
    window.addEventListener('message', listener);
    window.postMessage({ ...message, requestId }, location.origin);
  });
}
