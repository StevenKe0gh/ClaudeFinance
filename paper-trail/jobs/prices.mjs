#!/usr/bin/env node
// One year of daily closes per ticker from Yahoo Finance's public chart
// endpoint (no key). Writes one db-ready JSON document per ticker
// (`prices/<TICKER>`) plus a summary. Needs network access to
// query1.finance.yahoo.com / query2.finance.yahoo.com.
//
//   node jobs/prices.mjs --tickers MRVL,AMD,GME --out out/prices
//
// Each document: { t: [YYYY-MM-DD...], c: [close...], cur, name, exch, asOf, src }

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const tickers = (arg('--tickers') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const out = arg('--out') || 'prices';
const range = arg('--range') || '1y';
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' };

export function toDoc(json, ticker) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) return null;
  const closes = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose) || r.indicators.quote[0].close;
  const t = [], c = [];
  r.timestamp.forEach((ts, i) => {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) return;
    t.push(new Date(ts * 1000).toISOString().slice(0, 10));
    c.push(Math.round(v * 100) / 100);
  });
  const m = r.meta || {};
  return { ticker, t, c, cur: m.currency || 'USD', name: m.longName || m.shortName || '', exch: m.fullExchangeName || m.exchangeName || '', last: m.regularMarketPrice ?? c[c.length - 1], hi52: m.fiftyTwoWeekHigh ?? null, lo52: m.fiftyTwoWeekLow ?? null, asOf: new Date().toISOString(), src: 'yahoo' };
}

async function fetchOne(ticker) {
  const sym = encodeURIComponent(ticker.replace('.', '-'));
  for (const host of HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://${host}/v8/finance/chart/${sym}?range=${range}&interval=1d&includeAdjustedClose=true`, { headers: UA, signal: AbortSignal.timeout(15000) });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        if (!res.ok) break;
        const doc = toDoc(await res.json(), ticker);
        if (doc && doc.c.length) return { ticker, doc };
        break;
      } catch (e) {
        if (attempt === 1) return { ticker, error: String(e && e.cause ? e.cause.code || e.message : e) };
      }
    }
  }
  return { ticker, error: 'no data' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(out, { recursive: true });
  const ok = [], failed = [];
  const queue = [...tickers];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const r = await fetchOne(t);
      if (r.doc) { await writeFile(path.join(out, `${t}.json`), JSON.stringify(r.doc)); ok.push(t); } else failed.push(`${t}: ${r.error}`);
    }
  }));
  const summary = { asOf: new Date().toISOString(), ok: ok.length, failed: failed.length, blocked: failed.length === tickers.length && tickers.length > 0, sampleErrors: failed.slice(0, 5) };
  await writeFile(path.join(out, '_summary.json'), JSON.stringify(summary));
  console.log(JSON.stringify(summary));
}
