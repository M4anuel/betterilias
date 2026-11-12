// Keep Safari's verified popup, page bridge, transport and artwork aligned with Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extensions/chrome');
const target = path.join(root, 'extensions/safari');
fs.mkdirSync(target, { recursive: true });
for (const name of ['content.js', 'popup.html', 'popup.js', 'request.js', 'toolbar.js', 'i18n.js',
  'logo.png', 'icon.svg', 'icon16.png', 'icon48.png', 'icon128.png', '_locales']) {
  fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true });
}
const popup = path.join(target, 'popup.js');
fs.writeFileSync(popup, fs.readFileSync(popup, 'utf8').replace(
  "source: typeof browser !== 'undefined' ? 'firefox_extension' : 'chrome_extension'",
  "source: 'safari_extension'"));
fs.copyFileSync(path.join(source, 'manifest.json'), path.join(target, 'manifest.json'));
