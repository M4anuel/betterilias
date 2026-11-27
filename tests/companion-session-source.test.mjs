import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const browser of ['chrome', 'firefox']) {
  test(`${browser}: token connection survives cached/automatic sync; manual sync selects browser cookies`, async () => {
    const values = new Map([['betterilias_ilias_source', 'unisport'], ['betterilias_session_id', 'token-session']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const messageListeners = [], storageListeners = [], events = [];
    const page = { localStorage: storage, location: { origin: 'http://localhost:5173' },
      addEventListener() {}, postMessage: message => events.push(message) };
    if (browser === 'firefox') page.wrappedJSObject = { localStorage: storage };
    const api = { storage: {
      local: { get: async () => ({ sessionId: 'cached-browser-session' }) },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    }, runtime: {
      onMessage: { addListener: listener => messageListeners.push(listener) },
      sendMessage: async () => ({ sessionId: 'automatic-browser-session' }),
    } };
    const context = vm.createContext({ window: page, location: page.location, URL, console,
      chrome: api, ...(browser === 'firefox' ? { browser: api } : {}),
      document: { addEventListener() {}, dispatchEvent() {}, documentElement: { lang: 'en' } }, CustomEvent: class {}, cloneInto: value => value });
    vm.runInContext(fs.readFileSync(new URL(`../extensions/${browser}/content.js`, import.meta.url), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(values.get('betterilias_session_id'), 'token-session');
    for (const listener of storageListeners) listener({ sessionId: { newValue: 'changed-browser-session' } }, 'local');
    for (const listener of messageListeners) listener({ type: 'BETTERILIAS_SESSION_SYNCED', sessionId: 'notified-browser-session' }, {}, () => {});
    assert.equal(values.get('betterilias_session_id'), 'token-session');
    assert.ok(!events.some(event => event.type === 'BETTERILIAS_SESSION_SYNCED'));
    for (const listener of messageListeners) listener({ type: 'BETTERILIAS_SESSION_SYNCED', sessionId: 'manually-selected-session', manual: true }, {}, () => {});
    assert.equal(values.get('betterilias_ilias_source'), undefined);
    assert.equal(values.get('betterilias_session_id'), 'manually-selected-session');
    assert.ok(events.some(event => event.type === 'BETTERILIAS_SESSION_SYNCED' && event.sessionId === 'manually-selected-session'));
  });
}
