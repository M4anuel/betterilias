// Deliver credentials only to this package's exact app origin, never subframes.
(() => {
  if (window.top !== window || window.location.origin !== new URL(SafariCompanionConfig.frontendUrl).origin) return;
  function apply(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return;
    try { window.localStorage.setItem('betterilias_session_id', sessionId); } catch { return; }
    window.postMessage({ type: 'BETTERILIAS_SESSION_SYNCED', sessionId }, window.location.origin);
    document.dispatchEvent(new CustomEvent('BETTERILIAS_SESSION_SYNCED', { detail: { sessionId } }));
  }
  browser.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender?.id !== browser.runtime.id || message?.type !== 'BETTERILIAS_SESSION_SYNCED') return false;
    apply(message.sessionId); reply({ success: true }); return false;
  });
  window.postMessage({ type: 'BETTERILIAS_EXTENSION_INSTALLED', version: browser.runtime.getManifest().version }, window.location.origin);
  void (async () => {
    try { const result = await browser.runtime.sendMessage({ type: 'SAFARI_PAGE_READY' }); if (result?.status === 'connected') apply(result.sessionId); }
    catch { /* Popup manual sync remains available after suspension. */ }
  })();
})();
