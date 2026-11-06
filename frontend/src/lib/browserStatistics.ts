// Optional first-party measurement. No identifier exists before explicit opt-in.
const KEY = 'betterilias_browser_statistics';
const TTL = 90 * 86400 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function browserStatisticsId(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value.version === 1 && UUID.test(value.id) && Number.isFinite(value.expires) && value.expires > Date.now()
      && value.expires <= Date.now() + TTL) return value.id;
    localStorage.removeItem(KEY);
  } catch { /* Storage restrictions must not break normal app requests. */ }
  return null;
}

export function setBrowserStatistics(enabled: boolean): boolean {
  try {
    if (enabled) localStorage.setItem(KEY, JSON.stringify({ version: 1, id: crypto.randomUUID(), expires: Date.now() + TTL }));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('betterilias-browser-statistics'));
    return true;
  } catch { return false; }
}

export function browserStatisticsHeaders(input: string, headers: Headers) {
  // This identifier must never reach ILIAS, admin APIs, auth, or error reports.
  headers.delete('X-BetterIlias-Browser-Id');
  if (!input.startsWith('/api/') || /^\/api\/(auth|admin|diagnostics)\//.test(input)) return;
  const id = browserStatisticsId();
  if (id) headers.set('X-BetterIlias-Browser-Id', id);
}
