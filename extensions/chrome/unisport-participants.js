// Read only the fixed ZSSW list in this browser's normal cookie store. No cookie
// values, native tokens, passwords or HTML are sent to a BetterIlias server.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const ORIGIN = 'https://www.zssw.unibe.ch';
  const TYPES = ['UNISPORT_PARTICIPANTS_CONTEXT', 'UNISPORT_PARTICIPANTS_READ'];
  const MAX_BYTES = 2_000_000;
  async function context(message, sender) {
    const host = new URL(ORIGIN).hostname;
    // Include cookies scoped below / as well as parent-domain cookies: either
    // can change the authenticated identity of a participant-list request.
    const cookies = (await api.cookies.getAll({})).filter(cookie => {
      const domain = cookie.domain.replace(/^\./, '');
      return host === domain || host.endsWith('.' + domain);
    });
    // Bind the opaque cache identity to this instance and native connection.
    // Cosmetic cookie changes can invalidate caches too; no cookie is exported.
    const fields = cookies.map(c => [c.name, c.value, c.domain, c.path, c.storeId, c.partitionKey || null]);
    fields.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const bytes = new TextEncoder().encode(JSON.stringify([new URL(sender.url).origin, message.scope, message.affiliation, fields]));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!TYPES.includes(message?.type)) return false;
    (async () => {
      try {
        if (!await globalThis.BetterIliasUnisportPage(sender) || sender.tab.incognito
            || sender.tab.cookieStoreId && !['firefox-default', '0'].includes(sender.tab.cookieStoreId)
            || !/^[a-f0-9]{64}$/.test(message.scope || '')
            || typeof message.affiliation !== 'string' || !message.affiliation || message.affiliation.length > 512) {
          respond({ success: false, code: 'participants_unavailable' }); return;
        }
        const identity = await context(message, sender);
        if (message.type === 'UNISPORT_PARTICIPANTS_CONTEXT') {
          respond({ success: true, data: { context: identity } }); return;
        }
        if (!/^[1-9]\d{0,11}$/.test(message.course || '') || identity !== message.context) {
          respond({ success: false, code: 'participants_session_changed' }); return;
        }
        const url = ORIGIN + '/usp/zms/aii/anmeldeliste/' + message.course + '/index_ger.html';
        let response;
        try {
          response = await fetch(url, { credentials: 'include', redirect: 'manual', cache: 'no-store',
            referrerPolicy: 'no-referrer', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
        } catch (_) { respond({ success: false, code: 'participants_read_failed' }); return; }
        if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 || response.status === 401 || response.status === 403) {
          respond({ success: false, code: 'participants_login_required' }); return;
        }
        if (!response.ok || response.url !== url || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
          respond({ success: false, code: 'participants_read_failed' }); return;
        }
        const reader = response.body.getReader(), chunks = []; let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) throw new Error();
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        if (identity !== await context(message, sender)) {
          respond({ success: false, code: 'participants_session_changed' }); return;
        }
        respond({ success: true, data: { context: identity, html: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } });
      } catch (_) { respond({ success: false, code: 'participants_read_failed' }); }
    })();
    return true;
  });
  api.cookies.onChanged.addListener(change => {
    const domain = change.cookie?.domain?.replace(/^\./, '');
    if (!domain || !(domain === 'zssw.unibe.ch' || domain.endsWith('.zssw.unibe.ch'))
        || change.removed && change.cause === 'overwrite') return;
    void (async () => {
      for (const tab of await api.tabs.query({})) {
        try {
          if (await globalThis.BetterIliasUnisportPage({ tab, frameId: 0, url: tab.url }))
            await api.tabs.sendMessage(tab.id, { type: 'UNISPORT_PARTICIPANTS_COOKIES_CHANGED' });
        } catch (_) { /* Closed/unconfigured tabs receive no participant data. */ }
      }
    })().catch(() => {});
  });
})();
