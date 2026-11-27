// Shared UniBE login controller. Provider tokens never enter extension storage.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  let operations = Promise.resolve(); // Serialization only; all connection state is persisted.

  async function instance() {
    const settings = await api.storage.local.get(['serverUrl', 'frontendUrl', 'language', 'authMethod']);
    const backend = new URL(settings.serverUrl || 'http://localhost:8000');
    const frontend = new URL(settings.frontendUrl || 'http://localhost:5173');
    for (const url of [backend, frontend]) {
      if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
          || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('configuration');
    }
    const scope = backend.origin + '\n' + frontend.origin;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
    const key = 'unibe.connection.' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    return { backend: backend.origin, frontend: frontend.origin, key, settings };
  }
  async function record(config) { return (await api.storage.local.get(config.key))[config.key] || {}; }
  async function save(config, value) { await api.storage.local.set({ [config.key]: value }); }
  async function call(config, value, path, method = 'GET', body, headers = {}) {
    let reply;
    try { reply = await globalThis.BetterIliasRequest(config.backend + '/api/auth/unibe' + path, {
      method, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': config.settings.language || 'de',
        ...(value.credential ? { 'X-Unisport-Session': value.credential } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, 'connection', path === '/ilias-connection' ? 65000 : 20000); }
    catch (_) { throw new Error('unreachable'); }
    const { response, data: result } = reply;
    if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'connection');
    return result;
  }
  async function context(config, value) {
    // Read only configured top-level app tabs. Conflicting contexts are never
    // resolved by selecting a default/latest user.
    const contexts = [];
    for (const tab of await api.tabs.query({})) {
      try {
        if (![config.frontend, config.backend].includes(new URL(tab.url).origin)) continue;
        const result = await api.tabs.sendMessage(tab.id, { type: 'UNIBE_CONTEXT' });
        if (result && (valid(result.credential) || typeof result.sessionId === 'string')) contexts.push(result);
      } catch (_) {}
    }
    const credentials = [...new Set(contexts.map(row => row.credential).filter(valid))];
    const sessions = [...new Set(contexts.map(row => row.sessionId).filter(Boolean))];
    if (credentials.length > 1 || sessions.length > 1) throw new Error('context');
    if (credentials.length === 1 && credentials[0] !== value.credential)
      value = { credential: credentials[0], active: false };
    if (sessions.length === 1) value.previousSession = sessions[0];
    if (!value.credential) value.credential = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    await save(config, value);
    return value;
  }
  async function status(config, value) {
    const availability = await call(config, {}, '/availability');
    if (!availability.enabled) return { phase: 'unsupported' };
    const result = await call(config, value, '/connection');
    return { ...result, usage_retention_days: availability.usage_retention_days,
      ilias_connected: Boolean(value.sessionId) && value.scope === result.scope,
      user_name: result.user_name || (value.scope === result.scope ? value.userName : null) || null };
  }
  async function notify(config, value) {
    if (!valid(value.sessionId) || !valid(value.credential)) return;
    for (const tab of await api.tabs.query({})) {
      try {
        if (![config.frontend, config.backend].includes(new URL(tab.url).origin)) continue;
        await api.tabs.sendMessage(tab.id, { type: 'UNIBE_SELECTED', credential: value.credential, sessionId: value.sessionId });
      } catch (_) { /* Reopening the app will use the stored explicit selection. */ }
    }
  }
  async function operate(message, sender) {
    const config = await instance();
    globalThis.BetterIliasI18n?.setLanguage(config.settings.language || 'de');
    let value = await record(config);
    if (message.type === 'UNIBE_PAGE_CONNECTION') {
      if (!await globalThis.BetterIliasUnisportPage(sender) || config.settings.authMethod === 'legacy' || !value.active) return {};
      return { credential: value.credential, sessionId: value.sessionId };
    }
    const expected = api.runtime.getURL('popup.html');
    if (message.type === 'UNIBE_OPEN_FROM_PAGE') {
      if (!await globalThis.BetterIliasUnisportPage(sender)) throw new Error('sender');
      await context(config, value);
      await api.action.openPopup();
      return { opened: true };
    }
    if (sender.url?.split('?')[0] !== expected) throw new Error('sender');
    value = await context(config, value);
    if (message.type === 'UNIBE_STATUS') {
      const result = await status(config, value);
      await globalThis.BetterIliasToolbar?.setStatus(result.phase === 'connected' ? 'synced' : result.phase === 'disconnected' ? 'unauthenticated' : 'checking');
      return result;
    }
    if (message.type === 'UNIBE_LOGIN' || message.type === 'UNIBE_OPEN_LOGIN') {
      const transaction = await call(config, value, '/start', 'POST');
      await save(config, { ...value, pendingState: transaction.state });
      const [active] = await api.tabs.query({ active: true, currentWindow: true });
      await globalThis.BetterIliasUnisportStart({ ...transaction, credential: value.credential }, config.backend, sender.tab?.id || active?.id || null, 'unibe');
      return { phase: 'pending' };
    }
    if (message.type === 'UNIBE_AFFILIATION') {
      if (typeof message.affiliation !== 'string' || !/^[a-f0-9]{64}$/.test(message.scope || '')) throw new Error('affiliation');
      await call(config, value, '/affiliation', 'PUT', { affiliation: message.affiliation }, { 'X-Unisport-Scope': message.scope });
      await save(config, { ...value, candidate: null });
      return await status(config, value);
    }
    if (message.type === 'UNIBE_CONNECT') {
      const current = await status(config, value);
      if (current.phase !== 'connected' || !current.scope || !current.affiliation) throw new Error('affiliation');
      if (message.scope !== current.scope || message.affiliation !== current.affiliation) throw new Error('context');
      const result = await call(config, value, '/ilias-connection', 'POST', undefined, {
        'X-Unisport-Scope': current.scope, 'X-Unisport-Affiliation': current.affiliation,
        ...(value.previousSession || value.sessionId ? { 'X-Session-Id': value.previousSession || value.sessionId } : {}),
      });
      if (!result.authenticated || !valid(result.session_id)) throw new Error('connection');
      const candidate = { sessionId: result.session_id, userName: result.user_name, scope: current.scope, affiliation: current.affiliation };
      await save(config, { ...value, candidate });
      return { confirmation: Boolean(value.previousSession && value.previousSession !== result.session_id), user_name: result.user_name };
    }
    if (message.type === 'UNIBE_ACTIVATE') {
      const candidate = value.candidate;
      if (!candidate || !valid(candidate.sessionId)) throw new Error('context');
      const current = await status(config, value);
      if (candidate.scope !== current.scope || candidate.affiliation !== current.affiliation) throw new Error('context');
      value = { ...value, ...candidate, previousSession: candidate.sessionId, candidate: null, active: true };
      await save(config, value);
      await api.storage.local.set({ authMethod: 'unibe' });
      await notify(config, value);
      await globalThis.BetterIliasToolbar?.setStatus('synced');
      return { connected: true, user_name: value.userName };
    }
    if (message.type === 'UNIBE_DISCONNECT') {
      await call(config, value, '/connection', 'DELETE');
      await save(config, { ...value, candidate: null, pendingState: null });
      return { phase: 'disconnected' };
    }
    if (message.type === 'UNIBE_OPEN_APP') {
      const tab = (await api.tabs.query({})).find(tab => { try { return new URL(tab.url).origin === config.frontend; } catch (_) { return false; } });
      if (tab) await api.tabs.update(tab.id, { active: true });
      else await api.tabs.create({ url: config.frontend });
      return { opened: true };
    }
    throw new Error('message');
  }
  globalThis.BetterIliasUnibe = {
    async completed(pending) {
      const config = await instance(), value = await record(config);
      if (pending.backend !== config.backend || pending.credential !== value.credential || pending.state !== value.pendingState) return;
      await api.runtime.sendMessage({ type: 'UNIBE_UPDATED' }).catch(() => {});
    },
  };
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['UNIBE_STATUS', 'UNIBE_OPEN_LOGIN', 'UNIBE_OPEN_FROM_PAGE', 'UNIBE_LOGIN', 'UNIBE_AFFILIATION', 'UNIBE_CONNECT', 'UNIBE_ACTIVATE', 'UNIBE_DISCONNECT', 'UNIBE_OPEN_APP', 'UNIBE_PAGE_CONNECTION'].includes(message?.type)) return false;
    const action = operations.catch(() => {}).then(() => operate(message, sender));
    operations = action.then(() => {}, () => {});
    void action.then(data => respond({ success: true, data }), error => respond({ success: false, code: ['unreachable', 'configuration', 'context', 'affiliation', 'login_page'].includes(error.message) ? error.message : 'connection' }));
    return true;
  });
})();
