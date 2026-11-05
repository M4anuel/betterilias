import { useSyncExternalStore } from 'react';
import { cache } from './cache';
import { getLanguage } from './i18n';

export type ReportingMode = 'ask' | 'always' | 'never';
export interface ReportingDisclosure { mode: ReportingMode; available: boolean; operator_name: string; privacy_url: string; retention_days: number; policy: number; preference_days: number }
type Capture = { capture_id: string; code: string; owner: string; disclosure: ReportingDisclosure };
type ConsentState = { capture: Capture | null; busy: boolean; error: string; saved: boolean };
let state: ConsentState = { capture: null, busy: false, error: '', saved: false };
let queue: Capture[] = [];
let generation = 0;
const listeners = new Set<() => void>();
const recent = new Map<string, number>();
function publish(change: Partial<ConsentState>) { state = { ...state, ...change }; listeners.forEach(fn => fn()); }
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function useDiagnosticConsent() { return useSyncExternalStore(subscribe, () => state); }

export async function reportingRequest<T>(path: string, init: RequestInit = {}, owner = cache.getSessionId()): Promise<T> {
  if (!owner || owner !== cache.getSessionId()) throw new Error('reports.connection_changed');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/diagnostics/${path}`, { ...init, credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal, headers: { 'X-Session-Id': owner, 'Accept-Language': getLanguage(),
        'Content-Type': 'application/json', ...init.headers } });
    if (owner !== cache.getSessionId()) throw new Error('reports.connection_changed');
    if (!response.ok) throw new Error(response.status === 410 ? 'reports.expired' : 'reports.unavailable');
    return await response.json() as T;
  } finally { window.clearTimeout(timer); }
}

export function considerDiagnosticResponse(headers: { get(name: string): string | null }, owner: string | null) {
  if (!owner || owner !== cache.getSessionId()) return;
  if (headers.get('X-Diagnostic-Report')) { publish({ saved: true }); return; }
  const capture_id = headers.get('X-Diagnostic-Capture');
  const code = headers.get('X-Diagnostic-Code') || '';
  if (!capture_id || !/^[a-f0-9]{32}$/.test(capture_id) || !/^[A-Z_]{1,40}$/.test(code)) return;
  const now = Date.now();
  if ((recent.get(code) || 0) > now - 60000 || queue.length >= 3) return;
  recent.set(code, now);
  if (recent.size > 20) recent.delete(recent.keys().next().value!);
  const current = generation;
  void reportingRequest<ReportingDisclosure>('preference', {}, owner).then(async disclosure => {
    if (current !== generation || !disclosure.available || owner !== cache.getSessionId()) return;
    if (disclosure.mode === 'never') return;
    if (disclosure.mode === 'always') {
      await reportingRequest('decision', { method: 'POST', body: JSON.stringify({ capture_id, decision: 'once' }) }, owner);
      if (current === generation) publish({ saved: true });
      return;
    }
    queue.push({ capture_id, code, owner, disclosure });
    if (!state.capture) publish({ capture: queue[0], error: '', saved: false });
  }).catch(() => {});
}

export async function clientDiagnostic(code: 'CLIENT_RENDER' | 'CLIENT_CONNECTION') {
  const owner = cache.getSessionId();
  if (!owner || (recent.get(code) || 0) > Date.now() - 60000) return;
  recent.set(code, Date.now());
  try {
    const result = await reportingRequest<{ capture_id?: string; code?: string; report_id?: string }>('client-capture',
      { method: 'POST', body: JSON.stringify({ code }) }, owner);
    recent.delete(code);
    considerDiagnosticResponse({ get: name => name === 'X-Diagnostic-Capture' ? result.capture_id || null :
      name === 'X-Diagnostic-Code' ? result.code || null : name === 'X-Diagnostic-Report' ? result.report_id || null : null }, owner);
  } catch { /* The original error remains visible; never recursively report reporting failures. */ }
}

export async function decideDiagnostic(decision: 'once' | 'always' | 'decline') {
  const capture = state.capture;
  if (!capture || state.busy) return;
  const current = generation;
  publish({ busy: true, error: '' });
  try {
    const result = await reportingRequest<{ saved: boolean }>('decision', { method: 'POST',
      body: JSON.stringify({ capture_id: capture.capture_id, decision }) }, capture.owner);
    if (current !== generation) return;
    queue = queue.filter(item => item !== capture);
    if (decision === 'always') {
      window.dispatchEvent(new Event('diagnostic-preference-changed'));
      // Same disclosed report class; explicitly chosen automatic consent also
      // covers this burst. The server remains the authority on tenant ownership.
      for (const item of queue) {
        try { await reportingRequest('decision', { method: 'POST', body: JSON.stringify({ capture_id: item.capture_id, decision: 'once' }) }, item.owner); }
        catch { /* Each candidate still expires; no unbounded retry queue. */ }
      }
      if (current !== generation) return;
      queue = [];
    }
    publish({ capture: queue[0] || null, busy: false, saved: result.saved });
  } catch (error) {
    if (current === generation) publish({ busy: false,
      error: (error as Error).message === 'reports.expired' ? 'reports.expired' : 'reports.unavailable' });
  }
}

export function dismissDiagnostic() {
  if (state.busy) return;
  const item = state.capture;
  if (item) void reportingRequest('decision', { method: 'POST',
    body: JSON.stringify({ capture_id: item.capture_id, decision: 'decline' }) }, item.owner).catch(() => {});
  queue = queue.filter(capture => capture !== item);
  publish({ capture: queue[0] || null, error: '', saved: false });
}

export async function setReportingMode(mode: ReportingMode) {
  const result = await reportingRequest<{ mode: ReportingMode }>('preference', { method: 'PUT', body: JSON.stringify({ mode }) });
  if (mode === 'never') resetDiagnosticQueue();
  window.dispatchEvent(new Event('diagnostic-preference-changed'));
  return result;
}
export function clearDiagnosticNotice() { publish({ saved: false }); }
function resetDiagnosticQueue() {
  ++generation; queue = []; recent.clear();
  publish({ capture: null, busy: false, error: '', saved: false });
}
window.addEventListener('betterilias-session-changed', resetDiagnosticQueue);
window.addEventListener('storage', event => { if (event.key === 'betterilias_session_id') resetDiagnosticQueue(); });
