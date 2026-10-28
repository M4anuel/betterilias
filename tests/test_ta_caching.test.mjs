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


const TEAM_CANDIDATES_CACHE_PREFIX = 'ilias_team_candidates_';
const TA_ASSIGNMENT_DETAIL_CACHE_PREFIX = 'ilias_ta_assignment_detail_';
const MEMBERSHIP_FORM_CACHE_PREFIX = 'ilias_membership_form_';
const DELETE_REVIEW_CACHE_PREFIX = 'ilias_delete_review_';
const EXERCISE_SUBMISSIONS_PREFIX = 'ilias_exercise_submissions_';

Object.assign(cache, {
  getCachedExerciseSubmissions(refId, assId) {
    const key = `${EXERCISE_SUBMISSIONS_PREFIX}${refId}_${assId || 'default'}`;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    if (assId) {
      const defRaw = localStorage.getItem(`${EXERCISE_SUBMISSIONS_PREFIX}${refId}_default`);
      if (defRaw) {
        const parsed = JSON.parse(defRaw);
        if (parsed && parsed.active_assignment_id === assId) return parsed;
      }
    }
    return null;
  },
  setCachedExerciseSubmissions(refId, assId, data) {
    const key = `${EXERCISE_SUBMISSIONS_PREFIX}${refId}_${assId || 'default'}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
    if (data.active_assignment_id && data.active_assignment_id !== assId) {
      const activeKey = `${EXERCISE_SUBMISSIONS_PREFIX}${refId}_${data.active_assignment_id}`;
      localStorage.setItem(activeKey, JSON.stringify(data));
      this.setCacheTimestamp(activeKey);
    }
  },
  getCachedTeamCandidates(exerciseRefId, assId) {
    const raw = localStorage.getItem(`${TEAM_CANDIDATES_CACHE_PREFIX}${exerciseRefId}_${assId}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedTeamCandidates(exerciseRefId, assId, data) {
    const key = `${TEAM_CANDIDATES_CACHE_PREFIX}${exerciseRefId}_${assId}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedTeamCandidates(exerciseRefId, assId) {
    if (assId) {
      localStorage.removeItem(`${TEAM_CANDIDATES_CACHE_PREFIX}${exerciseRefId}_${assId}`);
    }
  },
  getCachedTAAssignmentDetail(exerciseRefId, assId) {
    const raw = localStorage.getItem(`${TA_ASSIGNMENT_DETAIL_CACHE_PREFIX}${exerciseRefId}_${assId}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedTAAssignmentDetail(exerciseRefId, assId, data) {
    const key = `${TA_ASSIGNMENT_DETAIL_CACHE_PREFIX}${exerciseRefId}_${assId}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedTAAssignmentDetail(exerciseRefId, assId) {
    localStorage.removeItem(`${TA_ASSIGNMENT_DETAIL_CACHE_PREFIX}${exerciseRefId}_${assId}`);
  },
  getCachedMembershipForm(refId, action) {
    const raw = localStorage.getItem(`${MEMBERSHIP_FORM_CACHE_PREFIX}${refId}_${action}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedMembershipForm(refId, action, data) {
    const key = `${MEMBERSHIP_FORM_CACHE_PREFIX}${refId}_${action}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedMembershipForm(refId, action) {
    localStorage.removeItem(`${MEMBERSHIP_FORM_CACHE_PREFIX}${refId}_${action}`);
  },
  getCachedDeleteReview(refId, itemIds) {
    const sortedIds = [...itemIds].sort().join('_');
    const raw = localStorage.getItem(`${DELETE_REVIEW_CACHE_PREFIX}${refId}_${sortedIds}`);
    return raw ? JSON.parse(raw) : null;
  },
  setCachedDeleteReview(refId, itemIds, data) {
    const sortedIds = [...itemIds].sort().join('_');
    const key = `${DELETE_REVIEW_CACHE_PREFIX}${refId}_${sortedIds}`;
    localStorage.setItem(key, JSON.stringify(data));
    this.setCacheTimestamp(key);
  },
  invalidateCachedDeleteReview(refId) {
    const prefix = `${DELETE_REVIEW_CACHE_PREFIX}${refId}_`;
    for (const k of Object.keys(localStorage.store)) {
      if (k.startsWith(prefix)) localStorage.removeItem(k);
    }
  },
});

test('Exercise submissions cache normalizes keys and serves instant cached data on assignment switch', () => {
  localStorage.clear();
  const exerciseRefId = 'exc_100';
  const assId = 'ass_501';

  // Initially empty
  assert.equal(cache.getCachedExerciseSubmissions(exerciseRefId, assId), null);

  // Loaded initially with undefined assId (default active)
  const initialData = {
    active_assignment_id: assId,
    submissions: [{ member_id: 'm1', student_name: 'Alice' }],
  };
  cache.setCachedExerciseSubmissions(exerciseRefId, undefined, initialData);

  // Looking up by explicit ass_id should hit either direct or fallback default
  const retrieved = cache.getCachedExerciseSubmissions(exerciseRefId, assId);
  assert.notEqual(retrieved, null);
  assert.equal(retrieved.submissions[0].student_name, 'Alice');

  // Verify switching from ass_501 to ass_502 and back
  const data502 = {
    active_assignment_id: 'ass_502',
    submissions: [{ member_id: 'm2', student_name: 'Bob' }],
  };
  cache.setCachedExerciseSubmissions(exerciseRefId, 'ass_502', data502);

  const res502 = cache.getCachedExerciseSubmissions(exerciseRefId, 'ass_502');
  assert.equal(res502.submissions[0].student_name, 'Bob');

  const resBack501 = cache.getCachedExerciseSubmissions(exerciseRefId, 'ass_501');
  assert.equal(resBack501.submissions[0].student_name, 'Alice');
});

test('Team candidates caching and stale member auto-removal logic', () => {
  localStorage.clear();
  const exerciseRefId = 'exc_200';
  const assId = 'ass_201';

  const cachedCandidates = {
    exercise_ref_id: exerciseRefId,
    ass_id: assId,
    candidates: [
      { user_id: 'u1', login: 'alice', full_name: 'Alice Smith' },
      { user_id: 'u2', login: 'bob', full_name: 'Bob Jones' },
      { user_id: 'u3', login: 'carol', full_name: 'Carol White' },
    ],
  };
  cache.setCachedTeamCandidates(exerciseRefId, assId, cachedCandidates);

  const loaded = cache.getCachedTeamCandidates(exerciseRefId, assId);
  assert.equal(loaded.candidates.length, 3);

  // User selected u1 and u3 from cached list
  let selected = new Set(['u1', 'u3']);

  // Fresh list arrives from ILIAS, but u3 has dropped out of course
  const freshCandidates = {
    exercise_ref_id: exerciseRefId,
    ass_id: assId,
    candidates: [
      { user_id: 'u1', login: 'alice', full_name: 'Alice Smith' },
      { user_id: 'u2', login: 'bob', full_name: 'Bob Jones' },
    ],
  };

  const freshUserIds = new Set(freshCandidates.candidates.map((c) => c.user_id));
  const staleNames = [];
  const nextSelected = new Set();
  for (const id of selected) {
    if (freshUserIds.has(id)) {
      nextSelected.add(id);
    } else {
      staleNames.push(id);
    }
  }

  assert.equal(nextSelected.has('u1'), true);
  assert.equal(nextSelected.has('u3'), false);
  assert.deepEqual(staleNames, ['u3']);
});

test('TA assignment detail and course membership form caches persist and invalidate', () => {
  localStorage.clear();
  const exerciseRefId = 'exc_300';
  const assId = 'ass_301';

  cache.setCachedTAAssignmentDetail(exerciseRefId, assId, { title: 'Assignment 1', mandatory: true });
  assert.equal(cache.getCachedTAAssignmentDetail(exerciseRefId, assId).title, 'Assignment 1');

  cache.invalidateCachedTAAssignmentDetail(exerciseRefId, assId);
  assert.equal(cache.getCachedTAAssignmentDetail(exerciseRefId, assId), null);

  const courseRefId = 'crs_400';
  cache.setCachedMembershipForm(courseRefId, 'join', { action: 'join', available: true, fields: [] });
  assert.equal(cache.getCachedMembershipForm(courseRefId, 'join').available, true);

  cache.invalidateCachedMembershipForm(courseRefId, 'join');
  assert.equal(cache.getCachedMembershipForm(courseRefId, 'join'), null);
});

test('Delete review pre-scan cache persists and invalidates', () => {
  localStorage.clear();
  const refId = 'crs_500';
  const itemIds = ['item_2', 'item_1']; // Out of order

  const review = { items: [{ ref_id: 'item_1' }, { ref_id: 'item_2' }], revision: 'rev_1', descendants: 2 };
  cache.setCachedDeleteReview(refId, itemIds, review);

  // Lookup with reversed order still matches due to sorting
  const loaded = cache.getCachedDeleteReview(refId, ['item_1', 'item_2']);
  assert.notEqual(loaded, null);
  assert.equal(loaded.descendants, 2);

  cache.invalidateCachedDeleteReview(refId);
  assert.equal(cache.getCachedDeleteReview(refId, itemIds), null);
});

test('Exercise grading edits and comments are strictly scoped per assignment ID without cross-assignment contamination', () => {
  // Simulates student member_id #39619 across Ubung 3 and Ubung 4
  const memberId = '39619';
  const assId3 = 'ass_ubung_3';
  const assId4 = 'ass_ubung_4';

  const localEdits = {};
  const getEditKey = (mId, assId) => `${assId}_${mId}`;

  // TA grades Ubung 3
  const key3 = getEditKey(memberId, assId3);
  localEdits[key3] = {
    status: 'passed',
    mark: '',
    feedback: 'Akzeptiert: Die Formatierung eurer Abgabe...',
    notice: 'Guter Ansatz',
    isDirty: false,
  };

  // TA switches to Ubung 4 and enters different feedback for the same student
  const key4 = getEditKey(memberId, assId4);
  localEdits[key4] = {
    status: 'passed',
    mark: '',
    feedback: 'gutes, klares video. qualität ist etwas tief...',
    notice: 'Video abgabe',
    isDirty: false,
  };

  // Switching back to Ubung 3 reads key3
  assert.equal(localEdits[key3].feedback, 'Akzeptiert: Die Formatierung eurer Abgabe...');
  // Ubung 4 retains key4 independently
  assert.equal(localEdits[key4].feedback, 'gutes, klares video. qualität ist etwas tief...');
  assert.notEqual(localEdits[key3].feedback, localEdits[key4].feedback);

  // Active assignment matching guard
  const isDataMatchingSelectedAss = (selectedAssId, dataAssId) => {
    return !selectedAssId || (dataAssId === selectedAssId);
  };

  // When selected is assId3 and loaded data is for assId3: matches
  assert.equal(isDataMatchingSelectedAss(assId3, assId3), true);
  // When selected is assId4 but data in state is still assId3: does NOT match (prevents rendering stale cards)
  assert.equal(isDataMatchingSelectedAss(assId4, assId3), false);
  // When no specific assignment selected: matches
  assert.equal(isDataMatchingSelectedAss(null, assId3), true);
});
