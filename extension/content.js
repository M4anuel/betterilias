// Content script running on BetterIlias web app pages and ILIAS pages (for Opencast Paella timestamp sync)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

(async function () {
  const isIliasHost = window.location.hostname === 'ilias.unibe.ch';

  // Extract Opencast Paella Player v8 `lastKnownTime` per episode `eid` from ILIAS localStorage / cookies
  function extractPaellaTimestampsFromIlias() {
    const found = {};

    function parsePaellaJson(raw) {
      if (!raw || typeof raw !== 'string' || !raw.includes('lastKnownTime')) return;
      for (const candidate of [raw, decodeURIComponent(raw)]) {
        try {
          const data = JSON.parse(candidate);
          if (data && typeof data === 'object' && data.videos && typeof data.videos === 'object') {
            for (const [eid, prefs] of Object.entries(data.videos)) {
              if (prefs && typeof prefs === 'object' && typeof prefs.lastKnownTime === 'number' && prefs.lastKnownTime > 0) {
                found[eid] = Math.round(prefs.lastKnownTime);
              }
            }
          }
        } catch (_) {}
      }
    }

    // 1. Check ILIAS localStorage (Paella localStorageDataPlugin stores e.g. under `default|{}`)
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        const val = window.localStorage.getItem(key);
        parsePaellaJson(val);
      }
    } catch (_) {}

    // 2. Check `preferences` cookie on ilias.unibe.ch
    try {
      const cookies = (document.cookie || '').split(';');
      for (const c of cookies) {
        const [k, ...vParts] = c.trim().split('=');
        if (k === 'preferences' && vParts.length > 0) {
          parsePaellaJson(vParts.join('='));
        }
      }
    } catch (_) {}

    return found;
  }

  if (isIliasHost) {
    async function syncIliasPaellaTimestampsToStorage() {
      try {
        const current = extractPaellaTimestampsFromIlias();
        if (Object.keys(current).length === 0) return;
        const stored = await browserAPI.storage.local.get(['podcastTimestamps']);
        const merged = { ...(stored?.podcastTimestamps || {}), ...current };
        await browserAPI.storage.local.set({ podcastTimestamps: merged });
      } catch (_) {}
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncIliasPaellaTimestampsToStorage);
    } else {
      syncIliasPaellaTimestampsToStorage();
    }
    window.addEventListener('visibilitychange', syncIliasPaellaTimestampsToStorage);
    window.addEventListener('pagehide', syncIliasPaellaTimestampsToStorage);

    if (window.location.search.includes('xoctPlayerGUI') || window.location.search.includes('streamVideo')) {
      setInterval(syncIliasPaellaTimestampsToStorage, 5000);
    }
    return;
  }

  // BetterIlias Web App host
  function applySessionToPage(sessionId) {
    if (!sessionId) return;

    // 1. Write to webpage localStorage
    try {
      if (typeof window.wrappedJSObject !== 'undefined' && window.wrappedJSObject.localStorage) {
        window.wrappedJSObject.localStorage.setItem('betterilias_session_id', sessionId);
      }
    } catch (_) {}

    try {
      window.localStorage.setItem('betterilias_session_id', sessionId);
    } catch (_) {}

    // 2. Dispatch custom DOM event on document
    try {
      document.dispatchEvent(
        new CustomEvent('BETTERILIAS_SESSION_SYNCED', {
          detail: { sessionId }
        })
      );
    } catch (_) {}

    // 3. Post Message
    try {
      window.postMessage(
        { type: 'BETTERILIAS_SESSION_SYNCED', sessionId },
        '*'
      );
    } catch (_) {}
  }

  function applyPodcastTimestampsToPage(timestamps) {
    if (!timestamps || typeof timestamps !== 'object' || Object.keys(timestamps).length === 0) return;
    try {
      const existingRaw = window.localStorage.getItem('betterilias_podcast_timestamps');
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const merged = { ...existing, ...timestamps };
      window.localStorage.setItem('betterilias_podcast_timestamps', JSON.stringify(merged));
      document.dispatchEvent(
        new CustomEvent('BETTERILIAS_PODCAST_TIMESTAMPS_SYNCED', {
          detail: { timestamps: merged }
        })
      );
    } catch (_) {}
  }

  try {
    // 1. Sync session and podcast timestamps from extension storage to web app localStorage
    const data = await browserAPI.storage.local.get(['sessionId', 'podcastTimestamps']);
    if (data && data.sessionId) {
      applySessionToPage(data.sessionId);
    }
    if (data && data.podcastTimestamps) {
      applyPodcastTimestampsToPage(data.podcastTimestamps);
    }
  } catch (e) {
    // Ignore context errors
  }

  // Listen for live storage updates (e.g. when user pauses video on ilias.unibe.ch in another tab)
  try {
    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.sessionId?.newValue) {
          applySessionToPage(changes.sessionId.newValue);
        }
        if (changes.podcastTimestamps?.newValue) {
          applyPodcastTimestampsToPage(changes.podcastTimestamps.newValue);
        }
      }
    });
  } catch (_) {}

  // 2. Listen for runtime messages from the extension popup
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'BETTERILIAS_SESSION_SYNCED' && message.sessionId) {
      try {
        applySessionToPage(message.sessionId);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true;
  });

  // 3. Inform web app that the companion extension is installed
  try {
    window.postMessage({ type: 'BETTERILIAS_EXTENSION_INSTALLED', version: '1.0.0' }, '*');
  } catch (_) {}
})();
