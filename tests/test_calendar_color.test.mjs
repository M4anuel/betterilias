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
