// Content script running on BetterIlias web app pages
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

(async function () {
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

  try {
    // 1. Sync session from extension storage to web app localStorage if available
    const data = await browserAPI.storage.local.get(['sessionId']);
    if (data && data.sessionId) {
      applySessionToPage(data.sessionId);
    }
  } catch (e) {
    // Ignore context errors
  }

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
