// Safari popup is a view/controller. All credential work belongs to background.
document.addEventListener('DOMContentLoaded', () => {
  const { t, setLanguage, getLanguage } = BetterIliasI18n;
  const byId = id => document.getElementById(id);
  let busy = false, model = { status: 'unknown' };
  const messages = () => ({
    unknown: t('safari.status.unknown'), checking: t('safari.status.checking'), connected: t('safari.status.connected'),
    login: t('safari.status.login'), permission: t('safari.status.permission'), error: t('safari.status.error'),
    busy: t('safari.status.busy'), disabled: t('safari.status.disabled')
  });
  function render() {
    document.documentElement.lang = getLanguage();
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    byId('status').textContent = messages()[busy ? 'checking' : model.status] || messages().unknown;
    byId('status').dataset.state = busy ? 'checking' : model.status;
    byId('user').textContent = model.userName ? t('safari.user', { name: model.userName }) : '';
    byId('user').hidden = !model.userName || model.status !== 'connected';
    byId('server').textContent = SafariCompanionConfig.frontendUrl;
    byId('sites').textContent = `ilias.unibe.ch · ${new URL(SafariCompanionConfig.frontendUrl).hostname}`;
    for (const id of ['sync', 'open', 'login', 'grant', 'save']) byId(id).disabled = busy;
    byId('preference-fields').disabled = busy;
    if (model.status === 'permission') byId('access-note').open = true;
  }
  async function send(type, values = {}) {
    let timer;
    try {
      return await Promise.race([
        browser.runtime.sendMessage({ type, ...values }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('unavailable')), 25000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function perform(action, saved = false) {
    if (busy) return;
    busy = true; byId('feedback').hidden = true; render();
    try {
      const result = await action();
      model = result?.status ? result : { status: 'error' };
      if (saved && model.status !== 'error') { byId('feedback').textContent = t('safari.saved'); byId('feedback').hidden = false; }
    } catch { model = { ...model, status: 'error', userName: '' }; }
    finally { busy = false; render(); }
  }
  byId('sync').addEventListener('click', () => { void perform(() => send('SAFARI_SYNC')); });
  byId('open').addEventListener('click', () => { void perform(() => send('SAFARI_OPEN_APP')); });
  byId('login').addEventListener('click', () => { void perform(() => send('SAFARI_LOGIN')); });
  byId('grant').addEventListener('click', () => {
    // Call within the user gesture, before awaiting anything. Safari may instead
    // require the user to grant website access through its extension settings.
    let permission;
    try { permission = browser.permissions?.request?.({ origins: ['https://ilias.unibe.ch/*', new URL(SafariCompanionConfig.frontendUrl).origin + '/*'] }); }
    catch { permission = undefined; }
    void perform(async () => {
      let granted = false;
      try { granted = Boolean(permission && await permission); } catch { /* Safari settings can grant access instead. */ }
      if (!granted) return { ...model, status: 'permission' };
      return send('SAFARI_SYNC');
    });
  });
  byId('language').addEventListener('change', () => { setLanguage(byId('language').value); render(); });
  byId('preferences').addEventListener('submit', event => {
    event.preventDefault();
    void perform(() => send('SAFARI_PREFERENCES', { language: byId('language').value, autoSyncEnabled: byId('automatic').checked }), true);
  });
  render();
  void (async () => {
    await perform(async () => {
      const stored = await send('SAFARI_GET_STATUS');
      if (stored?.language) setLanguage(stored.language);
      byId('language').value = getLanguage();
      byId('automatic').checked = stored?.autoSyncEnabled !== false;
      return stored?.autoSyncEnabled !== false ? send('SAFARI_CHECK') : stored;
    });
  })();
});
