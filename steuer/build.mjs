// Inlines src/tax.mjs and src/app.js into src/index.html → dist/index.html.
//   node build.mjs          build
//   node build.mjs --check  fail if dist/index.html is stale
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const at = p => path.join(root, p);
const tax = (await readFile(at('src/tax.mjs'), 'utf8')).replace(/^export\s+/gm, '');
const app = await readFile(at('src/app.js'), 'utf8');
const js = `(function () {\n'use strict';\n${tax}\n${app}\n})();`.replace(/<\/script/gi, '<\\/script');
const html = (await readFile(at('src/index.html'), 'utf8')).replace('/*__JS__*/', () => js);
const target = at('dist/index.html');
if (process.argv.includes('--check')) {
  const cur = await readFile(target, 'utf8').catch(() => '');
  if (cur !== html) { console.error('steuer/dist/index.html is out of date. Run node steuer/build.mjs.'); process.exit(1); }
  console.log('steuer/dist/index.html is up to date.');
} else {
  await mkdir(at('dist'), { recursive: true });
  await writeFile(target, html);
  console.log(`Built steuer/dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
}
