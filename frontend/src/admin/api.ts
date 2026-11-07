import { getLanguage } from '../lib/i18n';

export interface AdminEvent {
  id: number; timestamp: number; code: string; category: string; level?: string;
  worker?: string; request_id?: string; operation_id?: string;
  method?: string; status?: number; duration_ms?: number; operation?: string;
  outcome?: string; component?: string;
  route?: string; parser?: string; reason?: string; error_kind?: string;
  app_version?: string; build?: string; stack_truncated?: boolean;
  stack?: CodeFrame[]; source?: CodeFrame;
}
export interface CodeFrame { file: string; function: string; line: number }
export interface EventPage { events: AdminEvent[]; next_before: number | null }
export interface AdminSession { authenticated: boolean; expires_at: number | null }
export interface ActivityBucket { start: number; end: number; count: number }
export interface ActivitySummary {
  active: number; last_24_hours: number; as_of: number;
  recent: ActivityBucket[]; hourly: ActivityBucket[];
  browsers?: ActivitySummary;
}
export interface AdminSummary {
  activity?: ActivitySummary;
  event_catalogue: Record<string, string>;
  diagnostics: {
    worker: string; queue_depth: number; dropped: number; storage_errors: number;
    console_errors: number; last_write: number | null; writer_alive: boolean;
    retention_seconds: number; retained_counts: Record<string, number>;
    app_version?: string; build?: string;
    retained_request_metrics: { count: number; mean_ms: number | null; max_ms: number | null; server_errors: number | null };
  };
  outbound: { requests: number; rejected: number; queue_wait_seconds: number; throttles: number; cooldown_until: number; queued: number };
}
export class AdminError extends Error {
  status: number;
  constructor(status: number) { super('ADMIN_REQUEST_FAILED'); this.status = status; }
}
export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept-Language', getLanguage());
  if (init.method && init.method !== 'GET') {
    headers.set('X-Admin-Request', '1');
    headers.set('Content-Type', 'application/json');
  }
  // Deliberately independent of the student's API helper and localStorage.
  const response = await fetch(`/api/admin/${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new AdminError(response.status);
  return response.json() as Promise<T>;
}
