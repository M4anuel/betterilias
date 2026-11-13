// Keep Safari's verified popup, page bridge, transport and artwork aligned with Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extensions/chrome');
const target = path.join(root, 'extensions/safari');
fs.mkdirSync(target, { recursive: true });
for (const name of ['content.js', 'popup.html', 'popup.js', 'request.js', 'toolbar.js', 'i18n.js',
  'logo.png', 'icon.svg', 'icon16.png', 'icon32.png', 'icon48.png', 'icon64.png', 'icon120.png', 'icon128.png', 'icon152.png', 'icon167.png', 'icon180.png', 'icon256.png', 'icon512.png', 'icon1024.png', '_locales']) {
  if (fs.existsSync(path.join(source, name))) {
    fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true });
  }
}
const popup = path.join(target, 'popup.js');
fs.writeFileSync(popup, fs.readFileSync(popup, 'utf8').replace(
  "source: typeof browser !== 'undefined' ? 'firefox_extension' : 'chrome_extension'",
  "source: 'safari_extension'"));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
manifest.background = {
  scripts: [
    'i18n.js',
    'toolbar.js',
    'request.js',
    'background.js'
  ],
  persistent: false,
  service_worker: 'background.js'
};
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');


