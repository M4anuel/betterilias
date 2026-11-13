// Register synchronously on every Safari nonpersistent background-page wakeup.
(() => {
  const companion = SafariCompanion;
  const run = async () => { try { await companion.sync(false); } catch { /* Retry from popup/next activity. */ } };
  function trusted(sender) {
    if (sender?.id !== browser.runtime.id) return false;
    if (sender.tab) return companion.origin(sender.url || sender.tab.url, companion.config.frontendUrl) ? 'app'
      : companion.origin(sender.url || sender.tab.url, companion.ILIAS) ? 'ilias' : false;
    return sender.url === browser.runtime.getURL('popup.html') ? 'popup' : false;
  }
  browser.runtime.onMessage.addListener((message, sender, reply) => {
    const source = trusted(sender);
    if (!source || !message || typeof message.type !== 'string') return false;
    const type = message.type;
    if (source !== 'popup' && type !== 'SAFARI_PAGE_READY') return false;
    const respond = async () => {
      try {
        if (type === 'SAFARI_GET_STATUS') return companion.publicState(await companion.state());
        if (type === 'SAFARI_SYNC') return await companion.sync(true);
        if (type === 'SAFARI_CHECK') return await companion.sync(false);
        if (type === 'SAFARI_PREFERENCES') {
          const updated = await companion.preferences(message);
          return updated.autoSyncEnabled ? await companion.sync(false) : updated;
        }
        if (type === 'SAFARI_OPEN_APP') return await companion.openApp();
        if (type === 'SAFARI_LOGIN') { await browser.tabs.create({ url: companion.ILIAS + '/' }); return { status: 'login' }; }
        if (type === 'SAFARI_PAGE_READY') {
          const result = await companion.sync(false), stored = await companion.state();
          return source === 'app' && result.status === 'connected' ? { ...result, sessionId: stored.sessionId } : { status: result.status };
        }
        return { status: 'error' };
      } catch { return { status: 'error' }; }
    };
    void (async () => reply(await respond()))(); return true;
  });
  browser.tabs?.onUpdated?.addListener((_, change, tab) => {
    if (change.status === 'complete' && (companion.origin(tab.url, companion.ILIAS) || companion.origin(tab.url, companion.config.frontendUrl))) void run();
  });
  browser.tabs?.onActivated?.addListener(async info => {
    try { const tab = await browser.tabs.get(info.tabId);
      if (companion.origin(tab.url, companion.ILIAS) || companion.origin(tab.url, companion.config.frontendUrl)) await run();
    } catch { /* Closed/restricted tab. */ }
  });
  browser.alarms?.onAlarm?.addListener(event => { if (event.name === companion.ALARM) void run(); });
  browser.runtime.onInstalled?.addListener(async () => {
    await browser.storage.local.remove?.(['lastSyncSignature', 'syncLeaseUntil', 'syncPending']); await companion.alarm();
  });
  browser.runtime.onStartup?.addListener(async () => { await companion.alarm(); await run(); });
  void companion.alarm();
})();
