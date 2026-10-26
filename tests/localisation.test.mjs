import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { translate, resolveLanguage } from '../locales/runtime.mjs';
import { validateCatalogues } from '../locales/validate.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitions = JSON.parse(fs.readFileSync(path.join(root, 'locales/languages.json')));
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json')));
const de = JSON.parse(fs.readFileSync(path.join(root, 'locales/de.json')));

test('regional language selection and unsupported languages', () => {
  assert.equal(resolveLanguage('de-CH', definitions), 'de');
  assert.equal(resolveLanguage('en-US', definitions), 'en');
  assert.equal(resolveLanguage('unknown', definitions), 'en');
});
test('partial languages fall back to English and safely interpolate content', () => {
  const catalogues = { en: { greeting: 'Hello {name}', missing: 'Fallback {name}' }, fr: { greeting: 'Bonjour {name}', missing: '   ' } };
  assert.equal(translate(catalogues, 'fr', 'greeting', { name: '$& {other}' }), 'Bonjour $& {other}');
  assert.equal(translate(catalogues, 'fr', 'missing', { name: 'Anna' }), 'Fallback Anna');
  assert.equal(translate(catalogues, 'unknown', 'missing', { name: 'Anna' }), 'Fallback Anna');
});
test('all supported catalogues are complete and placeholders agree', () => {
  assert.deepEqual(validateCatalogues(definitions, { en, de }), { errors: [], warnings: [] });
  const invalid = validateCatalogues(definitions, { en, de: { ...de, 'Team #{p0}': 'Team #{missing}' } });
  assert.ok(invalid.errors.some(error => error.includes('placeholders')));
});
test('the actual build validator rejects incomplete full languages and accepts partial ones', () => {
  const directory = fs.mkdtempSync(path.join(root, '.pytest-tmp-node-'));
  const write = (name, data) => fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(data));
  const run = () => spawnSync(process.execPath, ['scripts/check-locales.mjs', '--locales-dir', directory], { cwd: root, encoding: 'utf8' });
  try {
    write('languages', definitions); write('en', en);
    const incomplete = { ...de }; delete incomplete['Abbrechen']; write('de', incomplete);
    const failure = run();
    assert.equal(failure.status, 1); assert.match(failure.stderr, /de: missing translation: Abbrechen/);
    write('languages', { ...definitions, de: { ...definitions.de, support: 'partial' } });
    const success = run();
    assert.equal(success.status, 0); assert.match(success.stderr, /de: missing translation: Abbrechen/);
    const missingEnglish = { ...en }; delete missingEnglish['Abbrechen']; write('en', missingEnglish);
    assert.equal(run().status, 1);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.join(root, '.pytest-tmp-node-')));
    fs.rmSync(directory, { recursive: true });
  }
});
test('both packaged extension runtimes select languages and match shared catalogues', () => {
  for (const directory of ['extension', 'extension-firefox']) {
    const context = vm.createContext({ navigator: { language: 'de-CH' } });
    vm.runInContext(fs.readFileSync(path.join(root, directory, 'i18n.js'), 'utf8'), context);
    const runtime = context.BetterIliasI18n;
    assert.equal(runtime.getLanguage(), 'de');
    assert.equal(runtime.t('Sitzung mit BetterIlias synchronisieren'), de['Sitzung mit BetterIlias synchronisieren']);
    runtime.setLanguage('en');
    assert.equal(runtime.t('Sitzung mit BetterIlias synchronisieren'), en['Sitzung mit BetterIlias synchronisieren']);
    runtime.setLanguage('unknown'); assert.equal(runtime.getLanguage(), 'en');
  }
  assert.equal(fs.readFileSync(path.join(root, 'extension/i18n.js'), 'utf8'), fs.readFileSync(path.join(root, 'extension-firefox/i18n.js'), 'utf8'));
});
