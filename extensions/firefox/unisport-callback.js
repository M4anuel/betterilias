// Read only native callback forms on the real provider origin, never login fields.
(() => {
  if (window !== window.top || location.origin !== 'https://login.eduid.ch') return;
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const CALLBACK = 'ch.unibe.campusapp://campusapp.unibe.ch';
  function isCallbackForm(form) {
    if (!(form instanceof HTMLFormElement) || form.action !== CALLBACK || (form.method || '').toLowerCase() !== 'post') return false;
    const inputs = [...form.querySelectorAll('input')];
    if (!inputs.length || inputs.length > 16 || inputs.some(input => input.type !== 'hidden' || !input.name)) return false;
    const keys = inputs.map(input => input.name);
    if (new Set(keys).size !== keys.length) return false;
    const params = new URLSearchParams(inputs.map(input => [input.name, input.value]));
    return Boolean(params.get('state')) && (Boolean(params.get('code')) || params.has('error'));
  }
  let sent = false, checking = false, queued = false;
  async function inspect() {
    if (sent) return;
    if (checking) { queued = true; return; }
    checking = true;
    try {
      do {
        queued = false;
        let found = false;
        for (const form of document.forms) {
          if (isCallbackForm(form)) { found = true; break; }
        }
        if (!found || sent) break;
        const context = await api.runtime.sendMessage({ type: 'UNISPORT_CONTEXT' });
        if (!context?.state || sent) break;
        for (const form of document.forms) {
          if (!isCallbackForm(form)) continue;
          const inputs = [...form.querySelectorAll('input')];
          const pairs = inputs.map(input => [input.name, input.value]);
          const params = new URLSearchParams(pairs);
          if (params.get('state') !== context.state || (!params.get('code') && !params.has('error'))) continue;
          sent = true;
          observer.disconnect();
          await api.runtime.sendMessage({ type: 'UNISPORT_CALLBACK', callback: form.action + '?' + params });
          break;
        }
      } while (queued && !sent);
    } finally {
      checking = false;
    }
  }
  window.addEventListener('submit', event => {
    if (isCallbackForm(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void inspect().catch(() => {});
    }
  }, true);
  document.addEventListener('BETTERILIAS_NATIVE_CALLBACK_FORM', () => { void inspect().catch(() => {}); });
  const observer = new MutationObserver(() => { void inspect().catch(() => {}); });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { void inspect().catch(() => {}); }, { once: true });
  void inspect().catch(() => {});
})();
