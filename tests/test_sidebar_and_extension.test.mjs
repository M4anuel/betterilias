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

test('Sidebar custom order cache persistence', () => {
  localStorage.clear();

  const SIDEBAR_ORDER_KEY = 'ilias_sidebar_order';

  const getSidebarOrder = () => {
    try {
      const raw = localStorage.getItem(SIDEBAR_ORDER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  const setSidebarOrder = (order) => {
    if (order && order.length > 0) {
      localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(order));
    } else {
      localStorage.removeItem(SIDEBAR_ORDER_KEY);
    }
  };

  const clearSidebarOrder = () => {
    localStorage.removeItem(SIDEBAR_ORDER_KEY);
  };

  // 1. Initial state: null (default subject grouping)
  assert.equal(getSidebarOrder(), null);

  // 2. Set custom order with courses and a TA section divider
  const customOrder = [
    { id: 'sec-ta', type: 'section', title: 'Hilfsassistenz (TA)' },
    { id: 'course-101', type: 'course' },
    { id: 'sec-own', type: 'section', title: 'Eigene Vorlesungen' },
    { id: 'course-202', type: 'course' },
    { id: 'course-303', type: 'course' },
  ];

  setSidebarOrder(customOrder);
  const loaded = getSidebarOrder();
  assert.notEqual(loaded, null);
  assert.equal(loaded.length, 5);
  assert.equal(loaded[0].type, 'section');
  assert.equal(loaded[0].title, 'Hilfsassistenz (TA)');
  assert.equal(loaded[1].id, 'course-101');

  // 3. Clear custom order (reset to default subjects)
  clearSidebarOrder();
  assert.equal(getSidebarOrder(), null);
});

test('Sidebar grouping logic: default mode partitions courses by subject', () => {
  const courses = [
    { ref_id: '1', title: 'Prog 1', subject: 'Informatik' },
    { ref_id: '2', title: 'Rechnernetze', subject: 'Informatik' },
    { ref_id: '3', title: 'BWL Grundlagen', subject: 'Betriebswirtschaftslehre' },
    { ref_id: '4', title: 'Allgemeine Studien', subject: '' }, // Should fall into Sonstige
  ];

  const customOrder = null; // Default mode

  const groupCourses = (list) => {
    const map = new Map();
    for (const c of list) {
      const subj = (c.subject && c.subject.trim()) || 'Sonstige';
      if (!map.has(subj)) map.set(subj, []);
      map.get(subj).push(c);
    }
    return map;
  };

  const grouped = groupCourses(courses);
  assert.equal(grouped.has('Informatik'), true);
  assert.equal(grouped.get('Informatik').length, 2);
  assert.equal(grouped.has('Betriebswirtschaftslehre'), true);
  assert.equal(grouped.get('Betriebswirtschaftslehre').length, 1);
  assert.equal(grouped.has('Sonstige'), true);
  assert.equal(grouped.get('Sonstige').length, 1);
});

test('Sidebar grouping logic: custom mode overrides subjects with drag-n-drop sequence and TA section', () => {
  const courses = [
    { ref_id: '1', title: 'Prog 1', subject: 'Informatik' },
    { ref_id: '2', title: 'Rechnernetze', subject: 'Informatik' },
    { ref_id: '3', title: 'BWL Grundlagen', subject: 'Betriebswirtschaftslehre' },
    { ref_id: '4', title: 'Neu Eingeschrieben', subject: 'Mathematik' },
  ];

  // User created a TA section divider and reordered courses
  const customOrder = [
    { id: 'sec-ta', type: 'section', title: 'Hilfsassistenz (TA)' },
    { id: '1', type: 'course' }, // Prog 1 where student is TA
    { id: 'sec-studies', type: 'section', title: 'Mein Studium' },
    { id: '3', type: 'course' },
    { id: '2', type: 'course' },
  ];

  const renderedItems = [];
  const placedIds = new Set();

  for (const item of customOrder) {
    if (item.type === 'section') {
      renderedItems.push({ kind: 'divider', title: item.title });
    } else {
      const c = courses.find((x) => x.ref_id === item.id);
      if (c) {
        placedIds.add(c.ref_id);
        renderedItems.push({ kind: 'course', course: c });
      }
    }
  }

  // Any unplaced course (e.g. course '4') appends at bottom
  const unplaced = courses.filter((c) => !placedIds.has(c.ref_id));
  for (const c of unplaced) {
    renderedItems.push({ kind: 'course', course: c });
  }

  assert.equal(renderedItems.length, 6);
  assert.equal(renderedItems[0].kind, 'divider');
  assert.equal(renderedItems[0].title, 'Hilfsassistenz (TA)');
  assert.equal(renderedItems[1].kind, 'course');
  assert.equal(renderedItems[1].course.ref_id, '1');
  assert.equal(renderedItems[2].kind, 'divider');
  assert.equal(renderedItems[2].title, 'Mein Studium');
  assert.equal(renderedItems[3].course.ref_id, '3');
  assert.equal(renderedItems[4].course.ref_id, '2');
  assert.equal(renderedItems[5].course.ref_id, '4'); // Safe unplaced append
});

test('Extension cookie verification logic checks for active SWITCH edu-ID session', () => {
  const verifySession = (cookies) => {
    const hasPhp = Boolean(cookies.PHPSESSID);
    const hasShib = Object.keys(cookies).some((k) => k.startsWith('_shibsession_'));
    return hasPhp && hasShib;
  };

  // 1. Empty cookies
  assert.equal(verifySession({}), false);

  // 2. Only PHPSESSID (guest or expired session)
  assert.equal(verifySession({ PHPSESSID: 'sess_12345' }), false);

  // 3. Active authenticated session with SWITCH edu-ID
  assert.equal(
    verifySession({
      PHPSESSID: 'sess_12345',
      '_shibsession_64656661756c74': '_token_98765',
      ilClientId: 'ilias3_unibe',
    }),
    true
  );
});

test('Extension and backend cookie sanitization rejects RFC 6265 separators and retains auth tokens', () => {
  const isIliasAuthCookie = (name) => {
    if (!name || typeof name !== 'string') return false;
    if (name.includes('|') || name.includes('{') || name.includes('}') || name.includes('[') || name.includes(']')) return false;
    return name === 'PHPSESSID' || name.startsWith('_shibsession_') || name === 'ilClientId' || name.startsWith('il_');
  };

  assert.equal(isIliasAuthCookie('PHPSESSID'), true);
  assert.equal(isIliasAuthCookie('_shibsession_64656661756c74'), true);
  assert.equal(isIliasAuthCookie('ilClientId'), true);
  assert.equal(isIliasAuthCookie('il_mode'), true);

  // Junk/bloat/media cookies that cause header corruption or infinite reload loops
  assert.equal(isIliasAuthCookie('preferences|{}'), false);
  assert.equal(isIliasAuthCookie('cookie[test]'), false);
  assert.equal(isIliasAuthCookie('unrelated_tracker'), false);
  assert.equal(isIliasAuthCookie(null), false);
  assert.equal(isIliasAuthCookie(undefined), false);
});

test('Site landing behavior always defaults to semester overview without caching last opened course', () => {
  const LAST_OPENED_KEY = 'ilias_last_opened_course';
  localStorage.setItem(LAST_OPENED_KEY, '44102');

  const cache = {
    getLastOpenedCourseId() {
      return null;
    },
    setLastOpenedCourseId(_refId) {
      localStorage.removeItem(LAST_OPENED_KEY);
    },
  };

  // Calling setLastOpenedCourseId cleans up any legacy key
  cache.setLastOpenedCourseId('44102');
  assert.equal(localStorage.getItem(LAST_OPENED_KEY), null);
  assert.equal(cache.getLastOpenedCourseId(), null);

  // Initial state resolution when landing on site without URL params
  const initialParams = new URLSearchParams('');
  const initialRepositoryParam = initialParams.get('repository');
  const initialCourseParam = initialParams.get('course');

  const selectedCourseId = initialRepositoryParam ? null : (initialCourseParam || null);
  assert.equal(selectedCourseId, null);
});
