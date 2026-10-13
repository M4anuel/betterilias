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

  function showFeedback(text, type = 'success') {
    feedbackBox.textContent = text;
    feedbackBox.className = `feedback visible ${type}`;
  }

  function hideFeedback() {
    feedbackBox.className = 'feedback';
    feedbackBox.textContent = '';
  }

  // Helper to fetch cookies reliably across Firefox (TCP / First-Party Isolation) and Chromium
  async function fetchAllIliasCookies() {
    let cookies = [];
    try {
      cookies = await browserAPI.cookies.getAll({ domain: 'ilias.unibe.ch', firstPartyDomain: null });
    } catch {
      try {
        cookies = await browserAPI.cookies.getAll({ domain: 'ilias.unibe.ch' });
      } catch {
        cookies = await browserAPI.cookies.getAll({ url: 'https://ilias.unibe.ch/' });
      }
    }

    if (!cookies || cookies.length === 0) {
      try {
        cookies = await browserAPI.cookies.getAll({ url: 'https://ilias.unibe.ch/' });
      } catch {}
    }

    return cookies || [];
  }

  // 1. Check ILIAS cookies in browser
  async function checkIliasCookies() {
    try {
      const cookies = await fetchAllIliasCookies();
      const phpSess = cookies.find((c) => c.name === 'PHPSESSID');

      if (phpSess && phpSess.value) {
        iliasBadge.textContent = 'Bereit';
        iliasBadge.className = 'status-badge badge-success';
        iliasSub.textContent = `PHPSESSID vorhanden (${cookies.length} Cookies gefunden).`;
        syncBtn.disabled = false;
        return cookies;
      } else {
        iliasBadge.textContent = 'Nicht angemeldet';
        iliasBadge.className = 'status-badge badge-danger';
        iliasSub.innerHTML = 'Keine aktive Sitzung auf <b>ilias.unibe.ch</b> gefunden. Bitte logge dich zuerst ein.';
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
      const cookiesList = await fetchAllIliasCookies();
      const cookiesDict = {};
      for (const c of cookiesList) {
        cookiesDict[c.name] = c.value;
      }

      if (!cookiesDict['PHPSESSID']) {
        throw new Error('Kein PHPSESSID Cookie gefunden. Bitte zuerst bei ILIAS (ilias.unibe.ch) anmelden.');
      }

      const storedData = await browserAPI.storage.local.get(['sessionId']);
      const payload = {
        cookies: cookiesDict,
        session_id: storedData.sessionId || null,
        source: 'firefox_extension'
      };

      const serverUrl = getServerUrl();
      const res = await fetch(`${serverUrl}/api/auth/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server Fehler (${res.status})`);
      }

      const data = await res.json();
      if (!data.success || !data.authenticated) {
        throw new Error(data.message || 'Sitzung konnte auf ILIAS nicht verifiziert werden.');
      }

      // Save sessionId in storage
      await browserAPI.storage.local.set({ sessionId: data.session_id });

      const userName = data.user_name || 'Benutzer';
      showFeedback(`✅ Erfolgreich synchronisiert als "${userName}"!`, 'success');

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

