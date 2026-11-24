// Independent UniSport native-callback bridge. No SWITCH cookies or login inputs.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const CALLBACK = 'ch.unibe.campusapp://campusapp.unibe.ch';
  const ISSUER = 'https://login.eduid.ch';
  const PREFIX = 'unisport.pending.';

  async function trustedPage(sender) {
    if (!sender.tab?.id || sender.frameId !== 0) return null;
    const stored = await api.storage.local.get(['serverUrl', 'frontendUrl']);
    try {
      const backend = new URL(stored.serverUrl || 'http://localhost:8000');
      const frontend = new URL(stored.frontendUrl || 'http://localhost:5173');
      const page = new URL(sender.url);
      const safe = url => url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
      if (!safe(backend) || !safe(frontend) || ![backend.origin, frontend.origin].includes(page.origin)) return null;
      if (backend.username || backend.password || backend.search || backend.hash) return null;
      return backend.href.replace(/\/+$/, '');
    } catch (_) { return null; }
  }
  globalThis.BetterIliasUnisportPage = trustedPage;

  function parameters(callback, state) {
    try {
      if (typeof callback !== 'string' || callback.length > 10000 || callback.split('?')[0] !== CALLBACK) return null;
      const url = new URL(callback);
      const pairs = [...url.searchParams];
      if (url.hash || pairs.length > 16 || new Set(pairs.map(([key]) => key)).size !== pairs.length) return null;
      if (url.searchParams.get('state') !== state || !state) return null;
      if (url.searchParams.has('iss') && url.searchParams.get('iss') !== ISSUER + '/') return null;
      if (['access_token', 'id_token'].some(key => url.searchParams.has(key))) return null;
      if (!url.searchParams.get('code') && !url.searchParams.has('error')) return null;
      return callback;
    } catch (_) { return null; }
  }

  async function pendingFor(tabId) {
    const stored = await api.storage.session.get(null);
    return Object.entries(stored).filter(([key, value]) => key.startsWith(PREFIX) && value.tab === tabId && value.expires > Date.now());
  }

  async function finish(tabId, callback) {
    for (const [key, pending] of await pendingFor(tabId)) {
      if (!parameters(callback, pending.state)) continue;
      // Backend atomically consumes state before exchanging; duplicate events
      // cannot cause a second provider exchange, even across worker restarts.
      await api.storage.session.remove(key);
      let success = false;
      try {
        const response = await fetch(pending.backend + '/api/unisport/auth/complete', {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-Unisport-Session': pending.credential },
          body: JSON.stringify({ callback }), signal: AbortSignal.timeout(60000),
        });
        success = response.ok;
      } catch (_) { /* An uncertain exchange is never retried. */ }
      try { await api.tabs.sendMessage(pending.owner, { type: 'UNISPORT_FINISHED', success }); } catch (_) {}
      // Preserve the login tab on failure to aid the user; no callback data is
      // copied to the BetterIlias URL or browser local storage.
      if (success) {
        try { await api.tabs.remove(tabId); await api.tabs.update(pending.owner, { active: true }); } catch (_) {}
      }
    }
  }

  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['UNISPORT_START', 'UNISPORT_CONTEXT', 'UNISPORT_CALLBACK', 'UNISPORT_PING', 'UNISPORT_CANCEL'].includes(message?.type)) return false;
    (async () => {
      try {
        if (['UNISPORT_START', 'UNISPORT_PING', 'UNISPORT_CANCEL'].includes(message.type)) {
          const backend = await trustedPage(sender);
          if (!backend) throw new Error();
          if (message.type === 'UNISPORT_PING') { respond({ success: true }); return; }
          if (message.type === 'UNISPORT_CANCEL') {
            const stored = await api.storage.session.get(null);
            for (const [key, value] of Object.entries(stored)) {
              if ((key.startsWith(PREFIX) || key.startsWith('unisport.website.')) && value.owner === sender.tab.id) {
                await api.storage.session.remove(key);
                try { await api.tabs.remove(value.tab); } catch (_) {}
              }
            }
            respond({ success: true }); return;
          }
          const url = new URL(message.authorization_url);
          const params = url.searchParams;
          if (url.origin !== ISSUER || url.pathname !== '/idp/profile/oidc/authorize' || url.hash || url.username || url.password
              || params.get('client_id') !== 'unibe-campusapp' || params.get('redirect_uri') !== CALLBACK
              || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256'
              || params.get('response_mode') !== 'form_post'
              || params.get('state') !== message.state || !/^[A-Za-z0-9_-]{43}$/.test(message.state)
              || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') || '')
              || !/^[A-Za-z0-9_-]{43}$/.test(message.credential)
              || [...params.keys()].length !== new Set(params.keys()).size) throw new Error();
          const stored = await api.storage.session.get(null);
          for (const [key, value] of Object.entries(stored)) {
            if (key.startsWith(PREFIX) && (value.expires <= Date.now() || value.owner === sender.tab.id)) {
              await api.storage.session.remove(key);
              try { await api.tabs.remove(value.tab); } catch (_) {}
            }
          }
          const tab = await api.tabs.create({ url: 'about:blank', active: true });
          const key = PREFIX + message.state;
          await api.storage.session.set({ [key]: { tab: tab.id, owner: sender.tab.id, backend,
            credential: message.credential, state: message.state, expires: Date.now() + 600000 } });
          await api.tabs.update(tab.id, { url: url.href });
          respond({ success: true });
          return;
        }
        if (sender.frameId !== 0 || new URL(sender.url).origin !== ISSUER) throw new Error();
        if (message.type === 'UNISPORT_CONTEXT') {
          const pending = await pendingFor(sender.tab.id);
          respond({ state: pending[0]?.[1].state || null });
          return;
        }
        await finish(sender.tab.id, message.callback);
        respond({ success: true });
      } catch (_) { respond({ success: false }); }
    })();
    return true;
  });

  api.webRequest.onBeforeRedirect.addListener(details => {
    if (details.type !== 'main_frame' || new URL(details.url).origin !== ISSUER || ![301, 302, 303, 307, 308].includes(details.statusCode)) return;
    void finish(details.tabId, details.redirectUrl).catch(() => {});
  }, { urls: [ISSUER + '/*'], types: ['main_frame'] });

  api.tabs.onRemoved.addListener(tabId => {
    void (async () => {
      const stored = await api.storage.session.get(null);
      for (const [key, value] of Object.entries(stored)) {
        if (key.startsWith(PREFIX) && (value.tab === tabId || value.owner === tabId)) {
          await api.storage.session.remove(key);
          if (value.owner === tabId && value.tab !== tabId) {
            try { await api.tabs.remove(value.tab); } catch (_) {}
          } else {
            try { await api.tabs.sendMessage(value.owner, { type: 'UNISPORT_FINISHED', success: false }); } catch (_) {}
          }
        }
      }
    })().catch(() => {});
  });
})();
