#!/usr/bin/env node
// Which tickers can the investor buy at their brokers? The same estimate the
// page uses (src/model/brokers.js), for the daily brief's picks.
//
//   node jobs/buyable.mjs --tickers BORR,GME,BPRE --quotes /tmp/pt/quotes.json [--brokers scalable,traderepublic] [--marks marks.json]
//
// --quotes  quotes/latest JSON (market values come from q[T][2], in $M)
// --marks   optional JSON of confirmations { TICKER: { broker: true|false } } (workspace.brokers.marks)
// Prints { TICKER: { status, kind, reason } } and exits 0.

import { readFileSync } from 'node:fs';
import { companyOf } from '../src/core/directory.js';
import { availability, DEFAULT_BROKERS, BROKERS } from '../src/model/brokers.js';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const tickers = String(arg('--tickers') || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
if (!tickers.length) { console.error('usage: --tickers A,B [--quotes file] [--brokers scalable,traderepublic] [--marks file]'); process.exit(2); }
const read = f => (f ? JSON.parse(readFileSync(f, 'utf8')) : null);
const quotes = read(arg('--quotes'));
const q = quotes ? (quotes.q || (quotes.data && quotes.data.q) || {}) : {};
const marks = read(arg('--marks')) || {};
const use = (arg('--brokers') || DEFAULT_BROKERS.join(',')).split(',').filter(b => BROKERS[b]);

const out = {};
for (const t of tickers) {
  const c = companyOf(t);
  const av = availability(t, { use, marks, info: { listed: !!c, name: c ? c.name : '', sector: c ? c.sector : '', industry: c ? c.industry : '', capM: q[t] ? q[t][2] : null } });
  out[t] = { status: av.status, kind: av.kind, reason: av.per[av.best].reason };
}
console.log(JSON.stringify(out, null, 1));
