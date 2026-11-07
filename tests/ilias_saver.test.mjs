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

test('My Courses caching and ILIAS Saver freshness lifecycle', () => {
  localStorage.clear();
  const scope = 'tenant_123';
  localStorage.setItem('betterilias_session_id', scope);
  const key = `ilias_my_courses_cache_${scope}`;
  const tsKey = `ilias_ts_${key}`;

  const mockCourses = [
    { ref_id: '101', title: 'Lineare Algebra', item_type: 'crs', semester: 'HS2026' },
    { ref_id: '102', title: 'Übungsgruppe 1', item_type: 'grp', semester: 'HS2026' }
  ];

  // Helper mock mimicking cache.setCachedMyCourses
  const setCached = (courses, force = false) => {
    const raw = localStorage.getItem(key);
    const existing = raw ? JSON.parse(raw) : null;
    if (!force && existing && existing.length > 0 && (!courses || courses.length === 0)) {
      return; // prevent overwrite
    }
    localStorage.setItem(key, JSON.stringify(courses));
    localStorage.setItem(tsKey, String(Date.now()));
  };

  const getCached = () => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  };

  const isFresh = (ttlMinutes = 5) => {
    const enabled = localStorage.getItem('betterilias_saver_enabled') === 'true';
    if (!enabled) return false;
    const rawTs = localStorage.getItem(tsKey);
    if (!rawTs) return false;
    return Date.now() - parseInt(rawTs, 10) < ttlMinutes * 60 * 1000;
  };

  // Initially empty
  assert.equal(getCached(), null);
  assert.equal(isFresh(), false);

  // Cache courses
  setCached(mockCourses);
  assert.deepEqual(getCached(), mockCourses);

  // Freshness check with saver disabled
  assert.equal(isFresh(), false);

  // Enable ILIAS Saver
  localStorage.setItem('betterilias_saver_enabled', 'true');
  assert.equal(isFresh(), true);

  // Empty response without force does not wipe populated cache
  setCached([]);
  assert.deepEqual(getCached(), mockCourses);

  // Explicit user refresh (force = true) allows clearing/updating
  setCached([], true);
  assert.deepEqual(getCached(), []);

  // Invalidate cache
  localStorage.removeItem(key);
  localStorage.removeItem(tsKey);
  assert.equal(getCached(), null);
  assert.equal(isFresh(), false);
});
