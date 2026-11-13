// Safari background-page logic. No Chrome worker loaders or popup-owned writes.
globalThis.SafariCompanion = (() => {
  const api = browser, config = SafariCompanionConfig;
  const KEY = 'safariCompanion', ILIAS = 'https://ilias.unibe.ch', ALARM = 'betterilias-safari-check';
  let flight;
  let writes = Promise.resolve();
  function origin(value, expected) {
    try { return new URL(value).origin === new URL(expected).origin; } catch { return false; }
  }
  function authCookie(name) {
    return typeof name === 'string' && !/[|{}\[\]]/.test(name) &&
      (name === 'PHPSESSID' || name === 'ilClientId' || name.startsWith('_shibsession_') || name.startsWith('il_'));
  }
  async function state() {
    const stored = await api.storage.local.get([KEY, 'autoSyncEnabled', 'language']);
    const value = stored[KEY];
    return { autoSyncEnabled: stored.autoSyncEnabled !== false, language: stored.language || (navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'),
      status: 'unknown', revision: 0, ...value,
      ...(value?.serverUrl && value.serverUrl !== config.serverUrl ? { sessionId: null, fingerprint: null, status: 'unknown', lastSync: 0, lease: null, leaseUntil: 0, lastAttempt: 0, userName: '' } : {}),
      serverUrl: config.serverUrl };
  }
  async function patch(values, expected = {}) {
    const previous = writes;
    let release;
    writes = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const current = await state();
      if (Object.entries(expected).some(([key, value]) => current[key] !== value)) return null;
      const next = { ...current, ...(typeof values === 'function' ? values(current) : values) };
      await api.storage.local.set({ [KEY]: next }); return next;
    } finally { release(); }
  }
  function publicState(value) {
    return { status: value.status, autoSyncEnabled: value.autoSyncEnabled, language: value.language,
      userName: value.status === 'connected' ? value.userName || '' : '', lastSync: value.lastSync || 0,
      serverUrl: config.serverUrl, frontendUrl: config.frontendUrl, automaticAvailable: Boolean(api.tabs?.onUpdated) };
  }
  async function status(value, values = {}, expected = {}) {
    const result = await patch({ ...values, status: value }, expected);
    if (!result) return { ...publicState(await state()), superseded: true };
    try { await api.action?.setBadgeText?.({ text: value === 'error' ? '!' : '' }); } catch { /* optional on iOS */ }
    return publicState(result);
  }
  async function cookies() {
    let found;
    try {
      if (api.permissions?.contains && !await api.permissions.contains({ origins: [ILIAS + '/*', new URL(config.serverUrl).origin + '/*'] })) throw new Error('permission');
      found = await api.cookies.getAll({ url: ILIAS + '/' });
    } catch { throw new Error('permission'); }
    const selected = Object.fromEntries(found.filter(cookie => {
      const domain = cookie.domain?.replace(/^\./, '');
      return cookie.value && authCookie(cookie.name) && (!domain || new URL(ILIAS).hostname === domain || new URL(ILIAS).hostname.endsWith('.' + domain));
    }).map(cookie => [cookie.name, cookie.value]));
    if (!selected.ilClientId) selected.ilClientId = 'ilias3_unibe';
    return selected;
  }
  async function fingerprint(values) {
    const input = JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  async function request(path, body, headers = {}, timeoutMs = 20000) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(config.serverUrl + path, { method: 'POST', credentials: 'omit', redirect: 'error',
            headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
          return { response, data: await response.json() };
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('error')); }, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function currentCredential(sessionId) {
    try {
      const current = await state();
      return current.status === 'connected' && current.sessionId === sessionId &&
        current.fingerprint === await fingerprint(await cookies());
    } catch { return false; }
  }
  async function notify(sessionId, recover = false) {
    let tabs; try { tabs = await api.tabs.query({}); } catch { return false; }
    let delivered = true;
    for (const tab of tabs) {
      if (tab.id == null || !origin(tab.url, config.frontendUrl)) continue;
      if (!await currentCredential(sessionId)) return false;
      try {
        const reply = await api.tabs.sendMessage(tab.id, { type: 'BETTERILIAS_SESSION_SYNCED', sessionId });
        if (reply?.success) continue;
      } catch { /* A tab open before installation may have no content script. */ }
      if (!recover) continue;
      try {
        const { response, data } = await request('/api/auth/mobile-session', undefined, { 'X-Session-Id': sessionId });
        if (!response.ok || !data.handoff_token) throw new Error('handoff');
        if (!await currentCredential(sessionId)) return false;
        const target = new URL(tab.url);
        target.hash = new URLSearchParams({ connect: data.handoff_token }).toString();
        await api.tabs.update(tab.id, { url: target.href });
        await api.tabs.reload(tab.id);
      } catch { delivered = false; }
    }
    return delivered;
  }
  async function verify(force, retry = false) {
    const before = await state();
    if (!force && !before.autoSyncEnabled) return status('disabled');
    const now = Date.now();
    if (before.leaseUntil > now) return { ...publicState(before), status: 'busy' };
    const lease = crypto.randomUUID();
    if (!await patch({ lease, leaseUntil: now + 30000, lastAttempt: now }, { revision: before.revision })) return publicState(await state());
    const expected = { revision: before.revision, lease };
    let changed = false;
    try {
      const jar = await cookies();
      if (!jar.PHPSESSID) return await status('login', { fingerprint: null, lastSync: 0 }, expected);
      const stamp = await fingerprint(jar);
      // Read the current login before applying cooldown. A fast account switch
      // must never hand the previous user's cached session to the app.
      if (!force && !retry && before.attemptFingerprint === stamp && now - (before.lastAttempt || 0) < 15000) {
        if (before.status === 'connected' && before.sessionId) await notify(before.sessionId);
        return publicState(before);
      }
      if (!force && before.status === 'connected' && before.sessionId && before.fingerprint === stamp && now - before.lastSync < 300000) {
        await notify(before.sessionId); return publicState(before);
      }
      const checking = await status('checking', {}, expected);
      if (checking.superseded) return checking;
      if (!await patch({ attemptFingerprint: stamp }, expected)) return publicState(await state());
      const { response, data } = await request('/api/auth/sync', { cookies: jar, session_id: before.sessionId || null,
        source: 'safari_extension', user_agent: navigator.userAgent }, { 'Accept-Language': before.language });
      const live = await state();
      if (live.lease !== lease || live.revision !== before.revision || (!force && !live.autoSyncEnabled)) return { ...publicState(live), superseded: true };
      if (await fingerprint(await cookies()) !== stamp) {
        changed = true; await patch({ lastAttempt: 0, fingerprint: null });
      } else if (response.ok && data.success === true && data.authenticated === true && typeof data.session_id === 'string' && data.session_id) {
        const result = await status('connected', { sessionId: data.session_id, fingerprint: stamp, lastSync: Date.now(), userName: data.user_name || '' }, expected);
        if (result.superseded) return result;
        await notify(data.session_id); return result;
      } else if (response.status === 401 || response.status === 403 || (response.ok && data.authenticated === false)) {
        return await status('login', { fingerprint: null, lastSync: 0 }, expected);
      } else { return await status('error', { fingerprint: null, lastSync: 0 }, expected); }
    } catch (error) {
      const current = await state();
      if (current.revision !== before.revision) return await status(current.autoSyncEnabled ? 'unknown' : 'disabled');
      // Preserve credentials for retry but never advertise failed verification.
      return await status(error.message === 'permission' ? 'permission' : 'error', { fingerprint: null, lastSync: 0 }, expected);
    } finally {
      if ((await state()).lease === lease) await patch({ lease: null, leaseUntil: 0 });
    }
    if (changed && !retry) return verify(force, true);
    return status('unknown');
  }
  async function sync(force = false) {
    if (flight) return flight;
    flight = verify(force);
    try { return await flight; } finally { flight = undefined; }
  }
  async function preferences(values) {
    await patch(current => ({ autoSyncEnabled: typeof values.autoSyncEnabled === 'boolean' ? values.autoSyncEnabled : current.autoSyncEnabled,
      language: ['de', 'en'].includes(values.language) ? values.language : current.language, revision: current.revision + 1, lastAttempt: 0,
      status: values.autoSyncEnabled === false ? 'disabled' : 'unknown' }));
    return publicState(await state());
  }
  async function openApp() {
    const checked = await sync(true);
    if (checked.status !== 'connected') return checked;
    const verified = await state();
    const { response, data } = await request('/api/auth/mobile-session', undefined, { 'X-Session-Id': verified.sessionId, 'Accept-Language': verified.language });
    if (!response.ok || typeof data.handoff_token !== 'string' || !data.handoff_token) return { ...checked, status: 'error' };
    if (!await currentCredential(verified.sessionId)) return { ...checked, status: 'unknown', userName: '' };
    const url = new URL(config.frontendUrl);
    url.hash = new URLSearchParams({ connect: data.handoff_token }).toString();
    await api.tabs.create({ url: url.href }); return checked;
  }
  async function manualSync() {
    const checked = await sync(true);
    if (checked.status !== 'connected') return checked;
    // Reload recovery is reserved for the explicit Sync action. Opening the app
    // or an automatic check must not reload an existing tab with an editor draft.
    return { ...checked, pageConnectionFailed: !await notify((await state()).sessionId, true) };
  }
  async function alarm() {
    try { if (api.alarms?.get && api.alarms?.create && !await api.alarms.get(ALARM)) await api.alarms.create(ALARM, { periodInMinutes: 5 }); }
    catch { /* Activity/manual sync remain available. */ }
  }
  return { config, ILIAS, ALARM, origin, authCookie, state, publicState, sync, manualSync, preferences, openApp, alarm, request };
})();
