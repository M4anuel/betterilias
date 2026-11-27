const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const { t, languages, getLanguage, setLanguage } = BetterIliasI18n;

document.addEventListener('DOMContentLoaded', async () => {
  const byId = id => document.getElementById(id);
  let state = { phase: 'checking' }, busy = false, draft = '', scope = null, expiry, poll, savedTimer, confirmation = false, warningText = '', unverified = true;
  let saved = await browserAPI.storage.local.get(['serverUrl','frontendUrl','language','authMethod','autoSyncEnabled']);
  saved = { serverUrl: 'http://localhost:8000', frontendUrl: 'http://localhost:5173', authMethod: 'unibe', ...saved };
  const sessionStorage = browserAPI.storage.session;
  const pending = sessionStorage ? (await sessionStorage.get(['companionSettingsDraft'])).companionSettingsDraft : null;
  const values = pending || saved;
  byId('server-url').value = values.serverUrl;byId('frontend-url').value = values.frontendUrl;
  byId('legacy-mode').checked = values.authMethod === 'legacy';
  const legacy = () => byId('legacy-mode').checked;
  const settings = () => ({ serverUrl: byId('server-url').value.trim(), frontendUrl: byId('frontend-url').value.trim(), authMethod: legacy() ? 'legacy' : 'unibe' });
  const changed = () => Object.entries(settings()).some(([key,value]) => value !== saved[key]);
  function settingsState(success = false) {
    const dirty = changed(), button = byId('save-settings');
    button.classList.toggle('dirty', dirty);button.classList.toggle('saved', success && !dirty);
    byId('save-label').textContent = t(success && !dirty ? 'companion.saved' : 'Einstellungen speichern');
    byId('save-status').textContent = dirty ? t('companion.unsaved') : '';
    for (const [id,server,frontend] of [['preset-online','https://betterilias.ch','https://betterilias.ch'],['preset-local','http://'+'localhost:8000','http://'+'localhost:5173']])
      byId(id).setAttribute('aria-pressed', String(settings().serverUrl === server && settings().frontendUrl === frontend));
  }
  async function send(type, extra = {}) {
    const reply = await browserAPI.runtime.sendMessage({ type, ...extra });
    if (!reply?.success) {
      const error = new Error(t(reply?.code === 'rejected' ? 'unisport.login_failed' : reply?.code === 'context' ? 'unisport.ilias_context_changed' : reply?.code === 'unreachable' ? 'companion.backend_warning' : 'companion.check_failed'));
      error.connection = !['rejected','context','affiliation'].includes(reply?.code);throw error;
    }
    return reply.data;
  }
  function warning(message) { warningText=message || '';byId('backend-warning').hidden = !warningText;byId('warning-message').textContent = warningText; }
  function feedback(message, error = false) {
    byId('feedback-box').textContent = message;
    byId('feedback-box').className = 'feedback visible ' + (error ? 'error' : 'success');
    byId('feedback-box').setAttribute('role',error ? 'alert' : 'status');
  }
  function render() {
    document.documentElement.lang = getLanguage();
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label',t(node.dataset.i18nAria)));
    byId('language').value = getLanguage();
    const connected = state.phase === 'connected', pending = ['pending','exchanging'].includes(state.phase);
    byId('account-heading').textContent = t(legacy() ? 'companion.legacy_title' : 'companion.switch');
    byId('account-state').textContent = t(busy && state.phase === 'checking' ? 'Prüfe...' : unverified ? 'companion.unknown' : connected ? 'companion.signed_in' : pending ? 'unisport.waiting' : 'Nicht angemeldet');
    byId('account-state').className = 'status-badge ' + (connected ? 'badge-success' : 'badge-warning');
    byId('account-name').textContent = !legacy() && connected ? state.user_name || '' : '';
    byId('login-btn').hidden = legacy() || connected || pending || state.phase === 'unsupported';
    byId('legacy-action').hidden = !legacy() || !['connected','disconnected'].includes(state.phase);
    byId('legacy-action').textContent = t(connected ? 'Sitzung mit BetterIlias synchronisieren' : 'Bei ILIAS anmelden');
    byId('auto-sync-info').hidden = !legacy() || !connected;
    byId('auto-sync-info').textContent=t(saved.autoSyncEnabled===false ? 'companion.auto_sync_off' : 'companion.auto_sync_on');
    byId('affiliation-form').hidden = legacy() || !connected || confirmation;
    byId('disconnect-btn').hidden = !(connected || pending);
    byId('confirm-switch').hidden = !confirmation;
    byId('confirm-message').textContent = t('unisport.ilias_replace_confirm',{name:state.user_name || t('Benutzer')});
    const select = byId('affiliation'), choices = state.affiliations || [];
    if (select.dataset.choices !== JSON.stringify([getLanguage(),choices])) {
      select.replaceChildren();
      for (const value of ['',...choices]) { const option = document.createElement('option');option.value=value;option.textContent=value ? value.slice(value.lastIndexOf('@')+1) : t('unisport.choose_affiliation');select.append(option); }
      select.dataset.choices=JSON.stringify([getLanguage(),choices]);
    }
    select.value = draft;
    for (const node of document.querySelectorAll('button,select,input')) node.disabled = busy;
    for(const id of ['login-btn','legacy-action','connect-btn','affiliation','confirm-btn']) byId(id).disabled=busy || unverified || Boolean(warningText);
    byId('connect-btn').textContent = t(busy ? 'Synchronisiere...' : 'unibe.connect');
    settingsState();
  }
  async function apply(next) {
    if (next.scope !== scope) {
      scope = next.scope || null;draft = next.affiliation || next.affiliations?.find(value=>value.slice(value.lastIndexOf('@')+1).toLowerCase()==='unibe.ch') || '';confirmation=false;
      if (scope && sessionStorage) { const row = (await sessionStorage.get('companionAffiliationDraft')).companionAffiliationDraft; if (row?.scope === scope) draft=row.value; }
    }
    if (draft && !next.affiliations?.includes(draft)) draft=next.affiliation || '';
    state=next;unverified=false;render();clearTimeout(expiry);clearTimeout(poll);
    if (next.phase==='connected' && Number.isFinite(next.expires_at)) expiry=setTimeout(() => { state={phase:'disconnected',usage_retention_days:state.usage_retention_days};confirmation=false;render(); },Math.max(0,next.expires_at*1000-Date.now()));
    else if (['pending','exchanging'].includes(next.phase)) poll=setTimeout(() => void refresh(),2000);
  }
  async function run(action) {
    if (busy) return;
    busy=true;render();byId('feedback-box').className='feedback';
    try { await action(); }
    catch (error) { if (error.connection) warning(error.message);else feedback(error.message || t('companion.check_failed'),true); }
    finally { busy=false;render(); }
  }
  async function refresh() {
    await run(async () => {
      try {
        const next = legacy() ? await BetterIliasLegacy.check(saved.serverUrl,saved.frontendUrl,getLanguage()) : await send('UNIBE_STATUS');
        if(!['connected','disconnected','pending','exchanging','unsupported'].includes(next?.phase))throw new Error('invalid_status');
        await apply(next);warning(next.phase==='unsupported' ? t('unibe.unsupported') : null);
      } catch (error) { unverified=true;if(state.phase==='checking')state={phase:'disconnected'};if(!error.connection)error.message=t('companion.backend_warning');error.connection=true;throw error; }
    });
  }
  for (const [code,definition] of Object.entries(languages)) { const option=document.createElement('option');option.value=code;option.textContent=definition.name;byId('language').append(option); }
  const initial=await browserAPI.runtime.sendMessage({type:'COMPANION_LANGUAGE_INIT'}).catch(() => null);
  if (initial?.language || saved.language) setLanguage(initial?.language || saved.language);
  byId('language').addEventListener('change',async event => {
    setLanguage(event.target.value);render();
    const reply=await browserAPI.runtime.sendMessage({type:'COMPANION_LANGUAGE_SET',language:getLanguage()}).catch(() => null);
    if (!reply?.language) await browserAPI.storage.local.set({language:getLanguage()});
  });
  browserAPI.storage.onChanged?.addListener((changes,area) => {
    if(area==='local' && changes.autoSyncEnabled) { saved.autoSyncEnabled=changes.autoSyncEnabled.newValue;render(); }
    if (area==='local' && changes.language?.newValue && Object.hasOwn(languages,changes.language.newValue)) { setLanguage(changes.language.newValue);render(); }
  });
  byId('login-btn').addEventListener('click',() => void run(async () => { await apply(await send('UNIBE_LOGIN')); }));
  byId('retry-btn').addEventListener('click',() => void refresh());
  byId('legacy-action').addEventListener('click',() => void run(async () => {
    if (state.phase==='connected') await apply(await BetterIliasLegacy.check(saved.serverUrl,saved.frontendUrl,getLanguage(),true));
    else { await browserAPI.storage.local.set({logoutPaused:false,autoSyncEnabled:true});const tab=(await browserAPI.tabs.query({})).find(tab=>tab.url?.startsWith('https://ilias.unibe.ch/')); if(tab)await browserAPI.tabs.update(tab.id,{active:true});else await browserAPI.tabs.create({url:'https://ilias.unibe.ch/'}); }
  }));
  byId('affiliation').addEventListener('change',async event => { draft=event.target.value;if(sessionStorage)await sessionStorage.set({companionAffiliationDraft:{scope,value:draft}}); });
  byId('affiliation-form').addEventListener('submit',event => {
    event.preventDefault();void run(async () => {
      await apply(await send('UNIBE_AFFILIATION',{affiliation:draft,scope:state.scope}));
      const result=await send('UNIBE_CONNECT',{scope:state.scope,affiliation:state.affiliation});
      state.user_name=result.user_name || state.user_name;
      if (result.confirmation) { confirmation=true; }
      else { await send('UNIBE_ACTIVATE');await apply(await send('UNIBE_STATUS'));feedback(t('unibe.connected_success')); }
    }).then(() => { if(confirmation)byId('confirm-btn').focus(); });
  });
  byId('confirm-btn').addEventListener('click',() => void run(async () => { await send('UNIBE_ACTIVATE');confirmation=false;await apply(await send('UNIBE_STATUS'));feedback(t('unibe.connected_success')); }));
  byId('cancel-switch-btn').addEventListener('click',() => { confirmation=false;render();byId('affiliation').focus(); });
  byId('disconnect-btn').addEventListener('click',() => void run(async () => {
    const result=await send('UNIBE_LOGOUT',{authMethod:legacy()?'legacy':'unibe'});await apply(result);warning(null);
    feedback(t(result.native_logout_confirmed===false ? 'companion.logout_partial' : 'companion.logged_out'),result.native_logout_confirmed===false);
  }));
  byId('open-app-btn').addEventListener('click',() => void run(async () => { await send('UNIBE_OPEN_APP'); }));
  async function edit() { clearTimeout(savedTimer);settingsState();if(sessionStorage)await sessionStorage.set({companionSettingsDraft:settings()}); }
  for(const id of ['server-url','frontend-url']) byId(id).addEventListener('input',() => void edit());
  byId('legacy-mode').addEventListener('change',() => { void edit();confirmation=false;state={phase:'checking'};render();void refresh(); });
  for(const [id,server,frontend] of [['preset-online','https://betterilias.ch','https://betterilias.ch'],['preset-local','http://'+'localhost:8000','http://'+'localhost:5173']])
    byId(id).addEventListener('click',() => { byId('server-url').value=server;byId('frontend-url').value=frontend;void edit(); });
  byId('settings-form').addEventListener('submit',event => {
    event.preventDefault();void (async () => {
      const next=settings();
      for(const value of [next.serverUrl,next.frontendUrl]) { const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))) { feedback(t('companion.check_failed'),true);return; } }
      await browserAPI.storage.local.set(next);saved=next;
      if(sessionStorage)await sessionStorage.remove('companionSettingsDraft');
      confirmation=false;scope=null;await refresh();settingsState(true);
      savedTimer=setTimeout(() => settingsState(),1400);
    })().catch(() => feedback(t('companion.check_failed'),true));
  });
  browserAPI.runtime.onMessage.addListener(message => { if(message?.type==='UNIBE_UPDATED')void refresh(); });
  window.addEventListener('focus',() => void refresh());
  window.addEventListener('pagehide',() => {clearTimeout(expiry);clearTimeout(poll);clearTimeout(savedTimer);});
  render();await refresh();
});
