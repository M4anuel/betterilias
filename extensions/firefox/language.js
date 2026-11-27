// Only the language preference crosses this bridge, never app cookies or tokens.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const supported = value => typeof value === 'string' && Object.hasOwn(BetterIliasI18n.languages, value);
  async function tabs() {
    const settings = await api.storage.local.get(['frontendUrl']);
    const origin = new URL(settings.frontendUrl || 'http://localhost:5173').origin;
    return (await api.tabs.query({})).filter(tab => { try { return new URL(tab.url).origin === origin; } catch (_) { return false; } });
  }
  async function save(language) {
    if (!supported(language)) throw new Error('language');
    await api.storage.local.set({ language });
    BetterIliasI18n.setLanguage(language);
    for (const tab of await tabs()) {
      try { await api.tabs.sendMessage(tab.id, { type: 'COMPANION_LANGUAGE_APPLY', language }); } catch (_) {}
    }
    return { language };
  }
  let queue = Promise.resolve();
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['COMPANION_LANGUAGE_INIT','COMPANION_LANGUAGE_SET','COMPANION_LANGUAGE_ATTACH'].includes(message?.type)) return false;
    const action = queue.catch(() => {}).then(async () => {
      const popup = sender.url?.split('?')[0] === api.runtime.getURL('popup.html');
      if (!popup && !await globalThis.BetterIliasUnisportPage(sender)) throw new Error('sender');
      const stored = await api.storage.local.get(['language']);
      if (message.type === 'COMPANION_LANGUAGE_SET' && !supported(message.language)) return {};
      if (message.type === 'COMPANION_LANGUAGE_SET' && supported(message.language)) {
        if (stored.language === message.language) return { language: stored.language };
        return await save(message.language);
      }
      if (supported(stored.language)) return { language: stored.language };
      let preferred = supported(message.language) ? message.language : null;
      if (!preferred) for (const tab of await tabs()) {
        try { const reply = await api.tabs.sendMessage(tab.id, { type: 'COMPANION_LANGUAGE_GET' }); if (supported(reply?.language)) { preferred = reply.language; break; } } catch (_) {}
      }
      return await save(preferred || BetterIliasI18n.getLanguage());
    });
    queue = action.catch(() => {});
    void action.then(respond, () => respond({ error: true }));
    return true;
  });
})();
