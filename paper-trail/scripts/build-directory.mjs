// Builds src/data/directory.json: ticker → [company, sector index, country index, industry index]
// from the NASDAQ/NYSE/AMEX listings mirrored daily at
// github.com/rreichel3/US-Stock-Symbols. Run when you want fresher names:
//
//   node scripts/build-directory.mjs              # downloads from GitHub
//   node scripts/build-directory.mjs --from dir   # uses dir/{nyse,nasdaq,amex}.json

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortCompany } from '../src/core/names.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main';
const EXCHANGES = ['nyse', 'nasdaq', 'amex'];
const fromIdx = process.argv.indexOf('--from');
const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

async function load(x) {
  if (fromDir) return JSON.parse(await readFile(path.join(fromDir, `${x}.json`), 'utf8'));
  const res = await fetch(`${BASE}/${x}/${x}_full_tickers.json`);
  if (!res.ok) throw new Error(`${x}: HTTP ${res.status}`);
  return res.json();
}

const sectors = [];
const countries = [];
const industries = [];
const idx = (list, v) => { const k = v || ''; let i = list.indexOf(k); if (i < 0) { i = list.length; list.push(k); } return i; };
const t = {};
let rows = 0;
for (const x of EXCHANGES) {
  for (const r of await load(x)) {
    const sym = String(r.symbol || '').trim().toUpperCase().replace(/\/([A-Z])$/, '.$1');
    if (!/^[A-Z][A-Z0-9.]{0,6}$/.test(sym) || t[sym]) continue; // skip preferreds, warrants (^, /)
    const name = shortCompany(r.name);
    if (!name) continue;
    t[sym] = [name, idx(sectors, r.sector), idx(countries, r.country), idx(industries, String(r.industry || '').trim())];
    rows++;
  }
}
const out = { v: 2, source: 'github.com/rreichel3/US-Stock-Symbols', built: new Date().toISOString().slice(0, 10), sectors, countries, industries, t };
await mkdir(path.join(root, 'src/data'), { recursive: true });
await writeFile(path.join(root, 'src/data/directory.json'), JSON.stringify(out));
console.log(`directory.json: ${rows} tickers, ${sectors.length} sectors, ${industries.length} industries, ${countries.length} countries`);
