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

const CACHE_TS_PREFIX = 'ilias_ts_';
const MANAGEMENT_CACHE_PREFIX = 'ilias_management_';
const TA_ASSIGNMENTS_CACHE_PREFIX = 'ilias_ta_assignments_';
const ILIAS_SAVER_ENABLED_KEY = 'betterilias_saver_enabled';
const ILIAS_SAVER_TTL_KEY = 'betterilias_saver_ttl';

const cache = {
  getIliasSaverEnabled() {
    return localStorage.getItem(ILIAS_SAVER_ENABLED_KEY) === 'true';
  },
  setIliasSaverEnabled(enabled) {
    localStorage.setItem(ILIAS_SAVER_ENABLED_KEY, enabled ? 'true' : 'false');
  },
  getIliasSaverTtl() {
    const raw = localStorage.getItem(ILIAS_SAVER_TTL_KEY);
    return raw ? parseInt(raw, 10) : 5;
  },
  setCacheTimestamp(key, ts = Date.now()) {
    localStorage.setItem(`${CACHE_TS_PREFIX}${key}`, String(ts));
  },
  getCacheTimestamp(key) {
    const raw = localStorage.getItem(`${CACHE_TS_PREFIX}${key}`);
    return raw ? parseInt(raw, 10) : null;
  },
  isIliasSaverFresh(key) {
    if (!this.getIliasSaverEnabled()) return false;
    const ts = this.getCacheTimestamp(key);
    if (!ts) return false;
    const ttlMs = this.getIliasSaverTtl() * 60 * 1000;
    return Date.now() - ts < ttlMs;
  },

  getCachedManagement(refId) {
    const raw = localStorage.getItem(`${MANAGEMENT_CACHE_PREFIX}${refId}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedManagement(refId, data) {
    const key = `${MANAGEMENT_CACHE_PREFIX}${refId}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedManagement(refId) {
    localStorage.removeItem(`${MANAGEMENT_CACHE_PREFIX}${refId}`);
    localStorage.removeItem(`${CACHE_TS_PREFIX}${MANAGEMENT_CACHE_PREFIX}${refId}`);
  },

  getCachedTAAssignments(refId) {
    const raw = localStorage.getItem(`${TA_ASSIGNMENTS_CACHE_PREFIX}${refId}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedTAAssignments(refId, data) {
    const key = `${TA_ASSIGNMENTS_CACHE_PREFIX}${refId}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedTAAssignments(refId) {
    localStorage.removeItem(`${TA_ASSIGNMENTS_CACHE_PREFIX}${refId}`);
    localStorage.removeItem(`${CACHE_TS_PREFIX}${TA_ASSIGNMENTS_CACHE_PREFIX}${refId}`);
  },

  invalidateManagedMaterials(refIds) {
    for (const ref of refIds) {
      localStorage.removeItem(`ilias_materials_cache_${ref}`);
      localStorage.removeItem(`${CACHE_TS_PREFIX}ilias_materials_cache_${ref}`);
      localStorage.removeItem(`${MANAGEMENT_CACHE_PREFIX}${ref}`);
      localStorage.removeItem(`${CACHE_TS_PREFIX}${MANAGEMENT_CACHE_PREFIX}${ref}`);
    }
  },
};

test('Course management cache persistence and invalidation', () => {
  localStorage.clear();

  const refId = '44102';
  assert.equal(cache.getCachedManagement(refId), null);

  const managementData = {
    ref_id: refId,
    title: 'Prog 2 Vorlesung',
    can_create: true,
    can_manage: true,
    can_edit_page: true,
    order: ['item-1', 'item-2'],
    order_revision: 'rev_123',
    items: [{ ref_id: 'item-1', title: 'Folder 1' }],
  };

  cache.setCachedManagement(refId, managementData);
  const loaded = cache.getCachedManagement(refId);
  assert.notEqual(loaded, null);
  assert.equal(loaded.title, 'Prog 2 Vorlesung');
  assert.equal(loaded.order.length, 2);

  // Invalidation
  cache.invalidateCachedManagement(refId);
  assert.equal(cache.getCachedManagement(refId), null);
});

test('ILIAS Saver freshness behavior for management and TA cache', () => {
  localStorage.clear();
  const refId = '55100';
  const managementData = { ref_id: refId, title: 'Exam prep' };

  cache.setCachedManagement(refId, managementData);

  // ILIAS Saver off -> isIliasSaverFresh is false (SWR background revalidation triggers)
  assert.equal(cache.isIliasSaverFresh(`${MANAGEMENT_CACHE_PREFIX}${refId}`), false);

  // Turn ILIAS Saver ON
  cache.setIliasSaverEnabled(true);
  assert.equal(cache.isIliasSaverFresh(`${MANAGEMENT_CACHE_PREFIX}${refId}`), true);

  // Stale timestamp (> TTL)
  const oldTs = Date.now() - 10 * 60 * 1000; // 10 minutes ago
  cache.setCacheTimestamp(`${MANAGEMENT_CACHE_PREFIX}${refId}`, oldTs);
  assert.equal(cache.isIliasSaverFresh(`${MANAGEMENT_CACHE_PREFIX}${refId}`), false);
});

test('TA assignments list cache persistence', () => {
  localStorage.clear();
  const exerciseRefId = 'exc_770';

  assert.equal(cache.getCachedTAAssignments(exerciseRefId), null);

  const taData = {
    exercise_id: exerciseRefId,
    assignments: [
      { ass_id: 'ass-1', title: 'Übung 1', order_val: 10 },
      { ass_id: 'ass-2', title: 'Übung 2', order_val: 20 },
    ],
  };

  cache.setCachedTAAssignments(exerciseRefId, taData);
  const loaded = cache.getCachedTAAssignments(exerciseRefId);
  assert.notEqual(loaded, null);
  assert.equal(loaded.assignments.length, 2);

  cache.invalidateCachedTAAssignments(exerciseRefId);
  assert.equal(cache.getCachedTAAssignments(exerciseRefId), null);
});

test('invalidateManagedMaterials clears both materials and management caches', () => {
  localStorage.clear();
  const refId = 'course_999';

  cache.setCachedManagement(refId, { ref_id: refId });
  localStorage.setItem(`ilias_materials_cache_${refId}`, JSON.stringify({ container_ref_id: refId }));

  cache.invalidateManagedMaterials([refId]);

  assert.equal(cache.getCachedManagement(refId), null);
  assert.equal(localStorage.getItem(`ilias_materials_cache_${refId}`), null);
});

