// Bundles src/ into a single self-contained HTML file (dist/index.html) that
// claude.ai can publish as an artifact. CSS is inlined in a fixed cascade
// order; JS is bundled by esbuild into one IIFE.
//
//   node build.mjs           build dist/index.html
//   node build.mjs --check   fail if dist/index.html is out of date (CI)

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const at = p => path.join(root, p);

// Cascade order matters: tokens first, views last.
const CSS = ['tokens', 'base', 'shell', 'components', 'charts', 'brand', 'radar', 'signals', 'graph', 'dossier', 'workbench', 'policy'];

async function render() {
  const pkg = JSON.parse(await readFile(at('package.json'), 'utf8'));
  const css = (await Promise.all(CSS.map(n => readFile(at(`src/styles/${n}.css`), 'utf8')))).join('\n');
  const out = await build({
    entryPoints: [at('src/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    logLevel: 'warning'
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const tpl = await readFile(at('src/index.html'), 'utf8');
  // Function replacers: bundled JS contains `$&`-style sequences.
  return tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);
}

const html = await render();
const target = at('dist/index.html');

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== html) {
    console.error('dist/index.html is out of date. Run `npm run build` and commit the result.');
    process.exit(1);
  }
  console.log('dist/index.html is up to date.');
} else {
  await mkdir(at('dist'), { recursive: true });
  await writeFile(target, html);
  console.log(`Built dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
}
