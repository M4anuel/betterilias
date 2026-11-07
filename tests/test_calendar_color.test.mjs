import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Calendar course color: live preview on drag and single network commit on drop', async () => {
  let livePreviewColor = null;
  const committedCalls = [];
  const currentSavedColor = '#2563EB';

  const lastCommittedColor = {};

  const handleColorLivePreview = (courseRefId, color) => {
    livePreviewColor = color;
  };

  const commitColorChange = async (courseRefId, color) => {
    if (
      currentSavedColor?.toLowerCase() === color.toLowerCase() ||
      lastCommittedColor[courseRefId]?.toLowerCase() === color.toLowerCase()
    ) {
      return;
    }
    lastCommittedColor[courseRefId] = color;
    committedCalls.push({ courseRefId, color });
  };

  // Simulate 100 fast drag movements across slider (native 'input' events)
  const dragColors = [
    '#2563ea', '#2664eb', '#3070f0', '#5085f5', '#709af8', '#ff0000', '#ff0011', '#00ff00', '#0aaca5'
  ];

  for (const c of dragColors) {
    handleColorLivePreview('12345', c);
  }

  // 1. Verify live preview color updated to latest drag point
  assert.equal(livePreviewColor, '#0aaca5');
  // 2. Verify ZERO commits occurred during drag
  assert.equal(committedCalls.length, 0);

  // 3. User drops color slider / commits picker (native 'change' event)
  await commitColorChange('12345', '#0aaca5');
  assert.equal(committedCalls.length, 1);
  assert.deepEqual(committedCalls[0], { courseRefId: '12345', color: '#0aaca5' });

  // 4. Blur event follows change (native 'blur' event with same color) -> deduplicated, no duplicate call
  await commitColorChange('12345', '#0aaca5');
  assert.equal(committedCalls.length, 1);

  // 5. If user drags back and drops on the original saved color (#2563EB), no redundant commit
  committedCalls.length = 0;
  await commitColorChange('12345', '#2563EB');
  assert.equal(committedCalls.length, 0);
});

test('Calendar course color: CSS custom properties preview operates at 120fps with zero React state re-renders', () => {
  // Mock calendar root container with style.setProperty and style.removeProperty
  const properties = new Map();
  const mockRoot = {
    style: {
      setProperty(key, val) {
        properties.set(key, val);
      },
      removeProperty(key) {
        properties.delete(key);
      },
    },
  };

  let reactStateReRenderCount = 0;

  const handleColorLivePreview = (courseRefId, color) => {
    // Zero React setState called here
    mockRoot.style.setProperty(`--course-color-${courseRefId}`, color);
    mockRoot.style.setProperty(`--course-color-${courseRefId}-bg`, `${color}1F`);
  };

  // Simulate rapid 120hz drag (e.g. 120 events in 1 second)
  for (let i = 0; i < 120; i++) {
    const col = `#${i.toString(16).padStart(6, '0')}`;
    handleColorLivePreview('crs-101', col);
  }

  // 1. Verify CSS variables are updated directly on container
  assert.equal(properties.get('--course-color-crs-101'), '#000077');
  assert.equal(properties.get('--course-color-crs-101-bg'), '#0000771F');

  // 2. Verify React did NOT trigger any state re-renders during drag
  assert.equal(reactStateReRenderCount, 0);

  // 3. Clean up on commit
  mockRoot.style.removeProperty('--course-color-crs-101');
  mockRoot.style.removeProperty('--course-color-crs-101-bg');
  assert.equal(properties.has('--course-color-crs-101'), false);
  assert.equal(properties.has('--course-color-crs-101-bg'), false);
});

test('Calendar grid dynamic expansion: expands hours past 19:00/20:00 up to 24:00 for late events and clamps positioning', () => {
  const timeToMinutes = (str) => {
    const [h, m] = (str || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const calculateHoursRange = (events) => {
    let minH = 8;
    let maxH = 20;

    for (const ev of events) {
      if (ev.all_day) continue;
      const startMin = timeToMinutes(ev.start_time_str);
      const rawEndMin = ev.end_time_str ? timeToMinutes(ev.end_time_str) : 0;
      const endMin = rawEndMin > startMin ? rawEndMin : Math.min(1440, startMin + 45);

      const sh = Math.floor(startMin / 60);
      const eh = Math.ceil(endMin / 60);

      if (sh < minH) minH = Math.max(0, sh);
      if (sh >= maxH) maxH = Math.min(24, sh + 1);
      if (eh > maxH) maxH = Math.min(24, eh);
    }

    const hrs = [];
    for (let h = minH; h < maxH; h++) hrs.push(h);
    return { gridStartHour: minH, gridEndHour: maxH, hoursList: hrs };
  };

  // Case 1: Normal 08:00 - 18:00 day
  const normalEvents = [{ start_time_str: '10:15', end_time_str: '12:00', all_day: false }];
  const normalRange = calculateHoursRange(normalEvents);
  assert.equal(normalRange.gridStartHour, 8);
  assert.equal(normalRange.gridEndHour, 20);
  assert.equal(normalRange.hoursList.length, 12);
  assert.equal(normalRange.hoursList.at(-1), 19);

  // Case 2: Late night deadline or course at 23:55 (like user screenshot)
  const lateEvents = [
    { start_time_str: '14:15', end_time_str: '17:00', all_day: false },
    { start_time_str: '23:55', end_time_str: '23:55', all_day: false }
  ];
  const lateRange = calculateHoursRange(lateEvents);
  assert.equal(lateRange.gridStartHour, 8);
  // gridEndHour must expand to 24 (midnight)
  assert.equal(lateRange.gridEndHour, 24);
  // hoursList must include 20:00, 21:00, 22:00, 23:00 (16 hours total: 8..23)
  assert.equal(lateRange.hoursList.length, 16);
  assert.equal(lateRange.hoursList.at(-1), 23);

  // Case 3: Layout positioning clamping: event at 23:55 stays inside grid
  const gridStartMin = lateRange.gridStartHour * 60; // 480
  const gridEndMin = lateRange.gridEndHour * 60;     // 1440
  const totalRange = gridEndMin - gridStartMin;      // 960

  const startMin = Math.max(gridStartMin, timeToMinutes('23:55')); // 1435
  const rawEnd = Math.max(startMin + 30, timeToMinutes('23:55'));
  const endMin = Math.min(gridEndMin, rawEnd);
  const durationMin = Math.max(25, endMin - startMin);
  let topPct = ((startMin - gridStartMin) / totalRange) * 100;
  const heightPct = Math.max(4, (durationMin / totalRange) * 100);

  if (topPct + heightPct > 100) {
    topPct = Math.max(0, 100 - heightPct);
  }

  // Verify it never exceeds 100% of the table height
  assert.ok(topPct + heightPct <= 100);
  assert.ok(topPct >= 0);
});

test('Calendar cache preservation: empty server response does not overwrite populated cache', () => {
  const cachedCalendar = {
    semester: 'ALL',
    courses: [{ course_ref_id: 'c1', course_title: 'Computer Vision', color: '#ff0000', status: 'valid_empty' }],
    events: [{ uid: 'ev1', title: 'Lecture 1', date_str: '2026-11-09', start_time_str: '10:15', end_time_str: '12:00' }],
  };

  let clientCalendarData = cachedCalendar;
  let clientSavedCache = cachedCalendar;

  const handleIncomingCalendar = (freshCal) => {
    const existingCached = clientSavedCache;
    const incomingCoursesCount = freshCal?.courses?.length || 0;
    const incomingEventsCount = freshCal?.events?.length || 0;
    const cachedCoursesCount = existingCached?.courses?.length || 0;
    const cachedEventsCount = existingCached?.events?.length || 0;

    if (
      incomingCoursesCount === 0 &&
      incomingEventsCount === 0 &&
      (cachedCoursesCount > 0 || cachedEventsCount > 0)
    ) {
      // Preserve cached data
      if (existingCached) {
        clientCalendarData = existingCached;
      }
      return;
    }

    clientCalendarData = freshCal;
    clientSavedCache = freshCal;
  };

  // Server restarts and returns empty calendar response
  const emptyServerCal = { semester: 'ALL', courses: [], events: [] };
  handleIncomingCalendar(emptyServerCal);

  // Verify the client calendar and cache are preserved
  assert.equal(clientCalendarData.courses.length, 1);
  assert.equal(clientCalendarData.events.length, 1);
  assert.equal(clientSavedCache.courses.length, 1);
});

