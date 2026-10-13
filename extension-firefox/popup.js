const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const iliasBadge = document.getElementById('ilias-status-badge');
  const iliasSub = document.getElementById('ilias-status-sub');
  const feedbackBox = document.getElementById('feedback-box');
  const syncBtn = document.getElementById('sync-btn');
  const openAppBtn = document.getElementById('open-app-btn');
  const serverUrlInput = document.getElementById('server-url');
  const frontendUrlInput = document.getElementById('frontend-url');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  // Load configured URLs
  try {
    const stored = await browserAPI.storage.local.get(['serverUrl', 'frontendUrl', 'sessionId']);
    if (stored.serverUrl) serverUrlInput.value = stored.serverUrl;
    if (stored.frontendUrl) frontendUrlInput.value = stored.frontendUrl;
  } catch (err) {
    console.warn('Could not load stored URLs:', err);
  }

  const getServerUrl = () => (serverUrlInput.value || 'http://localhost:8000').replace(/\/+$/, '');
  const getFrontendUrl = () => (frontendUrlInput.value || 'http://localhost:5173').replace(/\/+$/, '');

  function showFeedback(text, type = 'success', isHtml = false) {
    if (isHtml) {
      feedbackBox.innerHTML = text;
    } else {
      feedbackBox.textContent = text;
    }
    feedbackBox.className = `feedback visible ${type}`;
  }

  function hideFeedback() {
    feedbackBox.className = 'feedback';
    feedbackBox.textContent = '';
  }

  // Fetch all cookies for ILIAS via multiple strategies (URL, Domain, FPI)
  async function fetchAllIliasCookies() {
    const cookieMap = new Map();
    const addList = (list) => {
      if (Array.isArray(list)) {
        for (const c of list) {
          if (c && c.name && c.value) {
            cookieMap.set(c.name, c.value);
          }
        }
      }
    };

    // 1. Query by full URL (captures host-only & path-specific cookies)
    try {
      const urlCookies = await browserAPI.cookies.getAll({ url: 'https://ilias.unibe.ch/' });
      addList(urlCookies);
    } catch (_) {}

    // 2. Query by domain (captures wildcard domain cookies)
    try {
      const domainCookies = await browserAPI.cookies.getAll({ domain: 'ilias.unibe.ch' });
      addList(domainCookies);
    } catch (_) {}

    // 3. Firefox with firstPartyDomain (Total Cookie Protection / State Partitioning)
    try {
      const fpiCookies = await browserAPI.cookies.getAll({ domain: 'ilias.unibe.ch', firstPartyDomain: null });
      addList(fpiCookies);
    } catch (_) {}

    // Ensure ilClientId is present (Uni Bern client)
    if (!cookieMap.has('ilClientId')) {
      cookieMap.set('ilClientId', 'ilias3_unibe');
    }

    return Object.fromEntries(cookieMap);
  }

  // 1. Check ILIAS cookies in browser
  async function checkIliasCookies() {
    try {
      const cookiesDict = await fetchAllIliasCookies();
      const hasPhpSess = Boolean(cookiesDict['PHPSESSID']);
      const hasShibSession = Object.keys(cookiesDict).some((k) => k.startsWith('_shibsession_'));

      if (hasPhpSess && hasShibSession) {
        iliasBadge.textContent = 'Bereit';
        iliasBadge.className = 'status-badge badge-success';
        iliasSub.innerHTML = 'Aktive SWITCH edu-ID Sitzung gefunden.';
        syncBtn.disabled = false;
        return cookiesDict;
      } else if (hasPhpSess) {
        // PHPSESSID exists but no Shibboleth SSO token (might be guest or expired)
        iliasBadge.textContent = 'Nicht verifiziert';
        iliasBadge.className = 'status-badge badge-warning';
        iliasSub.innerHTML = 'Gast-Sitzung oder abgelaufen. Bitte auf <a href="https://ilias.unibe.ch" target="_blank" style="color:var(--accent);text-decoration:underline;">ilias.unibe.ch</a> mit SWITCH edu-ID einloggen.';
        syncBtn.disabled = false;
        return cookiesDict;
      } else {
        iliasBadge.textContent = 'Nicht angemeldet';
        iliasBadge.className = 'status-badge badge-danger';
        iliasSub.innerHTML = 'Keine Sitzung gefunden. Bitte logge dich zuerst auf <a href="https://ilias.unibe.ch" target="_blank" style="color:var(--accent);text-decoration:underline;">ilias.unibe.ch</a> ein.';
        syncBtn.disabled = true;
        return null;
      }
    } catch (err) {
      iliasBadge.textContent = 'Fehler';
      iliasBadge.className = 'status-badge badge-danger';
      iliasSub.textContent = `Fehler beim Prüfen der Cookies: ${err.message}`;
      return null;
    }
  }

  await checkIliasCookies();

  // 2. Handle Sync Click
  syncBtn.addEventListener('click', async () => {
    hideFeedback();
    syncBtn.disabled = true;
    syncBtn.textContent = 'Synchronisiere...';

    try {
      const cookiesDict = await fetchAllIliasCookies();

      if (!cookiesDict['PHPSESSID']) {
        throw new Error('Kein PHPSESSID Cookie gefunden. Bitte zuerst bei ILIAS (ilias.unibe.ch) einloggen.');
      }

      const storedData = await browserAPI.storage.local.get(['sessionId']);
      const isFirefox = typeof browser !== 'undefined';
      const payload = {
        cookies: cookiesDict,
        session_id: storedData.sessionId || null,
        source: isFirefox ? 'firefox_extension' : 'chrome_extension',
        user_agent: navigator.userAgent
      };

      const serverUrl = getServerUrl();
      let res;
      try {
        res = await fetch(`${serverUrl}/api/auth/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (networkErr) {
        throw new Error(`Verbindung zum Backend fehlgeschlagen (${networkErr.message}). Läuft das Backend auf ${serverUrl}?`);
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server Fehler (${res.status})`);
      }

      const data = await res.json();
      if (!data.success || !data.authenticated) {
        const msg = data.message || 'Sitzung konnte auf ILIAS nicht verifiziert werden.';
        showFeedback(
          `❌ ${msg}<br/><a href="https://ilias.unibe.ch" target="_blank" style="color:var(--accent);text-decoration:underline;font-weight:600;display:inline-block;margin-top:6px;">👉 Jetzt auf ilias.unibe.ch einloggen</a>`,
          'error',
          true
        );
        return;
      }

      // Save sessionId in storage
      await browserAPI.storage.local.set({ sessionId: data.session_id });

      const userName = data.user_name || 'Benutzer';
      showFeedback(`✅ Erfolgreich synchronisiert als "${userName}"!`, 'success');

      // Update badge to verified
      iliasBadge.textContent = 'Synchronisiert';
      iliasBadge.className = 'status-badge badge-success';
      iliasSub.textContent = `Angemeldet als ${userName}`;

      // Notify any active BetterIlias tabs
      const tabs = await browserAPI.tabs.query({});
      const frontendUrl = getFrontendUrl();
      for (const tab of tabs) {
        if (tab.url && tab.url.startsWith(frontendUrl) && tab.id) {
          try {
            await browserAPI.tabs.sendMessage(tab.id, {
              type: 'BETTERILIAS_SESSION_SYNCED',
              sessionId: data.session_id
            });
          } catch (_) {}
        }
      }

    } catch (err) {
      showFeedback(`❌ ${err.message}`, 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sitzung mit BetterIlias synchronisieren';
    }
  });

  // 3. Handle Open App Click
  openAppBtn.addEventListener('click', async () => {
    const frontendUrl = getFrontendUrl();
    const storedData = await browserAPI.storage.local.get(['sessionId']);
    const targetUrl = storedData.sessionId
      ? `${frontendUrl}?session_id=${encodeURIComponent(storedData.sessionId)}`
      : frontendUrl;

    browserAPI.tabs.create({ url: targetUrl });
  });

  // 4. Save Settings
  saveSettingsBtn.addEventListener('click', async () => {
    await browserAPI.storage.local.set({
      serverUrl: getServerUrl(),
      frontendUrl: getFrontendUrl()
    });
    showFeedback('Einstellungen gespeichert.', 'success');
    setTimeout(hideFeedback, 2000);
  });
});
