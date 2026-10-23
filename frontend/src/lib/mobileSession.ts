import { cache } from './cache';

export function mobileAppUrl(address: string): URL {
  let url: URL;
  try { url = new URL(address.trim()); }
  catch { throw new Error('Bitte gib die vollständige BetterIlias-Adresse mit http:// oder https:// ein.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Bitte verwende eine BetterIlias-Adresse mit http:// oder https://.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname)
      || ['0.0.0.0', '[::1]', '[::]'].includes(hostname)) {
    throw new Error('Diese Adresse ist nur am Desktop erreichbar. Verwende die WLAN- oder öffentliche Adresse deiner BetterIlias-Installation.');
  }
  url.search = '';
  url.hash = '';
  if (url.toString().length > 1024) throw new Error('Diese Adresse ist zu lang für den QR-Code. Verwende die Startadresse von BetterIlias.');
  return url;
}

export function mobileSessionUrl(address: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(sessionId) || sessionId === 'default') throw new Error('Diese Sitzung hat keinen gültigen Verbindungsschlüssel. Bitte synchronisiere sie erneut.');
  const url = mobileAppUrl(address);
  url.hash = new URLSearchParams({ session_id: sessionId }).toString();
  return url.toString();
}

// Run before React renders or starts any API request. The fragment never reaches the server.
export function importSessionFromUrl() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasFragmentKey = fragment.has('session_id');
  const hasQueryKey = url.searchParams.has('session_id');
  if (!hasFragmentKey && !hasQueryKey) return;
  const sessionId = (hasFragmentKey ? fragment.get('session_id') : url.searchParams.get('session_id'))?.trim();
  url.searchParams.delete('session_id');
  if (hasFragmentKey) {
    fragment.delete('session_id');
    url.hash = fragment.toString();
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  if (!sessionId || !/^[a-zA-Z0-9_-]{1,256}$/.test(sessionId)) return;
  if (cache.getSessionId() !== sessionId) cache.clearSessionContent();
  cache.setSessionId(sessionId);
}
