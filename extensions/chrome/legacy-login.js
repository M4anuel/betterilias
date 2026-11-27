// Deprecated cookie mode shares the primary popup; no extension tab is opened.
globalThis.BetterIliasLegacy = (() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  async function check(server, frontend, language, manual = false) {
    server = server.replace(/\/+$/, '');
    const cookies = {};
    for (const query of [{ url: 'https://ilias.unibe.ch/' }, { domain: 'ilias.unibe.ch' }, { domain: 'ilias.unibe.ch', firstPartyDomain: null }]) {
      try { for (const cookie of await api.cookies.getAll(query)) {
        if (cookie.value && (['PHPSESSID','ilClientId'].includes(cookie.name) || cookie.name.startsWith('_shibsession_') || cookie.name.startsWith('il_'))
            && !/[|{}\[\]]/.test(cookie.name)) cookies[cookie.name] = cookie.value;
      } } catch (_) {}
    }
    if (!cookies.PHPSESSID) return { phase: 'disconnected', cookiePresent: false };
    cookies.ilClientId ||= 'ilias3_unibe';
    const stored = await api.storage.local.get(['sessionId']);
    const { response, data } = await BetterIliasRequest(server + '/api/auth/sync', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify({ cookies, session_id: stored.sessionId || null,
        source: typeof browser !== 'undefined' ? 'firefox_extension' : 'chrome_extension', user_agent: navigator.userAgent }),
    }, 'connection');
    if ([401,403].includes(response.status) || response.ok && !data.authenticated) return { phase: 'disconnected', cookiePresent: false };
    if (!response.ok || !data.success || !data.session_id) throw new Error('connection');
    await api.storage.local.set({ sessionId: data.session_id, userName: data.user_name || null, lastSyncTime: Date.now() });
    for (const tab of await api.tabs.query({})) {
      try {
        if (new URL(tab.url).origin !== new URL(frontend).origin) continue;
        const reply = await api.tabs.sendMessage(tab.id, { type: 'BETTERILIAS_SESSION_SYNCED', sessionId: data.session_id, manual });
        if (reply?.success || !manual) continue;
      } catch (_) { if (!manual) continue; }
      // Recheck the origin before recovering a tab without its content script.
      try {
        const target = new URL(tab.url); if (target.origin !== new URL(frontend).origin) continue;
        const issued = await BetterIliasRequest(server + '/api/auth/mobile-session', { method: 'POST', headers: { 'X-Session-Id': data.session_id } }, 'connection');
        if (!issued.response.ok || !issued.data.handoff_token) continue;
        target.hash = new URLSearchParams({ connect: issued.data.handoff_token });
        await api.tabs.update(tab.id, { url: target.href });await api.tabs.reload(tab.id);
      } catch (_) {}
    }
    return { phase: 'connected', user_name: data.user_name, cookiePresent: true };
  }
  return { check };
})();
