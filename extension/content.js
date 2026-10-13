// Content script running on BetterIlias web app pages

(async function () {
  try {
    // 1. Sync session from extension storage to web app localStorage if available
    const data = await chrome.storage.local.get(['sessionId']);
    if (data.sessionId) {
      const current = window.localStorage.getItem('betterilias_session_id');
      if (!current) {
        window.localStorage.setItem('betterilias_session_id', data.sessionId);
        window.postMessage(
          { type: 'BETTERILIAS_SESSION_SYNCED', sessionId: data.sessionId },
          '*'
        );
      }
    }
  } catch (e) {
    // Ignore context errors
  }

  // 2. Listen for runtime messages from the extension popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'BETTERILIAS_SESSION_SYNCED' && message.sessionId) {
      try {
        window.localStorage.setItem('betterilias_session_id', message.sessionId);
        window.postMessage(
          { type: 'BETTERILIAS_SESSION_SYNCED', sessionId: message.sessionId },
          '*'
        );
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true;
  });

  // 3. Inform web app that the companion extension is installed
  window.postMessage({ type: 'BETTERILIAS_EXTENSION_INSTALLED', version: '1.0.0' }, '*');
})();

