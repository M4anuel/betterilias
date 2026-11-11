import { apiError, sessionFetch } from './api';
import { t } from './i18n';

export type ForumAction = 'close' | 'reopen' | 'makesticky' | 'unmakesticky' | 'delete';
export interface ForumThread {
  id: string; title: string; author: string; last_post: string; post_count: number;
  view_count?: number | null;
  unread: boolean; closed: boolean; sticky: boolean; actions: ForumAction[];
}
export interface ForumOverview {
  ref_id: string; title: string; intro_html: string; threads: ForumThread[];
  can_create: boolean; can_edit_page: boolean; editor_url: string | null; page: number; has_more: boolean;
}
export interface ForumPost {
  id: string; subject: string; author: string; date: string; edited: string; html: string;
  avatar_url: string | null; depth: number; can_reply: boolean; can_edit: boolean;
  attachments?: { title: string; url: string }[];
}
export interface ForumConversation {
  ref_id: string; thread_id: string; title: string; posts: ForumPost[]; closed: boolean; page: number; has_more: boolean;
}
export interface ForumWrite {
  operation_id: string; subject: string; message: string; parent_id?: string; edit_post_id?: string; notify: boolean; page?: number;
}
export interface ForumTextBlock { id: string; content: string; characteristic: string }
export interface ForumPage {
  ref_id: string; revision: string; blocks: ForumTextBlock[]; append_after_id: string;
  preview_html: string; other_components: number;
  elements: { id: string; text_block: ForumTextBlock | null; preview_html: string }[];
}
export interface ForumPageWrite {
  operation_id: string; revision: string; action: 'insert' | 'update' | 'delete';
  block_id?: string; after_id?: string; content?: string;
}
async function result<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, init);
  if (!response.ok) throw Object.assign(new Error(apiError(await response.json().catch(() => ({}))) || t('forum.load_failed')), { status: response.status });
  return response.json();
}
const base = (ref: string) => `/api/forums/${encodeURIComponent(ref)}`;
export const forumApi = {
  page: (ref: string) => result<ForumPage>(`${base(ref)}/page`),
  writePage: (ref: string, request: ForumPageWrite) => result<ForumPage>(`${base(ref)}/page`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }),
  overview: (ref: string, page = 0) => result<ForumOverview>(`${base(ref)}?page=${page}`),
  thread: (ref: string, id: string, page = 0) => result<ForumConversation>(`${base(ref)}/threads/${encodeURIComponent(id)}?page=${page}`),
  edit: (ref: string, thread: string, post: string, page = 0) => result<{ subject: string; message: string }>(`${base(ref)}/threads/${thread}/posts/${post}/edit?page=${page}`),
  write: (ref: string, thread: string | null, payload: ForumWrite, files: File[]) => {
    const body = new FormData(); body.append('payload', JSON.stringify(payload));
    files.forEach(file => body.append('files', file));
    return result<{ thread_id: string; post_id: string }>(`${base(ref)}/threads${thread ? `/${thread}/posts` : ''}`, { method: 'POST', body });
  },
  moderate: (ref: string, thread: string, action: string) => result<ForumOverview>(`${base(ref)}/threads/${thread}/moderate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  }),
};
export const forumOperationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');

export function forumPlainText(html: string) {
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();
}

export function forumDate(value: string) {
  return value.replace(/^(Today|Heute|Yesterday|Gestern|Tomorrow|Morgen)(?=,|\s|$)/i, token => {
    const name = token.toLowerCase();
    return t(['today', 'heute'].includes(name) ? 'forum.today' : ['yesterday', 'gestern'].includes(name) ? 'forum.yesterday' : 'forum.tomorrow');
  }).replace(/\s+-\s+(by|von)\s+/i, ` - ${t('forum.by')} `);
}

/** Keep authored blocks, code and inline media while making editor/pasted HTML inert. */
export function forumMarkup(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.forum-scroll-region').forEach(node => node.replaceWith(...Array.from(node.childNodes)));
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math,template,form,input,button,textarea,select').forEach(node => node.remove());
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    if (!['p','br','strong','em','b','i','u','s','a','ul','ol','li','blockquote','pre','code','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','img','hr','div','span','details','summary'].includes(node.localName)) {
      node.replaceWith(...Array.from(node.childNodes)); continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const valid = ['href','src'].includes(attr.name) ? /^(https?:\/\/|\/api\/materials\/\d+\/download\?)/i.test(attr.value) :
        attr.name === 'class' ? /^ilc_[A-Za-z0-9_-]+(?: ilc_[A-Za-z0-9_-]+)*$/.test(attr.value) : ['alt','colspan','rowspan'].includes(attr.name);
      if (!valid) node.removeAttribute(attr.name);
    }
    if (node.localName === 'a') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  }
  doc.querySelectorAll('pre,table').forEach(node => {
    const region = doc.createElement('div'); region.className = 'forum-scroll-region';
    region.tabIndex = 0; region.setAttribute('role', 'region');
    region.setAttribute('aria-label', t(node.localName === 'table' ? 'forum.table' : 'forum.code'));
    node.replaceWith(region); region.append(node);
  });
  return doc.body.innerHTML;
}
