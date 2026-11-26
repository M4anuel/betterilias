const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const { t, languages, getLanguage, setLanguage } = BetterIliasI18n;
document.addEventListener('DOMContentLoaded', async () => {
  const byId = id => document.getElementById(id);
  const fullPage = new URL(location.href).searchParams.has('login');
  document.documentElement.classList.toggle('full-page', fullPage);
  let state = { phase: 'checking' }, busy = false, draft = '', scope = null, timer, confirmation = false, focusAffiliation = false;
  const stored = await browserAPI.storage.local.get(['serverUrl', 'frontendUrl', 'language']).catch(() => ({}));
  if (stored.language) setLanguage(stored.language);
  for (const [key, id] of [['serverUrl', 'server-url'], ['frontendUrl', 'frontend-url']]) if (stored[key]) byId(id).value = stored[key];
  async function send(type, extra = {}) {
    const reply = await browserAPI.runtime.sendMessage({ type, ...extra });
    if (!reply?.success) throw new Error(reply?.code === 'context' ? t('unisport.ilias_context_changed') : t('unibe.unavailable'));
    return reply.data;
  }
  function feedback(message, error = false) {
    const node = byId('feedback-box');node.textContent = message;node.className = 'feedback visible ' + (error ? 'error' : 'success');
    node.setAttribute('role', error ? 'alert' : 'status');
  }
  function render() {
    document.documentElement.lang = getLanguage();
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    const connected = state.phase === 'connected', pending = ['pending', 'exchanging'].includes(state.phase);
    const badge = byId('account-state');
    badge.textContent = connected ? t('unisport.connected') : pending ? t('unisport.waiting') : state.phase === 'checking' ? t('Prüfe...') : t('Nicht angemeldet');
    badge.className = 'status-badge ' + (connected ? 'badge-success' : 'badge-warning');
    byId('account-name').textContent = connected ? state.user_name || t('Benutzer') : '';
    byId('usage-notice').hidden = !state.usage_retention_days;
    byId('usage-notice').textContent = state.usage_retention_days ? t('unibe.usage_notice', { days: state.usage_retention_days }) : '';
    byId('account-description').textContent = connected ? t('unibe.connected_hint') : pending ? t('unisport.waiting') : state.phase === 'error' ? t('unibe.unavailable') : state.phase === 'unsupported' ? t('unibe.unsupported') : t('unibe.login_description');
    byId('login-btn').hidden = state.phase !== 'disconnected';
    byId('retry-btn').hidden = state.phase !== 'error';
    byId('affiliation-form').hidden = !connected || confirmation;
    byId('disconnect-btn').hidden = !(connected || pending);
    byId('confirm-switch').hidden = !confirmation;
    byId('confirm-message').textContent = t('unisport.ilias_replace_confirm', { name: state.user_name || t('Benutzer') });
    const select = byId('affiliation'), choices = state.affiliations || [];
    if (select.dataset.choices !== JSON.stringify([getLanguage(), choices])) {
      select.replaceChildren();
      for (const value of ['', ...choices]) {
        const option = document.createElement('option');option.value = value;
        option.textContent = value ? value.slice(value.lastIndexOf('@') + 1) : t('unisport.choose_affiliation');select.append(option);
      }
      select.dataset.choices = JSON.stringify([getLanguage(), choices]);
    }
    select.value = draft;
    for (const node of document.querySelectorAll('button, select, input')) node.disabled = busy;
    byId('connect-btn').textContent = busy ? t('Synchronisiere...') : t('unibe.connect');
  }
  function apply(next) {
    if (['pending', 'exchanging'].includes(state.phase) && next.phase === 'connected') focusAffiliation = true;
    if (next.scope !== scope) { scope = next.scope || null;draft = next.affiliation || '';confirmation = false; }
    if (draft && !next.affiliations?.includes(draft)) draft = next.affiliation || '';
    state = next;render();clearTimeout(timer);
    if (next.phase === 'connected' && Number.isFinite(next.expires_at)) {
      timer = setTimeout(() => { state = { phase: 'disconnected' };confirmation = false;render(); }, Math.max(0, next.expires_at * 1000 - Date.now()));
    } else if (['pending', 'exchanging'].includes(next.phase)) timer = setTimeout(() => void refresh(), 2000);
  }
  async function run(action) {
    if (busy) return;
    busy = true;render();byId('feedback-box').className = 'feedback';
    try { await action(); }
    catch (error) { feedback(error.message || t('unibe.unavailable'), true); }
    finally {
      busy = false;render();
      if (focusAffiliation && state.phase === 'connected' && document.hasFocus()) {
        focusAffiliation = false;byId('affiliation').focus();
      }
    }
  }
  async function refresh() {
    if (busy) return;
    await run(async () => {
      try { apply(await send('UNIBE_STATUS')); }
      catch (error) { state = { phase: 'error' };throw error; }
    });
  }
  async function refreshAfterAction() { apply(await send('UNIBE_STATUS')); }
  byId('language').replaceChildren();
  for (const [code, definition] of Object.entries(languages)) {
    const option = document.createElement('option');option.value = code;option.textContent = definition.name;byId('language').append(option);
  }
  byId('language').value = getLanguage();
  byId('language').addEventListener('change', async event => {
    setLanguage(event.target.value);await browserAPI.storage.local.set({ language: getLanguage() });render();void refresh();
  });
  byId('login-btn').addEventListener('click', () => void run(async () => {
    if (fullPage) apply(await send('UNIBE_LOGIN'));
    else { await send('UNIBE_OPEN_LOGIN');window.close(); }
  }));
  byId('retry-btn').addEventListener('click', () => void refresh());
  byId('affiliation').addEventListener('change', event => { draft = event.target.value; });
  byId('affiliation-form').addEventListener('submit', event => {
    event.preventDefault();void run(async () => {
      apply(await send('UNIBE_AFFILIATION', { affiliation: draft, scope: state.scope }));
      const result = await send('UNIBE_CONNECT', { scope: state.scope, affiliation: state.affiliation });state.user_name = result.user_name || state.user_name;
      if (result.confirmation) { confirmation = true;render(); }
      else { await send('UNIBE_ACTIVATE');await refreshAfterAction();feedback(t('unibe.connected_success')); }
    }).then(() => { if (confirmation) byId('confirm-btn').focus(); });
  });
  byId('confirm-btn').addEventListener('click', () => void run(async () => {
    await send('UNIBE_ACTIVATE');confirmation = false;await refreshAfterAction();feedback(t('unibe.connected_success'));
  }));
  byId('cancel-switch-btn').addEventListener('click', () => { confirmation = false;render();byId('affiliation').focus(); });
  byId('disconnect-btn').addEventListener('click', () => void run(async () => { apply(await send('UNIBE_DISCONNECT')); }));
  byId('open-app-btn').addEventListener('click', () => void run(async () => { await send('UNIBE_OPEN_APP'); }));
  byId('legacy-btn').addEventListener('click', () => void browserAPI.tabs.create({ url: browserAPI.runtime.getURL('legacy-popup.html') }));
  byId('settings-form').addEventListener('submit', event => {
    event.preventDefault();void run(async () => {
      await browserAPI.storage.local.set({ serverUrl: byId('server-url').value, frontendUrl: byId('frontend-url').value });
      confirmation = false;scope = null;state = { phase: 'checking' };await refreshAfterAction();feedback(t('Einstellungen gespeichert.'));
    });
  });
  browserAPI.runtime.onMessage.addListener(message => { if (message?.type === 'UNIBE_UPDATED') void refresh(); });
  window.addEventListener('focus', () => void refresh());
  window.addEventListener('pagehide', () => clearTimeout(timer));
  render();await refresh();
  if (fullPage && state.phase === 'disconnected') await run(async () => { apply(await send('UNIBE_LOGIN')); });
});
