// Bundle only the independently authored Safari runtime. No Chrome/Firefox code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extensions/safari');
const sources = ['config.js', 'core.js', 'background.js'];
const header = '// Generated from Safari-owned config.js, core.js and background.js. Do not edit.\n';
fs.writeFileSync(path.join(directory, 'service-worker.js'), header + sources.map(name =>
  `// ${name}\n${fs.readFileSync(path.join(directory, name), 'utf8')}`).join('\n;\n') + '\n');
