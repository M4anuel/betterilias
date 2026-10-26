import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validateCatalogues } from '../locales/validate.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const ts = require('typescript');
const overrideIndex = process.argv.indexOf('--locales-dir');
const localeDirectory = overrideIndex >= 0 ? path.resolve(process.argv[overrideIndex + 1]) : path.join(root, 'locales');
export const languages = JSON.parse(fs.readFileSync(path.join(localeDirectory, 'languages.json'), 'utf8'));
export const catalogues = Object.fromEntries(Object.keys(languages).map(code => {
  const file = path.join(localeDirectory, `${code}.json`);
  return [code, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}];
}));
export function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? (['__pycache__', 'node_modules'].includes(entry.name) ? [] : files(file)) : [file];
  });
}
export function jsKeys(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const keys = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source); return keys;
}
const keys = new Set();
for (const file of files(path.join(root, 'frontend/src')).filter(f => /\.tsx?$/.test(f))) {
  for (const key of jsKeys(file)) keys.add(key);
}
for (const dir of ['extension', 'extension-firefox']) {
  for (const key of jsKeys(path.join(root, dir, 'popup.js'))) keys.add(key);
  const html = fs.readFileSync(path.join(root, dir, 'popup.html'), 'utf8');
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(match[1]);
}
for (const file of files(path.join(root, 'backend')).filter(f => f.endsWith('.py'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) {
    keys.add(match[1].slice(1, -1).replace(/\\([\\'"nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c)));
  }
}
const { errors, warnings } = validateCatalogues(languages, catalogues, keys);
for (const warning of warnings) console.warn(warning);
if (errors.length) { for (const error of errors) console.error(error); process.exitCode = 1; }
else console.log(`Localisation: ${Object.keys(catalogues.en).length} keys validated in ${Object.keys(languages).join(', ')}.`);
