import test from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../jobs/prices.mjs';

const chart = (closes, adj) => ({
  chart: {
    result: [{
      meta: { currency: 'USD', longName: 'Example Corp', fullExchangeName: 'NasdaqGS', regularMarketPrice: 12.5, fiftyTwoWeekHigh: 14, fiftyTwoWeekLow: 9 },
      timestamp: [1759996800, 1760083200, 1760169600],
      indicators: { quote: [{ close: closes }], ...(adj ? { adjclose: [{ adjclose: adj }] } : {}) }
    }]
  }
});

test('toDoc turns a Yahoo chart response into a price document', () => {
  const d = toDoc(chart([10.123, null, 12.5]), 'EXM');
  assert.deepEqual(d.t, ['2025-10-09', '2025-10-11']);
  assert.deepEqual(d.c, [10.12, 12.5]);
  assert.equal(d.name, 'Example Corp');
  assert.equal(d.last, 12.5);
  assert.equal(d.hi52, 14);
  assert.equal(d.src, 'yahoo');
});

test('toDoc prefers adjusted closes and rejects empty results', () => {
  assert.deepEqual(toDoc(chart([10, 11, 12], [9.5, 10.5, 11.5]), 'EXM').c, [9.5, 10.5, 11.5]);
  assert.equal(toDoc({ chart: { result: null, error: { code: 'Not Found' } } }, 'NOPE'), null);
});

import { computeTrack, periodReturn, parseTrades } from '../jobs/track-record.mjs';

const series = (start, days, f) => {
  const t = [], c = [];
  for (let i = 0; i < days; i++) { const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 864e5); t.push(d.toISOString().slice(0, 10)); c.push(f(i)); }
  return { t, c };
};

test('periodReturn uses the next trading day at both ends', () => {
  const doc = { t: ['2026-01-02', '2026-01-05', '2026-04-06'], c: [100, 102, 120] };
  assert.equal(periodReturn(doc, '2026-01-03', '2026-04-03'), 120 / 102 - 1);
  assert.equal(periodReturn(doc, '2026-05-01', '2026-06-01'), null);
});

test('computeTrack scores members by excess return over SPY and shrinks small samples', () => {
  const spy = series('2025-01-01', 400, i => 100 + i * 0.02);           // ~ +1.8 % per 90 days
  const winner = series('2025-01-01', 400, i => 50 * Math.pow(1.002, i)); // ~ +19.7 % per 90 days
  const loser = series('2025-01-01', 400, i => 80 * Math.pow(0.999, i));  // ~ -8.6 % per 90 days
  const prices = { SPY: spy, WIN: winner, LOS: loser };
  const trades = [];
  for (let k = 0; k < 20; k++) trades.push({ representative: 'Good Trader', bioguide_id: 'G1', ticker: 'WIN', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: new Date(Date.parse('2025-02-01') + k * 7 * 864e5).toISOString().slice(0, 10) });
  for (let k = 0; k < 3; k++) trades.push({ representative: 'Few Trades', bioguide_id: 'F1', ticker: 'WIN', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: new Date(Date.parse('2025-02-01') + k * 7 * 864e5).toISOString().slice(0, 10) });
  for (let k = 0; k < 20; k++) trades.push({ representative: 'Bad Trader', bioguide_id: 'B1', ticker: 'LOS', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: new Date(Date.parse('2025-02-01') + k * 7 * 864e5).toISOString().slice(0, 10) });
  trades.push({ ...trades[0] }); // duplicate line is ignored
  trades.push({ representative: 'Good Trader', bioguide_id: 'G1', ticker: 'WIN', transaction: 'Sale', amount: '$1,001 - $15,000', traded: '2025-03-01' });
  const r = computeTrack(trades, t => prices[t] || null, { asOf: '2026-01-15', horizon: 90 });
  const g = r.members.G1, f = r.members.F1, b = r.members.B1;
  assert.equal(g.n, 20);
  assert.ok(g.ex > 0.15 && g.hit === 1, JSON.stringify(g));
  assert.ok(g.score > 0.9);
  assert.ok(b.score < 0.2, JSON.stringify(b));
  assert.ok(f.score > 0.5 && f.score < g.score, 'three trades are trusted less than twenty');
});

test('parseTrades reads arrays, wrappers and concatenated objects', () => {
  assert.equal(parseTrades('[{"a":1},{"a":2}]').length, 2);
  assert.equal(parseTrades('{"items":[{"a":1}]}').length, 1);
  assert.equal(parseTrades('{"a":1}{"a":2}{"a":3}').length, 3);
});

import { checkBrief, wordCount } from '../jobs/check-brief.mjs';
import { finalStatus } from '../jobs/status.mjs';
import { buyability } from '../jobs/buyable.mjs';

const md = '### What changed\nA director bought.\n\n### Your depot\nQuiet.\n\n### Worth a closer look\nOne name.\n\n### Discount these\nA fund.\n\nNot investment advice.';
const brief = (o = {}) => ({ date: '2026-10-15', headline: 'A director bought.', markdown: md, picks: [], alerts: [], sources: 'Quiver Quant', ...o });

test('checkBrief passes a well-formed brief with buyable picks', () => {
  const r = checkBrief(brief({ picks: [{ ticker: 'BORR', name: 'Borr Drilling', why: 'Director bought $10.9M' }] }), { filings: 40, buy: { BORR: { status: 'likely' } }, date: '2026-10-15' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('checkBrief blocks a brief written without filings, and unbuyable picks', () => {
  const r = checkBrief(brief({ picks: [{ ticker: 'BPRE', name: 'Bluerock', why: 'Tier A' }] }), { filings: 0, buy: { BPRE: { status: 'no', reason: 'US closed-end fund' } } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /No filings/);
  assert.match(r.errors.join('\n'), /BPRE cannot be bought/);
});

test('checkBrief wants "check your broker" on doubtful picks and enforces length and sections', () => {
  const long = `${md}\n${'word '.repeat(400)}`;
  const r = checkBrief(brief({ markdown: long.replace('### Your depot', '### Depot'), picks: [{ ticker: 'TDIC', name: 'Dreamland', why: 'CEO bought' }] }), { filings: 5, buy: { TDIC: { status: 'unlikely', reason: 'Micro cap' } } });
  const e = r.errors.join('\n');
  assert.match(e, /words; the limit is 350/);
  assert.match(e, /"### Your depot"/);
  assert.match(e, /say "check your broker"/);
  assert.equal(checkBrief(brief({ picks: [{ ticker: 'TDIC', name: 'Dreamland', why: 'CEO bought; check your broker' }] }), { filings: 5, buy: { TDIC: { status: 'unlikely' } } }).ok, true);
  assert.equal(wordCount('### Head\n- **Borr** bought $10.9M on Oct 13–14.'), 6);
});

test('finalStatus decides the run state by rule', () => {
  const s = finalStatus([{ key: 'quiver', status: 'error', detail: 'connector off' }, { key: 'quotes', status: 'ok' }, { key: 'brief', status: 'skipped', detail: 'no filings' }], { startedAt: 1, finishedAt: 2 });
  assert.equal(s.state, 'partial');
  assert.equal(s.message, 'quiver error: connector off');
  assert.equal(finalStatus([{ key: 'quiver', status: 'ok' }, { key: 'brief', status: 'ok' }]).state, 'ok');
  assert.equal(finalStatus([{ key: 'brief', status: 'error', detail: 'write refused' }]).state, 'error');
  assert.throws(() => finalStatus([{ key: 'news', status: 'ok' }]), /unknown step/);
});

test('buyability rules out US funds and keeps listed companies', () => {
  const r = buyability(['BPRE', 'BORR'], { quotes: { q: { BORR: [4.8, 0, 1477] } } });
  assert.equal(r.BPRE.status, 'no');
  assert.equal(r.BORR.status, 'likely');
});
