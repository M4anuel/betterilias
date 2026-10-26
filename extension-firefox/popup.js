const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const { t, languages, getLanguage, setLanguage } = BetterIliasI18n;
document.addEventListener('DOMContentLoaded', async () => {
  const byId = id => document.getElementById(id);
  const badge = byId('ilias-status-badge'), subtitle = byId('ilias-status-sub');
  const feedback = byId('feedback-box'), sync = byId('sync-btn'), language = byId('language');
  let syncing = false;
  try {
    const stored = await browserAPI.storage.local.get(['serverUrl', 'frontendUrl', 'language']);
    for (const [key, id] of [['serverUrl', 'server-url'], ['frontendUrl', 'frontend-url']]) {
      if (stored[key]) byId(id).value = stored[key];
    }
    if (stored.language) setLanguage(stored.language);
  } catch (error) { console.warn('Could not load settings:', error); }
  const serverUrl = () => (byId('server-url').value || 'http://localhost:8000').replace(/\/+$/, '');
  const frontendUrl = () => (byId('frontend-url').value || 'http://localhost:5173').replace(/\/+$/, '');
  function showFeedback(message, type = 'success') {
    feedback.textContent = message;
    feedback.className = `feedback visible ${type}`;
  }
  function render() {
    document.documentElement.lang = getLanguage();
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    language.replaceChildren();
    for (const [code, definition] of Object.entries(languages)) {
      const option = document.createElement('option'); option.value = code;
      option.textContent = definition.name + (definition.support === 'partial' ? ` (${t('Partially translated')})` : '');
      language.append(option);
    }
    language.value = getLanguage();
    sync.textContent = syncing ? t('Synchronisiere...') : t('Sitzung mit BetterIlias synchronisieren');
    sync.disabled = syncing;
  }
  async function fetchCookies() {
    const cookies = new Map();
    // Host-only, domain and Firefox partitioned cookies.
    for (const query of [{ url: 'https://ilias.unibe.ch/' }, { domain: 'ilias.unibe.ch' },
      { domain: 'ilias.unibe.ch', firstPartyDomain: null }]) {
      try {
        for (const cookie of await browserAPI.cookies.getAll(query)) {
          if (cookie.name && cookie.value) cookies.set(cookie.name, cookie.value);
        }
      } catch (_) { /* Query support differs between browsers. */ }
    }
    if (!cookies.has('ilClientId')) cookies.set('ilClientId', 'ilias3_unibe');
    return Object.fromEntries(cookies);
  }
  async function checkCookies() {
    try {
      const cookies = await fetchCookies(), present = Boolean(cookies.PHPSESSID);
      const verified = present && Object.keys(cookies).some(key => key.startsWith('_shibsession_'));
      badge.textContent = verified ? t('Bereit') : present ? t('Nicht verifiziert') : t('Nicht angemeldet');
      badge.className = `status-badge ${verified ? 'badge-success' : present ? 'badge-warning' : 'badge-danger'}`;
      subtitle.textContent = verified ? t('Aktive SWITCH edu-ID Sitzung gefunden.') : present
        ? t('Gast-Sitzung oder abgelaufen. Bitte auf ilias.unibe.ch mit SWITCH edu-ID einloggen.')
        : t('Keine Sitzung gefunden. Bitte logge dich zuerst auf ilias.unibe.ch ein.');
      if (!verified) {
        const link = document.createElement('a'); link.href = 'https://ilias.unibe.ch';
        link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = t('Bei ILIAS anmelden');
        link.style.cssText = 'display:block;color:var(--accent);text-decoration:underline;margin-top:6px';
        subtitle.append(link);
      }
      sync.disabled = syncing || !present;
    } catch (error) {
      badge.textContent = t('Fehler'); badge.className = 'status-badge badge-danger';
      subtitle.textContent = t('Fehler beim Prüfen der Cookies: {error}', { error: error.message });
      sync.disabled = true;
    }
  }
  language.addEventListener('change', async () => {
    setLanguage(language.value); feedback.className = 'feedback'; render();
    try { await browserAPI.storage.local.set({ language: getLanguage() }); }
    catch (_) { showFeedback(t('Could not save language preference.'), 'error'); }
    await checkCookies();
  });
  sync.addEventListener('click', async () => {
    feedback.className = 'feedback'; syncing = true; render();
    try {
      const cookies = await fetchCookies();
      if (!cookies.PHPSESSID) throw new Error(t('Kein PHPSESSID Cookie gefunden. Bitte zuerst bei ILIAS (ilias.unibe.ch) einloggen.'));
      const stored = await browserAPI.storage.local.get(['sessionId']);
      let response;
      try {
        response = await fetch(`${serverUrl()}/api/auth/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': getLanguage() },
          body: JSON.stringify({ cookies, session_id: stored.sessionId || null,
            source: typeof browser !== 'undefined' ? 'firefox_extension' : 'chrome_extension', user_agent: navigator.userAgent }),
        });
      } catch (error) {
        throw new Error(t('Verbindung zum Backend fehlgeschlagen ({error}). Läuft das Backend auf {url}?', { error: error.message, url: serverUrl() }));
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : t('Server Fehler ({status})', { status: response.status }));
      if (!data.success || !data.authenticated) {
        showFeedback(data.message || t('Sitzung konnte auf ILIAS nicht verifiziert werden.'), 'error'); return;
      }
      await browserAPI.storage.local.set({ sessionId: data.session_id });
      const user = data.user_name || t('Benutzer');
      showFeedback(t('Erfolgreich synchronisiert als "{user}"!', { user }));
      badge.textContent = t('Synchronisiert'); badge.className = 'status-badge badge-success';
      subtitle.textContent = t('Angemeldet als {user}', { user });
      for (const tab of await browserAPI.tabs.query({})) {
        if (tab.url && tab.url.startsWith(frontendUrl()) && tab.id) {
          try { await browserAPI.tabs.sendMessage(tab.id, { type: 'BETTERILIAS_SESSION_SYNCED', sessionId: data.session_id }); }
          catch (_) { /* Tab may have closed. */ }
        }
      }
    } catch (error) { showFeedback(error.message, 'error'); }
    finally { syncing = false; sync.textContent = t('Sitzung mit BetterIlias synchronisieren'); sync.disabled = false; }
  });
  byId('open-app-btn').addEventListener('click', async () => {
    const stored = await browserAPI.storage.local.get(['sessionId']), target = new URL(frontendUrl());
    if (stored.sessionId) target.searchParams.set('session_id', stored.sessionId);
    browserAPI.tabs.create({ url: target.href });
  });
  byId('save-settings-btn').addEventListener('click', async () => {
    try {
      await browserAPI.storage.local.set({ serverUrl: serverUrl(), frontendUrl: frontendUrl() });
      showFeedback(t('Einstellungen gespeichert.'));
    } catch (_) { showFeedback(t('Could not save settings.'), 'error'); }
  });
  render(); await checkCookies();
});
