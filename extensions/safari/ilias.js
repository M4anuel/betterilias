// ILIAS pages can wake verification, not choose a backend or receive credentials.
if (window.top === window && window.location.origin === 'https://ilias.unibe.ch') {
  void (async () => { try { await browser.runtime.sendMessage({ type: 'SAFARI_PAGE_READY' }); } catch { /* best effort */ } })();
}
