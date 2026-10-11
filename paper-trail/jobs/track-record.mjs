#!/usr/bin/env node
// Track record per member of Congress: how their past purchases did against
// the S&P 500 (SPY) a fixed number of days after the trade date.
//
//   node jobs/track-record.mjs --trades /tmp/pt/congress --prices /tmp/pt/prices3y --out /tmp/pt/track.json [--horizon 90]
//
// --trades  directory of JSON files with Quiver congressional trades (arrays,
//           the {items:[...]} wrapper, or the connector's saved text output)
// --prices  directory of price documents from jobs/prices.mjs (<TICKER>.json
//           with { t: [dates], c: [closes] }), including SPY.json
//
// Output (the artifact's members/track document):
//   { asOf, horizon, benchmark, method, members: { BIOGUIDE: { name, n, ex, med, hit, score } } }
// ex = mean excess return (0.05 = +5 %), hit = share of trades that beat SPY,
// score = 0..1 after shrinking small samples towards zero (0.5 = neutral).

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DAY = 864e5;
const SHRINK = 10;        // trades of evidence needed to trust half of the measured edge
const SCALE = 0.04;       // a shrunk +4 % edge maps to a score of about 0.73
const CAP = 1;            // cap single-trade excess at ±100 % so one ten-bagger does not decide

/** Parse every trade row we can find in a file's text. */
export function parseTrades(text) {
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.items)) return v.items;
    if (v && v.result && Array.isArray(v.result.items)) return v.result.items;
    if (v && typeof v === 'object') return [v];
  } catch { /* fall through: concatenated objects */ }
  const out = [];
  for (const chunk of t.split(/\}\s*\{/)) {
    const s = (chunk.startsWith('{') ? '' : '{') + chunk + (chunk.endsWith('}') ? '' : '}');
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return out;
}

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** First index whose date is on or after d (binary search), or -1. */
export function indexOnOrAfter(dates, d) {
  let lo = 0, hi = dates.length - 1;
  if (!dates.length || d > dates[hi]) return -1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < d) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Return of a price series between two calendar dates, using the next trading day for each. */
export function periodReturn(doc, from, to) {
  if (!doc || !doc.t || !doc.c) return null;
  const a = indexOnOrAfter(doc.t, from), b = indexOnOrAfter(doc.t, to);
  if (a < 0 || b < 0 || b <= a) return null;
  const p0 = doc.c[a], p1 = doc.c[b];
  return p0 > 0 && p1 > 0 ? p1 / p0 - 1 : null;
}

/**
 * @param {object[]} trades  Quiver rows: representative, bioguide_id, ticker, transaction, amount, traded
 * @param {(ticker:string)=>object|null} priceOf  price document lookup
 * @param {{ asOf:string, horizon?:number, benchmark?:string }} opts
 */
export function computeTrack(trades, priceOf, { asOf, horizon = 90, benchmark = 'SPY' }) {
  const spy = priceOf(benchmark);
  if (!spy) throw new Error(`No ${benchmark} price history: the excess return needs it.`);
  const cutoff = addDays(asOf, -horizon);
  const seen = new Set();
  const by = new Map();
  let used = 0, skipped = 0;
  for (const r of trades) {
    if (!r || !/purchase/i.test(r.transaction || '') || !r.ticker || !r.traded || !r.bioguide_id) continue;
    const d = String(r.traded).slice(0, 10);
    if (d > cutoff) continue; // the horizon has not passed yet
    const key = [r.bioguide_id, r.ticker, d, r.amount].join('|');
    if (seen.has(key)) continue; // duplicate filing lines
    seen.add(key);
    const end = addDays(d, horizon);
    const rs = periodReturn(priceOf(String(r.ticker).toUpperCase()), d, end);
    const rb = periodReturn(spy, d, end);
    if (rs == null || rb == null) { skipped++; continue; }
    const ex = Math.max(-CAP, Math.min(CAP, rs - rb));
    if (!by.has(r.bioguide_id)) by.set(r.bioguide_id, { name: r.representative || r.bioguide_id, xs: [] });
    by.get(r.bioguide_id).xs.push(ex);
    used++;
  }
  const members = {};
  for (const [id, { name, xs }] of by) {
    const n = xs.length;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const sorted = [...xs].sort((a, b) => a - b);
    const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const shrunk = mean * (n / (n + SHRINK));
    members[id] = {
      name, n,
      ex: round(mean), med: round(med),
      hit: round(xs.filter(x => x > 0).length / n),
      score: round(1 / (1 + Math.exp(-shrunk / SCALE))),
      horizon
    };
  }
  return { asOf, horizon, benchmark, method: `mean ${horizon}-day return after each purchase minus ${benchmark}, shrunk by n/(n+${SHRINK}), logistic scale ${SCALE}`, used, skipped, members };
}

const round = x => Math.round(x * 10000) / 10000;

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const tradesDir = arg('--trades'), pricesDir = arg('--prices'), out = arg('--out') || 'track.json';
  const horizon = +(arg('--horizon') || 90);
  if (!tradesDir || !pricesDir) { console.error('usage: --trades dir --prices dir [--out file] [--horizon 90]'); process.exit(2); }
  const trades = [];
  for (const f of await readdir(tradesDir)) if (/\.(json|txt)$/.test(f)) trades.push(...parseTrades(await readFile(path.join(tradesDir, f), 'utf8')));
  const cache = new Map();
  const files = new Set(await readdir(pricesDir));
  const priceOf = t => {
    if (cache.has(t)) return cache.get(t);
    let doc = null;
    if (files.has(`${t}.json`)) { try { doc = JSON.parse(readFileSync(path.join(pricesDir, `${t}.json`), 'utf8')); } catch { doc = null; } }
    cache.set(t, doc);
    return doc;
  };
  const result = computeTrack(trades, priceOf, { asOf: new Date().toISOString().slice(0, 10), horizon });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(result));
  console.log(JSON.stringify({ out, members: Object.keys(result.members).length, used: result.used, skipped: result.skipped }));
}

