#!/usr/bin/env node
// Insider transactions for one day straight from SEC EDGAR, no data vendor:
// the daily form index, then each Form 4, parsed into Quiver-shaped rows.
//
//   SEC_USER_AGENT="Your Company admin@yourcompany.com" node jobs/edgar.mjs --date 2026-10-15 --out /tmp/pt/form4.json [--codes P,S]
//
// The SEC requires a User-Agent naming the requester and a contact address,
// and allows at most 10 requests a second; this stays under 8.
// https://www.sec.gov/os/accessing-edgar-data

import { writeFile } from 'node:fs/promises';
import { parseForm4, form4Index } from '../src/data/edgar.js';

const BASE = 'https://www.sec.gov/Archives/';
const GAP_MS = 125;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const indexUrl = date => {
  const [y, m, d] = date.split('-');
  return `${BASE}edgar/daily-index/${y}/QTR${Math.ceil(+m / 3)}/form.${y}${m}${d}.idx`;
};

async function get(url, ua, tries = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate' } });
    if (res.ok) return res.text();
    if (res.status === 404) return null;
    if (i + 1 >= tries || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url}`);
    await sleep(1000 * 2 ** i);
  }
}

/** Every Form 4 row filed on `date`, keeping the transaction codes in `codes` (all when empty). */
export async function form4Day(date, { ua, codes = [], onProgress } = {}) {
  const idx = await get(indexUrl(date), ua);
  if (idx == null) return { date, filings: 0, rows: [], failed: [] };
  const list = form4Index(idx);
  const rows = [];
  const failed = [];
  for (const [i, f] of list.entries()) {
    await sleep(GAP_MS);
    try {
      const text = await get(BASE + f.path, ua);
      for (const r of parseForm4(text || '', { fileDate: f.date, accession: f.accession })) if (!codes.length || codes.includes(r.transaction_type)) rows.push(r);
    } catch (e) { failed.push({ path: f.path, error: String(e.message || e) }); }
    if (onProgress && (i + 1) % 100 === 0) onProgress(i + 1, list.length);
  }
  return { date, filings: list.length, rows, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const ua = process.env.SEC_USER_AGENT;
  const date = arg('--date');
  if (!ua || !/@/.test(ua)) { console.error('Set SEC_USER_AGENT to "<name> <contact email>" (the SEC requires it).'); process.exit(2); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !arg('--out')) { console.error('usage: --date YYYY-MM-DD --out file [--codes P,S]'); process.exit(2); }
  const codes = (arg('--codes') || '').split(',').filter(Boolean);
  const res = await form4Day(date, { ua, codes, onProgress: (n, of) => console.error(`${n}/${of} filings`) });
  await writeFile(arg('--out'), JSON.stringify(res, null, 1));
  console.log(`${res.filings} Form 4 filings on ${date}: ${res.rows.length} rows kept, ${res.failed.length} failed`);
}
