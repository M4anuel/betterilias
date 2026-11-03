// Content script running on BetterIlias web app pages
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

(async function () {
  // Firefox match patterns cannot restrict ports. Check the actual origin before
  // exposing any BetterIlias credential to a page on a local development server.
  let settings;
  try {
    settings = await browserAPI.storage.local.get(['serverUrl', 'frontendUrl']);
  } catch (_) { return; }
  const allowedOrigins = new Set([
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:8000', 'http://127.0.0.1:8000',
  ]);
  for (const value of [settings.serverUrl, settings.frontendUrl]) {
    if (!value) continue;
    try { allowedOrigins.add(new URL(value).origin); } catch (_) {}
  }
  if (!allowedOrigins.has(window.location.origin)) return;

  function applySessionToPage(sessionId) {
    if (!sessionId) return;

    // 1. Write to webpage localStorage (supporting Firefox wrappedJSObject and Chromium)
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
          // Firefox page scripts cannot read objects owned by the Xray sandbox.
          detail: typeof cloneInto === 'function' ? cloneInto({ sessionId }, window) : { sessionId }
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

  // Register live updates before awaiting startup checks or background requests.
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'BETTERILIAS_SESSION_SYNCED' && message.sessionId) {
      try {
        applySessionToPage(message.sessionId);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return false;
  });

  browserAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.sessionId?.newValue) {
      applySessionToPage(changes.sessionId.newValue);
    }
  });

  try {
    // 1. Sync session from extension storage to web app localStorage if available
    const data = await browserAPI.storage.local.get(['sessionId']);
    if (data && data.sessionId) {
      applySessionToPage(data.sessionId);
    }
  } catch (e) {
    // Ignore context errors
  }

  // 2. Ask background service worker to check and auto-sync immediately if logged in
  try {
    const response = await browserAPI.runtime.sendMessage({ type: 'CHECK_AND_AUTO_SYNC' });
    if (response && response.sessionId) {
      applySessionToPage(response.sessionId);
    }
  } catch (_) {}

  // 4. Inform web app that the companion extension is installed
  try {
    window.postMessage({ type: 'BETTERILIAS_EXTENSION_INSTALLED', version: '1.0.0', browser: 'firefox' }, '*');
  } catch (_) {}
})();
