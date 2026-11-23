// Read only native callback forms on the real provider origin, never login fields.
(() => {
  if (window !== window.top || location.origin !== 'https://login.eduid.ch') return;
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let sent = false;
  async function inspect() {
    if (sent) return;
    const context = await api.runtime.sendMessage({ type: 'UNISPORT_CONTEXT' });
    if (!context?.state || sent) return;
    for (const form of document.forms) {
      if (form.action !== 'ch.unibe.campusapp://campusapp.unibe.ch' || form.method.toLowerCase() !== 'post') continue;
      const inputs = [...form.querySelectorAll('input')];
      if (!inputs.length || inputs.length > 16 || inputs.some(input => input.type !== 'hidden' || !input.name)) continue;
      const pairs = inputs.map(input => [input.name, input.value]);
      if (new Set(pairs.map(([key]) => key)).size !== pairs.length) continue;
      const params = new URLSearchParams(pairs);
      if (params.get('state') !== context.state || (!params.get('code') && !params.has('error'))) continue;
      sent = true;
      observer.disconnect();
      await api.runtime.sendMessage({ type: 'UNISPORT_CALLBACK', callback: form.action + '?' + params });
      break;
    }
  }
  const observer = new MutationObserver(() => { void inspect().catch(() => {}); });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { void inspect().catch(() => {}); }, { once: true });
  void inspect().catch(() => {});
})();
