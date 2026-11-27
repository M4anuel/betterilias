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
    'https://betterilias.ch',
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:8000', 'http://127.0.0.1:8000',
  ]);
  for (const value of [settings.serverUrl, settings.frontendUrl]) {
    if (!value) continue;
    try { allowedOrigins.add(new URL(value).origin); } catch (_) {}
  }
  if (!allowedOrigins.has(window.location.origin)) return;
  const configured = () => [settings.serverUrl || 'http://localhost:8000', settings.frontendUrl || 'http://localhost:5173']
    .some(value => { try { return new URL(value).origin === window.location.origin; } catch (_) { return false; } });
  browserAPI.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of ['serverUrl','frontendUrl']) if (changes[key]) settings[key] = changes[key].newValue;
  });
  const markInstalled=()=>{if(configured() && document.documentElement?.dataset)document.documentElement.dataset.betteriliasCompanion='1';};
  markInstalled();document.addEventListener('DOMContentLoaded',markInstalled,{once:true});
  let authGeneration=0;

  const supportedLanguage = value => typeof value === 'string' && ['de', 'en'].includes(value) ? value : null;
  const appLanguage = () => {
    try { return supportedLanguage((window.wrappedJSObject?.localStorage || localStorage).getItem('betterilias_language')); } catch (_) { return null; }
  };
  const publishLanguage = async type => {
    try {
      const reply = await browserAPI.runtime.sendMessage({ type, language: appLanguage() });
      if (reply?.language) applyLanguage(reply.language);
    } catch (_) {}
  };
  function applyLanguage(language) {
    if (!supportedLanguage(language) || appLanguage() === language && document.documentElement.lang === language) return;
    const storage = window.wrappedJSObject?.localStorage || localStorage;
    storage.setItem('betterilias_language', language);
    // A real StorageEvent reaches the existing React i18n subscriber in both
    // isolated worlds without exposing extension-owned objects to Firefox.
    document.dispatchEvent(new CustomEvent('BETTERILIAS_LANGUAGE_APPLY'));
  }
  document.addEventListener('BETTERILIAS_LANGUAGE_CHANGED', () => { void publishLanguage('COMPANION_LANGUAGE_SET'); });
  window.addEventListener('storage', event => {
    if (event.key === 'betterilias_language') void publishLanguage('COMPANION_LANGUAGE_SET');
  });
  browserAPI.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'COMPANION_LANGUAGE_GET') { respond({ language: appLanguage() }); return false; }
    if (message?.type === 'COMPANION_LANGUAGE_APPLY') { applyLanguage(message.language); respond({ success: true }); }
    return false;
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void publishLanguage('COMPANION_LANGUAGE_ATTACH'); }, { once: true });
  else void publishLanguage('COMPANION_LANGUAGE_ATTACH');

  // Only this configured BetterIlias page can request a UniSport login. Provider
  // tokens and authorization codes never travel through the page message bridge.
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!['UNISPORT_START', 'UNISPORT_PING', 'UNISPORT_CANCEL', 'UNISPORT_PARTICIPANTS_CONTEXT', 'UNISPORT_PARTICIPANTS_READ', 'UNISPORT_PARTICIPANTS_LOGIN', 'UNIBE_OPEN_FROM_PAGE','UNIBE_LOGOUT'].includes(message?.type) || typeof message.requestId !== 'string' || message.requestId.length > 80) return;
    void (async () => {
      let result;
      try { result = await browserAPI.runtime.sendMessage(message); } catch (_) {}
      const participant = message.type.startsWith('UNISPORT_PARTICIPANTS_');
      window.postMessage({ type: 'UNISPORT_REPLY', requestId: message.requestId, success: result?.success === true,
        ...(participant || message.type==='UNIBE_LOGOUT' ? { data: result?.data, code: result?.code } : {}) }, location.origin);
    })();
  });
  browserAPI.runtime.onMessage.addListener(message => {
    if (message?.type === 'UNISPORT_FINISHED') {
      window.postMessage({ type: 'UNISPORT_FINISHED', success: message.success === true }, location.origin);
    }
    if (message?.type === 'UNISPORT_PARTICIPANTS_LOGIN_FINISHED')
      window.postMessage({ type: message.type, scope: message.scope, affiliation: message.affiliation, success: message.success === true }, location.origin);
    if (message?.type === 'UNISPORT_PARTICIPANTS_COOKIES_CHANGED')
      window.postMessage({ type: message.type }, location.origin);
    return false;
  });

  function applySessionToPage(sessionId, manual = false) {
    if (!sessionId || !configured()) return;

    // A server-created UniBE-token connection is an explicit per-instance
    // choice. Startup/automatic cookie sync must not silently select another
    // account. Only a manual Companion sync switches back to browser cookies.
    try {
      const pageStorage = window.wrappedJSObject?.localStorage || window.localStorage;
      if(manual)pageStorage.removeItem('betterilias_logout_paused');
      else if(pageStorage.getItem('betterilias_logout_paused')==='1')return;
      if (manual) pageStorage.removeItem('betterilias_ilias_source');
      else if (pageStorage.getItem('betterilias_ilias_source') === 'unisport') return;
    } catch (_) { return; }

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
    if (!configured()) return false;
    if(message?.type==='BETTERILIAS_LOGGED_OUT') {
      ++authGeneration;
      const storage=window.wrappedJSObject?.localStorage || localStorage;
      const current=storage.getItem('betterilias_session_id');
      if(message.sessionId && current && message.sessionId!==current)return false;
      storage.setItem('betterilias_logout_paused','1');
      for(const key of ['betterilias_unisport_session','betterilias_ilias_source','betterilias_unibe_selected_session'])storage.removeItem(key);
      document.dispatchEvent(new CustomEvent('BETTERILIAS_LOGGED_OUT'));
      sendResponse({success:true});return false;
    }
    const pageStorage = window.wrappedJSObject?.localStorage || window.localStorage;
    if (message?.type === 'UNIBE_CONTEXT') {
      sendResponse({ credential: pageStorage.getItem('betterilias_unisport_session'),
        sessionId: pageStorage.getItem('betterilias_unibe_selected_session') || (pageStorage.getItem('betterilias_ilias_source') === 'unisport'
          ? pageStorage.getItem('betterilias_cache_owner') : pageStorage.getItem('betterilias_session_id')) });
      return false;
    }
    if (message?.type === 'UNIBE_SELECTED') {
      applyUnibe(message);
      sendResponse({ success: true });
      return false;
    }
    if (message && message.type === 'BETTERILIAS_SESSION_SYNCED' && message.sessionId) {
      try {
        applySessionToPage(message.sessionId, message.manual === true);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return false;
  });

  function applyUnibe(message) {
    if (!configured()) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(message?.credential || '') || !/^[A-Za-z0-9_-]{43}$/.test(message?.sessionId || '')) return;
    const pageStorage = window.wrappedJSObject?.localStorage || window.localStorage;
    pageStorage.removeItem('betterilias_logout_paused');
    pageStorage.setItem('betterilias_unisport_session', message.credential);
    pageStorage.setItem('betterilias_ilias_source', 'unisport');
    const detail = { sessionId: message.sessionId, source: 'unisport' };
    // Existing apps select synchronously. On document_start there may be no
    // listener yet, so persist the verified selection before React initializes.
    // Leave an old owner in place so cache initialization clears different-account data.
    pageStorage.setItem('betterilias_session_id', message.sessionId);
    pageStorage.setItem('betterilias_unibe_selected_session', message.sessionId);
    document.dispatchEvent(new CustomEvent('BETTERILIAS_SESSION_SYNCED', {
      detail: typeof cloneInto === 'function' ? cloneInto(detail, window) : detail,
    }));
    window.postMessage({ type: 'UNIBE_CONNECTION_SELECTED' }, location.origin);
  }

  browserAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.sessionId?.newValue) {
      applySessionToPage(changes.sessionId.newValue);
    }
  });

  try {
    // 1. Sync session from extension storage to web app localStorage if available
    const data = await browserAPI.storage.local.get(['sessionId', 'authMethod']);
    if (data.authMethod === 'legacy' && data.sessionId) {
      applySessionToPage(data.sessionId);
    } else {
      const generation=authGeneration;
      const unibe = await browserAPI.runtime.sendMessage({ type: 'UNIBE_PAGE_CONNECTION' });
      if (generation===authGeneration && unibe?.success && unibe.data?.sessionId) applyUnibe(unibe.data);
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
    window.postMessage({ type: 'BETTERILIAS_EXTENSION_INSTALLED', version: browserAPI.runtime.getManifest?.()?.version || 'unknown' }, '*');
  } catch (_) {}
})();
