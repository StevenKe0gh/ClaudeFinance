#!/usr/bin/env node
// Gate for the daily brief: run it on the finished brief before writing
// `briefs/<date>`, and write only when it exits 0.
//
//   node jobs/check-brief.mjs --brief /tmp/pt/brief.json --filings <n> --quotes /tmp/pt/quotes.json [--brokers scalable,traderepublic] [--marks marks.json] [--date YYYY-MM-DD]
//
// --filings  how many insider and congressional filings step 3 loaded. Zero
//            means Quiver was unavailable: no brief is written that day.
// Prints { ok, errors, warnings, words } and exits 1 when there are errors.

import { readFileSync } from 'node:fs';
import { buyability } from './buyable.mjs';

export const MAX_WORDS = 350;
export const MAX_PICKS = 6;
export const SECTIONS = ['What changed', 'Your depot', 'Worth a closer look', 'Discount these'];
const TONES = new Set(['pos', 'warn', 'neg', 'info']);
const CHECK = /check (?:your|the) broker|check in your app/i;

export const wordCount = md => String(md || '').replace(/^#+\s.*$/gm, '').split(/\s+/).filter(w => /[\p{L}\p{N}$]/u.test(w)).length;

/**
 * Problems with a brief. `errors` block the write; `warnings` are worth a
 * second look. `buy` is ticker → { status, kind, reason } (jobs/buyable.mjs).
 */
export function checkBrief(brief, { filings, buy = {}, date = null } = {}) {
  const errors = [];
  const warnings = [];
  const b = brief || {};
  if (!(filings > 0)) errors.push('No filings were loaded (step 3). Do not write a brief today; set jobs/status to partial and say why in its message.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) errors.push('date must be YYYY-MM-DD');
  else if (date && b.date !== date) errors.push(`date is ${b.date}, expected ${date}`);
  if (typeof b.headline !== 'string' || !b.headline.trim()) errors.push('headline is missing');
  else if (b.headline.length > 220) warnings.push(`headline is ${b.headline.length} characters; keep it to one sentence`);
  if (typeof b.markdown !== 'string' || !b.markdown.trim()) errors.push('markdown is missing');
  const words = wordCount(b.markdown);
  if (words > MAX_WORDS) errors.push(`markdown has ${words} words; the limit is ${MAX_WORDS}`);
  for (const s of SECTIONS) if (!new RegExp(`^###\\s+${s}\\s*$`, 'm').test(b.markdown || '')) errors.push(`markdown lacks the "### ${s}" section`);
  if (typeof b.sources !== 'string' || !b.sources.trim()) errors.push('sources is missing');

  const picks = Array.isArray(b.picks) ? b.picks : null;
  if (!picks) errors.push('picks must be an array');
  else {
    if (picks.length > MAX_PICKS) errors.push(`${picks.length} picks; at most ${MAX_PICKS}`);
    const seen = new Set();
    for (const [i, p] of picks.entries()) {
      const t = String((p && p.ticker) || '').toUpperCase();
      if (!t || !p.name || !p.why) { errors.push(`pick ${i + 1} needs ticker, name and why`); continue; }
      if (seen.has(t)) errors.push(`${t} is picked twice`);
      seen.add(t);
      const av = buy[t];
      if (!av) { errors.push(`${t}: no buyability result; run jobs/buyable.mjs on every pick`); continue; }
      if (av.status === 'no') errors.push(`${t} cannot be bought from the investor's brokers (${av.reason}); move it to "Discount these"`);
      else if ((av.status === 'maybe' || av.status === 'unlikely') && !CHECK.test(p.why)) errors.push(`${t} is "${av.status}" at the investor's brokers; say "check your broker" in its why`);
    }
  }

  const alerts = Array.isArray(b.alerts) ? b.alerts : null;
  if (!alerts) errors.push('alerts must be an array');
  else for (const [i, a] of alerts.entries()) {
    if (!a || !TONES.has(a.tone)) errors.push(`alert ${i + 1}: tone must be one of ${[...TONES].join(', ')}`);
    if (!a || !a.text) errors.push(`alert ${i + 1}: text is missing`);
  }
  return { ok: !errors.length, errors, warnings, words };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const read = f => (f ? JSON.parse(readFileSync(f, 'utf8')) : null);
  const file = arg('--brief');
  if (!file || arg('--filings') == null) { console.error('usage: --brief file --filings n --quotes file [--brokers a,b] [--marks file] [--date YYYY-MM-DD]'); process.exit(2); }
  const raw = read(file);
  const brief = raw && raw.data && raw.data.markdown ? raw.data : raw;
  const tickers = (Array.isArray(brief.picks) ? brief.picks : []).map(p => String((p && p.ticker) || '').toUpperCase()).filter(Boolean);
  const use = arg('--brokers') ? arg('--brokers').split(',') : undefined;
  const buy = buyability(tickers, { quotes: read(arg('--quotes')), marks: read(arg('--marks')) || {}, ...(use ? { use } : {}) });
  const res = checkBrief(brief, { filings: +arg('--filings'), buy, date: arg('--date') });
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.ok ? 0 : 1);
}
