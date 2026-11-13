import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = new URL('../extensions/safari/', import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let n = 0; n < 150 && !check(); n++) await flush(); assert.ok(check()); }
function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
function harness({ alarms = true } = {}) {
  const h = { storage: {}, now: 1000000, cookie: 'cookie-A', posts: [], notices: [], opened: [], valid: true, fail: false, denied: false, alarmCreates: 0 };
  const api = {
    storage: { local: { get: async () => structuredClone(h.storage), set: async values => Object.assign(h.storage, structuredClone(values)),
      remove: async keys => { for (const key of keys) delete h.storage[key]; } } },
    cookies: { getAll: async () => { if (h.denied) throw Error('denied'); return h.cookie ? [
      { name: 'PHPSESSID', value: h.cookie, domain: 'ilias.unibe.ch' }, { name: '_shibsession_a', value: 'shib-A', domain: '.unibe.ch' },
      { name: 'preferences', value: 'never-forward' }, { name: 'il_bad[0]', value: 'never-forward' },
      { name: 'PHPSESSID', value: 'foreign-host', domain: 'evil.test' }] : []; } },
    tabs: { query: async () => [{ id: 1, url: 'https://betterilias.ch/course' }, { id: 2, url: 'https://betterilias.ch.evil.test/' }],
      get: async () => ({ url: h.activeUrl || 'https://ilias.unibe.ch/' }),
      sendMessage: async (id, message) => h.notices.push({ id, message }), create: async value => h.opened.push(value),
      onUpdated: event(), onActivated: event() },
    runtime: { id: 'safari-test', getURL: path => 'safari-web-extension://unit/' + path,
      getManifest: () => ({ version: '1.1.0' }), onMessage: event(), onInstalled: event(), onStartup: event() },
    action: { setBadgeText: async () => {} }
  };
  if (alarms) api.alarms = { get: async () => h.alarmExists ? {} : null,
    create: async () => { h.alarmCreates++; h.alarmExists = true; }, onAlarm: event() };
  h.worker = () => {
    class Clock extends Date { static now() { return h.now; } }
    const context = vm.createContext({ browser: api, URL, URLSearchParams, Date: Clock, crypto: webcrypto, TextEncoder,
      Uint8Array, AbortController, setTimeout, clearTimeout, navigator: { userAgent: 'Safari test' },
      fetch: async (url, init) => {
        assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
        if (url.endsWith('/mobile-session')) {
          assert.ok(init.headers['X-Session-Id']);
          return { ok: true, json: async () => ({ handoff_token: 'one-use-code' }) };
        }
        const payload = JSON.parse(init.body); h.posts.push(payload);
        assert.equal(payload.source, 'safari_extension');
        assert.equal(payload.cookies.preferences, undefined); assert.equal(payload.cookies['il_bad[0]'], undefined);
        assert.equal(payload.cookies.PHPSESSID, h.cookie);
        if (h.gate) await h.gate;
        if (h.fail) throw Error('offline');
        if (h.stall === 'headers') return new Promise(() => {});
        return { ok: h.httpStatus ? h.httpStatus < 400 : true, status: h.httpStatus || 200,
          json: async () => h.stall === 'body' ? new Promise(() => {}) :
            ({ success: h.valid, authenticated: h.valid, session_id: 'verified-' + payload.cookies.PHPSESSID, user_name: 'Student' }) };
      } });
    for (const file of ['config.js', 'core.js', 'background.js']) vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), context);
    h.context = context; return context.SafariCompanion;
  };
  h.api = api; h.core = h.worker();
  h.message = (message, sender = { id: 'safari-test', url: api.runtime.getURL('popup.html') }) => new Promise(resolve => {
    const listener = api.runtime.onMessage.listeners.at(-1);
    if (listener(message, sender, resolve) === false) resolve(undefined);
  });
  return h;
}

test('Safari verifies only auth cookies, hashes fingerprints and scopes tab delivery', async () => {
  const h = harness();
  assert.equal((await h.core.sync(true)).status, 'connected');
  assert.equal(h.notices.length, 1); assert.equal(h.notices[0].id, 1);
  assert.equal(h.storage.safariCompanion.sessionId, 'verified-cookie-A');
  assert.match(h.storage.safariCompanion.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(h.storage).includes('shib-A'));
  assert.equal(h.storage.safariCompanion.leaseUntil, 0);
  const publicState = await h.message({ type: 'SAFARI_GET_STATUS' });
  assert.equal(publicState.sessionId, undefined); assert.equal(publicState.fingerprint, undefined);
});

test('Safari observes a changed login even during the automatic cooldown', async () => {
  const h = harness(); await h.core.sync(false); h.cookie = 'cookie-B';
  await h.core.sync(false);
  assert.equal(h.posts.length, 2); assert.equal(h.storage.safariCompanion.sessionId, 'verified-cookie-B');
  assert.equal(h.notices.at(-1).message.sessionId, 'verified-cookie-B');
});

test('Safari wakeups retain cooldown/cache and do not postpone existing alarms', async () => {
  const h = harness(); await h.core.sync(false); await flush();
  assert.equal(h.alarmCreates, 1);
  h.core = h.worker(); await flush();
  await h.core.sync(false); assert.equal(h.posts.length, 1); assert.equal(h.alarmCreates, 1);
  h.now += 16000; await h.core.sync(false); assert.equal(h.posts.length, 1);
  h.now += 300001; await h.core.sync(false); assert.equal(h.posts.length, 2);
});

test('Safari survives missing alarm APIs and automatic-off still permits manual sync', async () => {
  const h = harness({ alarms: false });
  await h.core.preferences({ autoSyncEnabled: false });
  assert.equal((await h.core.sync()).status, 'disabled'); assert.equal(h.posts.length, 0);
  assert.equal((await h.core.sync(true)).status, 'connected');
});

test('Safari activity wakes sync only for the configured app or ILIAS', async () => {
  const h = harness(); const updated = h.api.tabs.onUpdated.listeners[0];
  updated(1, { status: 'complete' }, { url: 'https://unrelated.test/' }); await flush(); assert.equal(h.posts.length, 0);
  updated(1, { status: 'complete' }, { url: 'https://ilias.unibe.ch/' }); await until(() => h.posts.length === 1);
  await until(() => h.storage.safariCompanion.status === 'connected');
  h.now += 300001; h.activeUrl = 'https://betterilias.ch/';
  await h.api.tabs.onActivated.listeners[0]({ tabId: 1 }); assert.equal(h.posts.length, 2);
});

test('Safari serialises concurrent wakeups and recovers an expired persisted lease', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 6 }, () => h.core.sync(true))); assert.equal(h.posts.length, 1);
  h.storage.safariCompanion.leaseUntil = h.now + 30000;
  h.core = h.worker(); assert.equal((await h.core.sync(true)).status, 'busy');
  h.now += 30001; assert.equal((await h.core.sync(true)).status, 'connected'); assert.equal(h.posts.length, 2);
});

test('Safari never saves a response invalidated by preferences or a login change', async () => {
  const h = harness(); let release;
  h.gate = new Promise(resolve => { release = resolve; });
  const pending = h.core.sync(false); await until(() => h.posts.length === 1);
  await h.core.preferences({ autoSyncEnabled: false }); release(); await pending;
  assert.equal(h.storage.safariCompanion.sessionId, undefined); assert.equal(h.storage.safariCompanion.status, 'disabled');
  h.gate = undefined; await h.core.preferences({ autoSyncEnabled: true }); h.now += 16000;
  h.gate = new Promise(resolve => { release = resolve; });
  const changing = h.core.sync(false); await until(() => h.posts.length === 2);
  h.cookie = 'cookie-B'; h.gate = undefined; release(); await changing;
  assert.equal(h.posts.length, 3); assert.equal(h.storage.safariCompanion.sessionId, 'verified-cookie-B');
  assert.ok(!h.notices.some(notice => notice.message.sessionId === 'verified-cookie-A'));
});

test('Safari distinguishes permission/login/offline failures and retains retry credentials', async () => {
  const h = harness(); await h.core.sync(true);
  h.fail = true; assert.equal((await h.core.sync(true)).status, 'error');
  assert.equal(h.storage.safariCompanion.sessionId, 'verified-cookie-A');
  assert.equal(h.storage.safariCompanion.lastSync, 0);
  h.fail = false; h.valid = false; assert.equal((await h.core.sync(true)).status, 'login');
  h.cookie = null; const count = h.posts.length; assert.equal((await h.core.sync(true)).status, 'login'); assert.equal(h.posts.length, count);
  h.denied = true; assert.equal((await h.core.sync(true)).status, 'permission');
  h.denied = false; h.api.permissions = { contains: async () => false };
  assert.equal((await h.core.sync(true)).status, 'permission');
});

test('Safari request deadlines include both response headers and response bodies', async () => {
  for (const stall of ['headers', 'body']) {
    const h = harness(); h.stall = stall;
    await assert.rejects(h.core.request('/api/auth/sync', { cookies: { PHPSESSID: h.cookie }, source: 'safari_extension' }, {}, 5), /error/);
  }
});

test('Safari opens the app with a one-use code and never puts a session ID in URLs', async () => {
  const h = harness(); assert.equal((await h.core.openApp()).status, 'connected');
  assert.equal(h.opened[0].url, 'https://betterilias.ch/#connect=one-use-code');
  assert.ok(!JSON.stringify(h.opened).includes('verified-cookie-A'));
});

test('Safari content scripts cannot change preferences, force sync or choose endpoints', async () => {
  const h = harness();
  const app = { id: 'safari-test', url: 'https://betterilias.ch/', tab: { id: 1 } };
  const ilias = { id: 'safari-test', url: 'https://ilias.unibe.ch/', tab: { id: 2 } };
  assert.equal(await h.message({ type: 'SAFARI_PREFERENCES', autoSyncEnabled: false }, app), undefined);
  assert.equal(await h.message({ type: 'SAFARI_SYNC' }, ilias), undefined);
  assert.equal(await h.message({ type: 'SAFARI_SYNC' }, { id: 'foreign' }), undefined);
  const first = await h.message({ type: 'SAFARI_PAGE_READY' }, ilias); assert.equal(first.sessionId, undefined);
  const second = await h.message({ type: 'SAFARI_PAGE_READY' }, app); assert.equal(second.sessionId, 'verified-cookie-A');
});

test('Safari discards credentials from a different packaged server', async () => {
  const h = harness(); h.storage.safariCompanion = { serverUrl: 'https://other.test', sessionId: 'other-tenant', leaseUntil: h.now + 90000 };
  await h.core.sync(true); assert.equal(h.posts[0].session_id, null);
});

test('Safari page bridge checks exact origin/top frame and publishes page-readable updates', async () => {
  for (const [site, frame, allowed] of [['https://betterilias.ch', false, true], ['https://betterilias.ch.evil.test', false, false], ['https://betterilias.ch', true, false]]) {
    const writes = [], messages = [], listeners = [], events = [];
    const page = { location: { origin: site }, localStorage: { setItem: (key, value) => writes.push({ key, value }) },
      postMessage: (value, target) => messages.push({ value, target }) };
    page.top = frame ? {} : page;
    const context = vm.createContext({ URL, window: page, document: { dispatchEvent: value => events.push(value) },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      browser: { runtime: { id: 'safari-test', getManifest: () => ({ version: '1.1.0' }),
        onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async () => ({ status: 'connected', sessionId: 'verified-page' }) } } });
    for (const file of ['config.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), context);
    await flush();
    assert.equal(listeners.length, allowed ? 1 : 0);
    if (!allowed) { assert.equal(writes.length, 0); continue; }
    assert.equal(writes[0].key, 'betterilias_session_id'); assert.equal(writes[0].value, 'verified-page');
    assert.ok(messages.every(message => message.target === 'https://betterilias.ch'));
    assert.equal(events[0].detail.sessionId, 'verified-page');
    listeners[0]({ type: 'BETTERILIAS_SESSION_SYNCED', sessionId: 'foreign' }, { id: 'other-extension' }, () => {});
    assert.equal(writes.length, 1);
    listeners[0]({ type: 'BETTERILIAS_SESSION_SYNCED', sessionId: 'new-session' }, { id: 'safari-test' }, () => {});
    assert.equal(writes.at(-1).value, 'new-session');
  }
});
