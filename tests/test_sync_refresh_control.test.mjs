import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('SyncRefreshControl component structure, morphing animation classes and states', () => {
  const filePath = path.resolve('frontend/src/components/SyncRefreshControl.tsx');
  assert.equal(fs.existsSync(filePath), true, 'SyncRefreshControl.tsx must exist');

  const content = fs.readFileSync(filePath, 'utf-8');

  // Verify key design requirements:
  // 1. Idle state: Checkmark icon with circle and green color and localized "Lokal bereitgestellt" label
  assert.match(content, /CheckCircle2/);
  assert.match(content, /displayLabel = label \|\| t\(['"]Lokal bereitgestellt['"]\)/);
  assert.match(content, /text-emerald-500/);

  // 1b. Syncing state: Checkmark disappears and text switches to "Synchronisiere..."
  assert.match(content, /isSyncing \? t\(['"]Synchronisiere\.\.\.['"]\) : displayLabel/);
  assert.match(content, /w-0 opacity-0 scale-0 overflow-hidden/);

  // 2. Separate reload button in idle state with rounded-full styling and subtle borders
  assert.match(content, /rounded-full/);
  assert.match(content, /w-8/);
  assert.match(content, /h-8/);

  // 3. Morphing capsule background expanding to the right during syncing
  // Idle: w-[calc(100%-2.5rem)] (wrapping just the pill with comfortable spacing)
  // Syncing: w-full (expanding to enclose the circling button)
  assert.match(content, /w-\[calc\(100%-2\.5rem\)\]/);
  assert.match(content, /w-full bg-blue-50/);
  assert.match(content, /transition-all duration-300 ease-out/);

  // 4. Button boundary dissolves when inside the blue pill during sync
  assert.match(content, /isSyncing\s*\?\s*['"]border border-transparent bg-transparent/);

  // 5. Spinning icon in exact same location
  assert.match(content, /isSyncing \? ['"]motion-safe:animate-spin['"] : ['"]['"]/);

  // 6. Accessible aria-labels and roles
  assert.match(content, /role=["']status["']/);
  assert.match(content, /aria-live=["']polite["']/);
});

test('SyncRefreshControl is deployed across all primary pages', () => {
  const files = [
    'frontend/src/components/MyCoursesView.tsx',
    'frontend/src/components/CourseView.tsx',
    'frontend/src/components/ExerciseView.tsx',
    'frontend/src/components/RepositoryView.tsx',
    'frontend/src/components/SemesterView.tsx',
    'frontend/src/components/CalendarView.tsx',
  ];

  for (const f of files) {
    const fileContent = fs.readFileSync(path.resolve(f), 'utf-8');
    assert.match(
      fileContent,
      /<SyncRefreshControl/,
      `${f} must incorporate <SyncRefreshControl />`
    );
  }
});

