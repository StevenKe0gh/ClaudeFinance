#!/usr/bin/env node
// Latest US quotes for every listed ticker, from the NASDAQ screener snapshot
// mirrored daily at github.com/rreichel3/US-Stock-Symbols. Writes one JSON
// document shaped for the artifact db (`quotes/latest`, < 256 KiB):
//
//   { asOf, source, q: { TICKER: [lastSale, pctChange, marketCapMillions] } }
//
//   node jobs/quotes.mjs --out out/quotes-latest.json

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main';
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : 'quotes-latest.json';
const num = s => { const v = Number(String(s ?? '').replace(/[$,%]/g, '')); return Number.isFinite(v) ? v : null; };

const q = {};
for (const x of ['nyse', 'nasdaq', 'amex']) {
  const res = await fetch(`${BASE}/${x}/${x}_full_tickers.json`);
  if (!res.ok) { console.error(`${x}: HTTP ${res.status}`); continue; }
  for (const r of await res.json()) {
    const t = String(r.symbol || '').trim().toUpperCase().replace(/\/([A-Z])$/, '.$1');
    if (!/^[A-Z][A-Z0-9.]{0,6}$/.test(t) || q[t]) continue;
    const p = num(r.lastsale);
    if (p == null || p <= 0) continue;
    const pc = num(r.pctchange);
    const mc = num(r.marketCap);
    q[t] = [Math.round(p * 100) / 100, pc == null ? null : Math.round(pc * 100) / 100, mc ? Math.round(mc / 1e6) : null];
  }
}
const doc = { asOf: new Date().toISOString(), source: 'NASDAQ screener via github.com/rreichel3/US-Stock-Symbols', count: Object.keys(q).length, q };
await mkdir(path.dirname(out) || '.', { recursive: true });
await writeFile(out, JSON.stringify(doc));
console.log(JSON.stringify({ out, count: doc.count, bytes: JSON.stringify(doc).length }));
