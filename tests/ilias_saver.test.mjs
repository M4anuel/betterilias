import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for node environment
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

globalThis.localStorage = new MockLocalStorage();
globalThis.window = {
  dispatchEvent: () => true,
};

test('ILIAS Saver defaults and preference toggles', async () => {
  localStorage.clear();

  // Test ILIAS Saver enabled default
  assert.equal(localStorage.getItem('betterilias_saver_enabled'), null);

  // Toggle on
  localStorage.setItem('betterilias_saver_enabled', 'true');
  assert.equal(localStorage.getItem('betterilias_saver_enabled') === 'true', true);

  // Toggle off
  localStorage.setItem('betterilias_saver_enabled', 'false');
  assert.equal(localStorage.getItem('betterilias_saver_enabled') === 'true', false);
});

test('ILIAS Saver TTL calculation and freshness check', async () => {
  localStorage.clear();
  const CACHE_TS_PREFIX = 'ilias_ts_';
  const testKey = 'ilias_materials_cache_12345';

  const isFresh = (key, ttlMinutes = 5) => {
    const enabled = localStorage.getItem('betterilias_saver_enabled') === 'true';
    if (!enabled) return false;
    const rawTs = localStorage.getItem(`${CACHE_TS_PREFIX}${key}`);
    if (!rawTs) return false;
    const ts = parseInt(rawTs, 10);
    const ttlMs = ttlMinutes * 60 * 1000;
    return Date.now() - ts < ttlMs;
  };

  // When disabled, isFresh is always false even with recent timestamp
  localStorage.setItem(`${CACHE_TS_PREFIX}${testKey}`, String(Date.now()));
  assert.equal(isFresh(testKey), false);

  // When enabled with recent timestamp, isFresh is true
  localStorage.setItem('betterilias_saver_enabled', 'true');
  assert.equal(isFresh(testKey), true);

  // When timestamp is 6 minutes old and TTL is 5 minutes, isFresh is false
  const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
  localStorage.setItem(`${CACHE_TS_PREFIX}${testKey}`, String(sixMinutesAgo));
  assert.equal(isFresh(testKey, 5), false);

  // If TTL is increased to 10 minutes, the 6-minute-old cache is fresh again
  assert.equal(isFresh(testKey, 10), true);
});

test('Grading filter removal detection for modeless feedback bar', () => {
  const taGradeFilter = ['not_graded'];
  const isNotGradedFilter = taGradeFilter.includes('not_graded');

  // Ungraded submission: not filtered out
  const initialStatus = 'not_graded';
  const initialMark = '';
  assert.equal(isNotGradedFilter && ['passed', 'failed'].includes(initialStatus), false);

  // When saved as passed: detected as filtered out
  const savedStatus = 'passed';
  const savedMark = '5.5';
  const isNowGraded = ['passed', 'failed'].includes(savedStatus) || Boolean(savedMark && savedMark.trim());
  const wasFilteredOut = isNotGradedFilter && isNowGraded;
  assert.equal(wasFilteredOut, true);
});
