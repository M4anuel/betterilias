import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = fs.readFileSync(new URL('../frontend/src/lib/taAllocation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } });
const helpers = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const label = n => `TA ${n}`;

test('preferences isolate accounts/courses and use an exercise fallback', () => {
  const key = helpers.allocationDefaultsKey('alice', '42', '100');
  assert.equal(key, helpers.allocationDefaultsKey('alice', '42', '200'));
  assert.notEqual(key, helpers.allocationDefaultsKey('bob', '42', '100'));
  assert.notEqual(key, helpers.allocationDefaultsKey('alice', '43', '100'));
  assert.notEqual(helpers.allocationDefaultsKey('alice', undefined, '100'), helpers.allocationDefaultsKey('alice', undefined, '200'));
  assert.equal(helpers.allocationDefaultsKey(null, '42', '100'), null);
  const draft = { version: 1, assistants: [{ id: 'ta1', name: 'Ada' }, { id: 'ta3', name: 'Bob' }], priorityOrder: ['ta3', 'ta1'], nextId: 5 };
  assert(helpers.saveAllocationDefaults(key, draft));
  assert.deepEqual(helpers.loadAllocationDefaults(key, label), draft);
  assert.equal(helpers.loadAllocationDefaults(helpers.allocationDefaultsKey('bob', '42', '100'), label).assistants[0].name, 'TA 1');
});

test('corrupted storage is safe and partial priority lists are repaired', () => {
  values.set('corrupt', 'not JSON');
  assert.equal(helpers.loadAllocationDefaults('corrupt', label).assistants.length, 2);
  values.set('corrupt', JSON.stringify({ version: 1, assistants: [{ id: 'ta1', name: 'A' }, { id: 'ta1', name: 'B' }] }));
  assert.equal(helpers.loadAllocationDefaults('corrupt', label).assistants[0].name, 'TA 1');
  values.set('partial', JSON.stringify({ version: 1, assistants: [{ id: 'ta1', name: 'A' }, { id: 'ta3', name: 'C' }], priorityOrder: ['ta3', 'missing', 'ta3'], nextId: 9 }));
  assert.deepEqual(helpers.loadAllocationDefaults('partial', label).priorityOrder, ['ta3', 'ta1']);
  assert.equal(helpers.loadAllocationDefaults('partial', label).nextId, 9);
});

test('storage exceptions do not prevent working with an allocation', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error('disabled'); }, setItem() { throw Error('full'); } };
  try {
    assert.equal(helpers.loadAllocationDefaults('key', label).assistants.length, 2);
    assert.equal(helpers.saveAllocationDefaults('key', {}), false);
  } finally { globalThis.localStorage = original; }
});

test('allocation notices never truncate content and count Unicode code points', () => {
  const human = '  Keep 😀\n[BI:ta9|Example] inside text\t';
  const assistant = { id: 'ta1', name: 'Ada' };
  const first = helpers.allocationNotice(human, assistant);
  assert.equal(helpers.allocationNoticeParts(first.notice).human, human);
  assert.equal(first.length, Array.from(first.notice).length);
  const second = helpers.allocationNotice(first.notice, { id: 'ta2', name: 'Bob' });
  assert.equal(helpers.allocationNoticeParts(second.notice).human, human);
  const long = 'A'.repeat(195);
  const refused = helpers.allocationNotice(long, assistant);
  assert.equal(refused.exceedsLimit, true);
  assert(refused.notice.startsWith(long + ' '));
  assert.equal(helpers.validAssistant({ id: 'ta1', name: 'Ada|Bob' }), false);
  assert.equal(helpers.validAssistant({ id: 'ta1', name: '  ' }), false);
});
