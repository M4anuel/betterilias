import { getLanguage, t } from './i18n';
import { navigationGuard } from './navigationGuard';

export const requestStatuses = ['open', 'planned', 'in_progress', 'completed', 'declined'] as const;
export const requestCategories = ['feature', 'qol', 'ilias'] as const;
export type RequestStatus = typeof requestStatuses[number];
export type RequestCategory = typeof requestCategories[number];
export interface RequestImage { id: string; variants: { width: number; height: number; url: string }[] }
export interface RequestComment { id: string; nickname: string; message: string; created: number; updated: number; owned: boolean }
export interface FeatureRequest {
  id: string; title: string; description: string; category: RequestCategory; status: RequestStatus;
  nickname: string; created: number; updated: number; owned: boolean; score: number; my_vote: number;
  comment_count: number; comments?: RequestComment[]; images: RequestImage[]; images_archived: boolean;
}
export interface RequestPage { items: FeatureRequest[]; has_more: boolean; storage?: { used: number; limit: number } }
export interface RequestDraft { title: string; description: string; category: RequestCategory; nickname: string; images: string[] }

let identityPromise: Promise<unknown> | undefined;
export async function communityRequest<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const mutation = Boolean(init.method && init.method !== 'GET');
  const headers = new Headers(init.headers);
  headers.set('Accept-Language', getLanguage());
  if (mutation) {
    headers.set(admin ? 'X-Admin-Request' : 'X-Community-Request', '1');
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    navigationGuard.incrementPending();
  }
  try {
    const response = await fetch(`/api/${admin ? 'admin/' : ''}feature-requests${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(typeof data?.detail === 'string' ? data.detail : t('requests.failed'));
    }
    return await response.json() as T;
  } finally { if (mutation) navigationGuard.decrementPending(); }
}
export async function communityIdentity() {
  if (!identityPromise) identityPromise = communityRequest('/identity', { method: 'POST' }).finally(() => { identityPromise = undefined; });
  await identityPromise;
}
export const requestApi = {
  list: (query: string, admin = false) => communityRequest<RequestPage>(`?${query}`, {}, admin),
  detail: (id: string, admin = false) => communityRequest<FeatureRequest>(`/${id}`, {}, admin),
  write: async <T,>(path: string, method: string, payload?: unknown, admin = false) => {
    if (!admin) await communityIdentity();
    return communityRequest<T>(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) }, admin);
  },
  upload: async (file: File) => {
    await communityIdentity();
    return communityRequest<{ id: string }>('/images', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  },
};
