import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('@typescript/typescript6');

let source = fs.readFileSync(new URL('../frontend/src/lib/repositoryGraph.ts', import.meta.url), 'utf8');

// Stub out React, cache, and i18n imports for pure Node execution
source = source.replace(
  /import\s*\{[^}]*\}\s*from\s*'react';?/,
  'const useEffect = () => {}, useState = (init) => [typeof init === "function" ? init() : init, () => {}];'
);
source = source.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/cache';?/,
  'const cache = { getSessionId: () => "test_session" };'
);
source = source.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/i18n';?/,
  'const t = (k) => k;'
);

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
});

// Setup mock window/localStorage environment before importing
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};

const graphLib = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('repository graph ingests breadcrumbs and items into a linked graph lazily', () => {
  // Clear any existing graph in memory
  graphLib.clearRepositoryGraph();

  // Root level response
  const rootResponse = {
    container_ref_id: '1',
    title: 'Magazin',
    breadcrumbs: [{ ref_id: '1', title: 'Magazin' }],
    counts: { cat: 2, crs: 0, grp: 0, other: 0 },
    items: [
      { ref_id: '10', title: 'Philosophisch-historische Fakultät', item_type: 'cat', accessible: true },
      { ref_id: '20', title: 'Mathematisch-naturwissenschaftliche Fakultät', item_type: 'cat', accessible: true },
    ],
  };

  graphLib.ingestRepositoryResponse(rootResponse);
  const graph = graphLib.getRepositoryGraph();

  assert.equal(graph.nodes['1'].title, 'Magazin');
  assert.equal(graph.nodes['1'].is_expanded, true);
  assert.equal(graph.nodes['10'].title, 'Philosophisch-historische Fakultät');
  assert.equal(graph.nodes['10'].is_expanded, false); // Lazy: child is not expanded yet
  assert.equal(graph.nodes['10'].parent_ref_id, '1');
  assert.equal(graph.nodes['20'].parent_ref_id, '1');
  assert.deepEqual(graph.nodes['1'].children_ref_ids, ['10', '20']);

  // Check query methods
  const rootChildren = graphLib.getChildren('1');
  assert.equal(rootChildren.length, 2);
  assert.equal(rootChildren[0].ref_id, '10');

  const ancestors10 = graphLib.getAncestors('10');
  assert.equal(ancestors10.length, 1);
  assert.equal(ancestors10[0].ref_id, '1');

  const siblings10 = graphLib.getSiblings('10');
  assert.equal(siblings10.length, 1);
  assert.equal(siblings10[0].ref_id, '20');

  // Now lazily navigate to child node 20
  const philNatResponse = {
    container_ref_id: '20',
    title: 'Mathematisch-naturwissenschaftliche Fakultät',
    breadcrumbs: [
      { ref_id: '1', title: 'Magazin' },
      { ref_id: '20', title: 'Mathematisch-naturwissenschaftliche Fakultät' },
    ],
    counts: { cat: 1, crs: 1, grp: 0, other: 0 },
    items: [
      { ref_id: '201', title: 'Departement Informatik', item_type: 'cat', accessible: true },
      { ref_id: '202', title: 'Einführung in die Programmierung', item_type: 'crs', accessible: true, description: 'Herbstsemester' },
    ],
  };

  graphLib.ingestRepositoryResponse(philNatResponse);
  const updated20 = graphLib.getNode('20');
  assert.equal(updated20?.is_expanded, true);
  assert.deepEqual(updated20?.children_ref_ids, ['201', '202']);

  // Ancestors for 201 should be root -> 20
  const ancestors201 = graphLib.getAncestors('201');
  assert.equal(ancestors201.length, 2);
  assert.equal(ancestors201[0].ref_id, '1');
  assert.equal(ancestors201[1].ref_id, '20');

  // Search across the lazily discovered repository graph
  const searchInformatik = graphLib.searchDiscoveredNodes('informatik');
  assert.equal(searchInformatik.length, 1);
  assert.equal(searchInformatik[0].ref_id, '201');

  const searchCourse = graphLib.searchDiscoveredNodes('programmierung');
  assert.equal(searchCourse.length, 1);
  assert.equal(searchCourse[0].ref_id, '202');

  const searchDesc = graphLib.searchDiscoveredNodes('Herbstsemester');
  assert.equal(searchDesc.length, 1);
  assert.equal(searchDesc[0].ref_id, '202');
});

test('formatRepositoryCounts formats item summaries with localized plurals', () => {
  const items = [
    { ref_id: '1', title: 'A', item_type: 'cat' },
    { ref_id: '2', title: 'B', item_type: 'cat' },
    { ref_id: '3', title: 'C', item_type: 'crs' },
    { ref_id: '4', title: 'D', item_type: 'grp' },
    { ref_id: '5', title: 'E', item_type: 'grp' },
    { ref_id: '6', title: 'F', item_type: 'grp' },
  ];
  const counts = graphLib.countRepositoryItems(items);
  assert.equal(counts.total, 6);
  assert.equal(counts.categories, 2);
  assert.equal(counts.courses, 1);
  assert.equal(counts.groups, 3);

  const mockTranslate = (key) => {
    const dict = {
      Kategorien: 'Kategorien',
      Kurs: 'Kurs',
      Gruppen: 'Gruppen',
    };
    return dict[key] || key;
  };

  const formatted = graphLib.formatRepositoryCounts(counts, mockTranslate);
  assert.equal(formatted, '2 Kategorien, 1 Kurs, 3 Gruppen');

  const singleCatCounts = graphLib.countRepositoryItems([{ ref_id: '1', title: 'A', item_type: 'cat' }]);
  assert.equal(graphLib.formatRepositoryCounts(singleCatCounts, (k) => k), '1 Kategorie');
});
