// background.js - BetterIlias Companion Background Service Worker / Script
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

let syncDebounceTimeout = null;
let isSyncing = false;

async function getStoredSettings() {
  try {
    const stored = await browserAPI.storage.local.get([
      'serverUrl',
      'frontendUrl',
      'autoSyncEnabled',
      'sessionId',
      'lastSyncSignature',
      'lastSyncTime',
      'language'
    ]);
    return {
      serverUrl: (stored.serverUrl || 'http://localhost:8000').replace(/\/+$/, ''),
      frontendUrl: (stored.frontendUrl || 'http://localhost:5173').replace(/\/+$/, ''),
      autoSyncEnabled: stored.autoSyncEnabled !== false,
      sessionId: stored.sessionId || null,
      lastSyncSignature: stored.lastSyncSignature || null,
      lastSyncTime: stored.lastSyncTime || 0,
      language: stored.language || 'de',
    };
  } catch (error) {
    console.warn('[BetterIlias Background] Could not read settings:', error);
    return {
      serverUrl: 'http://localhost:8000',
      frontendUrl: 'http://localhost:5173',
      autoSyncEnabled: true,
      sessionId: null,
      lastSyncSignature: null,
      lastSyncTime: 0,
      language: 'de',
    };
  }
}

async function fetchCookies() {
  const cookies = new Map();
  for (const query of [
    { url: 'https://ilias.unibe.ch/' },
    { domain: 'ilias.unibe.ch' },
    { domain: 'ilias.unibe.ch', firstPartyDomain: null }
  ]) {
    try {
      const list = await browserAPI.cookies.getAll(query);
      for (const cookie of list) {
        if (cookie.name && cookie.value) cookies.set(cookie.name, cookie.value);
      }
    } catch (_) { /* Query support differs between browsers. */ }
  }
  if (!cookies.has('ilClientId')) cookies.set('ilClientId', 'ilias3_unibe');
  return Object.fromEntries(cookies);
}

async function notifyTabs(frontendUrl, sessionId) {
  if (!sessionId) return;
  try {
    const tabs = await browserAPI.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.id) {
        const u = tab.url;
        if (
          u.startsWith(frontendUrl) ||
          u.includes('localhost:5173') ||
          u.includes('127.0.0.1:5173') ||
          u.includes('localhost:8000') ||
          u.includes('127.0.0.1:8000')
        ) {
          try {
            await browserAPI.tabs.sendMessage(tab.id, {
              type: 'BETTERILIAS_SESSION_SYNCED',
              sessionId,
            });
          } catch (_) {
            // Tab might not be ready or has closed
          }
        }
      }
    }
  } catch (e) {
    console.warn('[BetterIlias Background] Failed to notify tabs:', e);
  }
}

function updateBadge(status) {
  try {
    const action = browserAPI.action || browserAPI.browserAction;
    if (!action) return;
    if (status === 'synced') {
      action.setBadgeText({ text: '✓' });
      action.setBadgeBackgroundColor({ color: '#0AACA5' });
    } else if (status === 'unauthenticated') {
      action.setBadgeText({ text: '' });
    }
  } catch (_) {}
}

async function checkAndAutoSync(force = false) {
  if (isSyncing) return { status: 'in_progress' };
  isSyncing = true;
  try {
    const settings = await getStoredSettings();
    if (!settings.autoSyncEnabled && !force) {
      return { status: 'disabled' };
    }

    const cookies = await fetchCookies();
    const hasPhp = Boolean(cookies.PHPSESSID);
    const shibEntry = Object.entries(cookies).find(([k]) => k.startsWith('_shibsession_'));
    const isVerified = hasPhp && Boolean(shibEntry);

    if (!isVerified) {
      updateBadge('unauthenticated');
      return { status: 'unauthenticated', hasPhp, verified: false };
    }

    const currentSignature = `${cookies.PHPSESSID}:${shibEntry ? shibEntry[1] : ''}`;
    const fiveMinutes = 5 * 60 * 1000;
    const isRecent =
      settings.lastSyncSignature === currentSignature &&
      Date.now() - settings.lastSyncTime < fiveMinutes;

    if (!force && isRecent && settings.sessionId) {
      updateBadge('synced');
      return { status: 'cached', sessionId: settings.sessionId };
    }

    // Call BetterIlias backend auth sync
    const source = typeof browser !== 'undefined' ? 'firefox_extension' : 'chrome_extension';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'BetterIlias Extension';

    const response = await fetch(`${settings.serverUrl}/api/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': settings.language,
      },
      body: JSON.stringify({
        cookies,
        session_id: settings.sessionId || null,
        source,
        user_agent: userAgent,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success && data.authenticated && data.session_id) {
      await browserAPI.storage.local.set({
        sessionId: data.session_id,
        lastSyncSignature: currentSignature,
        lastSyncTime: Date.now(),
        userName: data.user_name || null,
      });

      updateBadge('synced');
      await notifyTabs(settings.frontendUrl, data.session_id);

      return {
        status: 'synced',
        sessionId: data.session_id,
        userName: data.user_name,
        authenticated: true,
      };
    }

    return { status: 'failed', detail: data.detail || data.message };
  } catch (err) {
    console.warn('[BetterIlias Background] Auto-sync encountered error:', err);
    return { status: 'error', error: err.message };
  } finally {
    isSyncing = false;
  }
}

function scheduleSyncDebounced(delay = 1500) {
  if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
  syncDebounceTimeout = setTimeout(() => {
    checkAndAutoSync(false);
  }, delay);
}

// 1. Listen for ILIAS cookie changes
if (browserAPI.cookies && browserAPI.cookies.onChanged) {
  browserAPI.cookies.onChanged.addListener((changeInfo) => {
    const domain = changeInfo?.cookie?.domain || '';
    const name = changeInfo?.cookie?.name || '';
    if (
      domain.includes('unibe.ch') ||
      name === 'PHPSESSID' ||
      name.startsWith('_shibsession_')
    ) {
      scheduleSyncDebounced(1500);
    }
  });
}

// 2. Listen for runtime messages
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'CHECK_AND_AUTO_SYNC') {
    checkAndAutoSync(Boolean(message.force)).then((result) => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_AUTO_SYNC_STATUS') {
    getStoredSettings().then((settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === 'SET_AUTO_SYNC_ENABLED') {
    browserAPI.storage.local.set({ autoSyncEnabled: Boolean(message.enabled) }).then(() => {
      if (message.enabled) {
        checkAndAutoSync(true);
      }
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});

// 3. Periodic alarm (every 5 minutes)
if (browserAPI.alarms) {
  try {
    browserAPI.alarms.create('betterilias_periodic_sync', { periodInMinutes: 5 });
    browserAPI.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'betterilias_periodic_sync') {
        checkAndAutoSync(false);
      }
    });
  } catch (e) {
    console.warn('[BetterIlias Background] Alarm setup failed:', e);
  }
}

// 4. Initial check when background starts / extension installs
if (browserAPI.runtime?.onInstalled) {
  browserAPI.runtime.onInstalled.addListener(() => {
    checkAndAutoSync(true);
  });
}

if (browserAPI.runtime?.onStartup) {
  browserAPI.runtime.onStartup.addListener(() => {
    checkAndAutoSync(true);
  });
}

// Run initial check on load
checkAndAutoSync(false);
