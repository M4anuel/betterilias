// Safari has no cookies.onChanged. Use relevant tab activity and best-effort alarms.
if (typeof importScripts === 'function') importScripts('i18n.js', 'toolbar.js', 'request.js');
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const alarmName = 'betterilias_periodic_sync';

async function getStoredSettings() {
  const stored = await browserAPI.storage.local.get([
    'serverUrl', 'frontendUrl', 'autoSyncEnabled', 'sessionId', 'language',
    'lastSyncSignature', 'lastSyncTime', 'lastAttemptTime', 'syncLeaseUntil',
  ]);
  return { ...stored, serverUrl: (stored.serverUrl || 'http://localhost:8000').replace(/\/+$/, ''),
    frontendUrl: (stored.frontendUrl || 'http://localhost:5173').replace(/\/+$/, ''),
    autoSyncEnabled: stored.autoSyncEnabled !== false, language: stored.language || 'de' };
}

function isIliasAuthCookie(name) {
  return typeof name === 'string' && !/[|{}\[\]]/.test(name) &&
    (name === 'PHPSESSID' || name === 'ilClientId' || name.startsWith('_shibsession_') || name.startsWith('il_'));
}

async function fetchCookies() {
  const cookies = new Map();
  for (const query of [{ url: 'https://ilias.unibe.ch/' }, { domain: 'ilias.unibe.ch' }]) {
    try {
      for (const cookie of await browserAPI.cookies.getAll(query)) {
        if (isIliasAuthCookie(cookie.name) && cookie.value) cookies.set(cookie.name, cookie.value);
      }
    } catch { /* Missing site permission or an unsupported query: manual sync remains available. */ }
  }
  if (!cookies.has('ilClientId')) cookies.set('ilClientId', 'ilias3_unibe');
  return Object.fromEntries(cookies);
}

function sameOrigin(url, target) {
  try { return new URL(url).origin === new URL(target).origin; } catch { return false; }
}

async function notifyTabs(frontendUrl, sessionId) {
  for (const tab of await browserAPI.tabs.query({})) {
    if (tab.id == null || !sameOrigin(tab.url, frontendUrl)) continue;
    try {
      await browserAPI.tabs.sendMessage(tab.id, { type: 'BETTERILIAS_SESSION_SYNCED', sessionId });
    } catch { /* Manual sync can reconnect tabs with no content-script receiver. */ }
  }
}

async function syncWithLease(force) {
  const settings = await getStoredSettings();
  BetterIliasI18n.setLanguage(settings.language);
  if (!force && !settings.autoSyncEnabled) {
    await BetterIliasToolbar.setStatus('disabled');
    return { status: 'disabled' };
  }
  const now = Date.now();
  if (settings.syncLeaseUntil > now) {
    await browserAPI.storage.local.set({ syncPending: true });
    return { status: 'in_progress' };
  }
  if (!force && now - (settings.lastAttemptTime || 0) < 15000) return { status: 'cooldown' };
  // Persist cooldown/lease across service-worker suspension; a killed worker cannot lock forever.
  await browserAPI.storage.local.set({ lastAttemptTime: now, syncLeaseUntil: now + 30000 });
  try {
    await BetterIliasToolbar.setStatus('checking');
    const cookies = await fetchCookies();
    if (!cookies.PHPSESSID) {
      await browserAPI.storage.local.set({ lastSyncSignature: null, lastSyncTime: 0 });
      await BetterIliasToolbar.setStatus('unauthenticated');
      return { status: 'unauthenticated' };
    }
    const shib = Object.entries(cookies).find(([name]) => name.startsWith('_shibsession_'));
    const signature = `${cookies.PHPSESSID}:${shib?.[1] || ''}`;
    if (!force && settings.sessionId && settings.lastSyncSignature === signature &&
        now - (settings.lastSyncTime || 0) < 5 * 60 * 1000) {
      await BetterIliasToolbar.setStatus('synced');
      return { status: 'cached', sessionId: settings.sessionId };
    }
    const { response, data } = await BetterIliasRequest(`${settings.serverUrl}/api/auth/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': settings.language },
      body: JSON.stringify({ cookies, session_id: settings.sessionId || null, source: 'safari_extension',
        user_agent: globalThis.navigator?.userAgent || 'BetterIlias Safari Companion' }),
    }, 'Session verification timed out.');
    // Permission/settings/login changes during verification invalidate that response.
    const current = await getStoredSettings();
    if (!force && !current.autoSyncEnabled) {
      await BetterIliasToolbar.setStatus('disabled');
      return { status: 'disabled' };
    }
    if (current.serverUrl !== settings.serverUrl || current.frontendUrl !== settings.frontendUrl ||
        current.sessionId !== settings.sessionId) return { status: 'stale' };
    const liveCookies = await fetchCookies();
    const liveShib = Object.entries(liveCookies).find(([name]) => name.startsWith('_shibsession_'));
    if (`${liveCookies.PHPSESSID || ''}:${liveShib?.[1] || ''}` !== signature) {
      await browserAPI.storage.local.set({ lastAttemptTime: 0, syncPending: true });
      return { status: 'stale' };
    }
    if (response.ok && data.success && data.authenticated && data.session_id) {
      await browserAPI.storage.local.set({ sessionId: data.session_id, lastSyncSignature: signature,
        lastSyncTime: Date.now(), userName: data.user_name || null });
      await BetterIliasToolbar.setStatus('synced');
      await notifyTabs(settings.frontendUrl, data.session_id);
      return { status: 'synced', sessionId: data.session_id, authenticated: true };
    }
    await browserAPI.storage.local.set({ lastSyncSignature: null, lastSyncTime: 0 });
    const expired = response.status === 401 || response.status === 403 || (response.ok && data.authenticated === false);
    await BetterIliasToolbar.setStatus(expired ? 'unauthenticated' : 'error');
    return { status: expired ? 'unauthenticated' : 'failed' };
  } finally {
    await browserAPI.storage.local.set({ syncLeaseUntil: 0 });
  }
}

async function checkAndAutoSync(force = false) {
  try {
    // Web Locks prevent overlapping activity/alarm events without process-local session state.
    let result;
    if (globalThis.navigator?.locks) {
      result = await navigator.locks.request('betterilias-safari-sync', { ifAvailable: true }, async lock => {
        if (lock) return syncWithLease(force);
        await browserAPI.storage.local.set({ syncPending: true });
        return { status: 'in_progress' };
      });
    } else {
      result = await syncWithLease(force);
    }
    if (result.status !== 'in_progress') {
      const { syncPending } = await browserAPI.storage.local.get(['syncPending']);
      if (syncPending) {
        await browserAPI.storage.local.set({ syncPending: false });
        await checkAndAutoSync(false);
      }
    }
    return result;
  } catch {
    await BetterIliasToolbar.setStatus('error');
    try { await browserAPI.storage.local.set({ lastSyncSignature: null, lastSyncTime: 0 }); } catch { /* Storage unavailable. */ }
    // Keep the last verified credential on transport/permission errors, allowing manual retry.
    return { status: 'error' };
  }
}

async function checkTab(tab) {
  try {
    const settings = await getStoredSettings();
    if (sameOrigin(tab?.url, 'https://ilias.unibe.ch') || sameOrigin(tab?.url, settings.frontendUrl)) {
      await checkAndAutoSync(false);
    }
  } catch { /* No tab/site permission: the popup can still synchronise manually. */ }
}

browserAPI.tabs.onUpdated?.addListener((_id, change, tab) => {
  if (change.status === 'complete') void checkTab(tab);
});
browserAPI.tabs.onActivated?.addListener(async ({ tabId }) => {
  try { await checkTab(await browserAPI.tabs.get(tabId)); } catch { /* Tab closed. */ }
});

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !['CHECK_AND_AUTO_SYNC', 'GET_AUTO_SYNC_STATUS', 'SET_AUTO_SYNC_ENABLED'].includes(message.type)) return false;
  // Accept only our own extension/page bridge. No website payload supplies cookies or endpoints.
  if (sender?.id && sender.id !== browserAPI.runtime.id) return false;
  void (async () => {
    try {
      if (message.type === 'GET_AUTO_SYNC_STATUS') return sendResponse(await getStoredSettings());
      if (message.type === 'SET_AUTO_SYNC_ENABLED') {
        await browserAPI.storage.local.set({ autoSyncEnabled: Boolean(message.enabled) });
        if (!message.enabled) await BetterIliasToolbar.setStatus('disabled');
        else await checkAndAutoSync(false);
        return sendResponse({ success: true });
      }
      sendResponse(await checkAndAutoSync(Boolean(message.force)));
    } catch { sendResponse({ status: 'error' }); }
  })();
  return true;
});

async function ensureAlarm() {
  if (!browserAPI.alarms?.create || !browserAPI.alarms?.onAlarm) return;
  try {
    const alarm = browserAPI.alarms.get ? await browserAPI.alarms.get(alarmName) : null;
    if (!alarm) await browserAPI.alarms.create(alarmName, { periodInMinutes: 5 });
  } catch { /* Safari may suspend background execution. Tab/manual sync needs no alarm. */ }
}
browserAPI.alarms?.onAlarm?.addListener(alarm => {
  if (alarm.name === alarmName) void checkAndAutoSync(false);
});
browserAPI.runtime.onInstalled?.addListener(() => { void ensureAlarm(); void checkAndAutoSync(false); });
browserAPI.runtime.onStartup?.addListener(() => { void ensureAlarm(); void checkAndAutoSync(false); });
void ensureAlarm();
// Run initial check on load
void checkAndAutoSync(false);
