import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanInsider, cleanCongress, roleOf, amountRange } from '../src/model/clean.js';
import { insiderPatterns } from '../src/model/patterns.js';
import { buildSignals, DEFAULT_MODEL, tierOf, PRESETS, FACTORS } from '../src/model/score.js';
import { allocate } from '../src/model/allocate.js';
import { buildGraph } from '../src/model/graph.js';

const AS_OF = '2026-10-09';
const buy = (o) => ({ transaction_type: 'P', acquired_disposed: 'A', file_date: o.date, shares_owned_after: 10000 + o.shares, is_director: false, is_officer: true, officer_title: 'Chief Executive Officer', ...o });

test('roleOf distinguishes C-suite, officers, directors and entities', () => {
  assert.equal(roleOf({ officer_title: 'President, CEO and Chairman', is_officer: true }), 'csuite');
  assert.equal(roleOf({ officer_title: 'Executive Vice President', is_officer: true }), 'officer');
  assert.equal(roleOf({ officer_title: 'EVP, Chief Financial Officer', is_officer: true }), 'csuite');
  assert.equal(roleOf({ officer_title: null, is_director: true }), 'director');
  assert.equal(roleOf({ owner: 'BAKER BROS. ADVISORS LP', is_director: true }), 'fund');
  assert.equal(roleOf({ owner: 'BERKSHIRE HATHAWAY INC' }), 'fund');
  assert.equal(roleOf({ owner: 'Jane Doe' }), 'holder');
});

test('cleanInsider drops bad tickers, future dates, outliers and duplicates', () => {
  const rows = [
    buy({ ticker: 'ACME', owner: 'A', date: '2026-10-01', shares: 100, price: 10 }),
    buy({ ticker: 'ACME', owner: 'A', date: '2026-10-01', shares: 100, price: 10 }),
    buy({ ticker: null, owner: 'B', date: '2026-10-01', shares: 1, price: 1 }),
    buy({ ticker: 'LEN, LEN.B', owner: 'C', date: '2026-10-01', shares: 1, price: 1 }),
    buy({ ticker: 'HPK', owner: 'D', date: '2033-11-18', shares: 1, price: 1 }),
    buy({ ticker: 'SLBT', owner: 'E', date: '2026-09-29', shares: 1e9, price: 1e4 }),
    buy({ ticker: 'ZERO', owner: 'F', date: '2026-10-01', shares: 0, price: 5 }),
    buy({ ticker: 'CRAFX', owner: 'G', date: '2026-10-01', shares: 10, price: 5 }),
    buy({ ticker: 'UXIN', owner: 'H', date: '2026-09-23', shares: 104931794, price: 0.0095 })
  ];
  const { rows: out, dropped } = cleanInsider(rows, { to: AS_OF });
  assert.equal(out.length, 1);
  assert.deepEqual(dropped, { noTicker: 2, mutualFund: 1, badDate: 1, nonPositive: 1, subPenny: 1, outlier: 1, duplicate: 1 });
  assert.equal(out[0].value, 1000);
  assert.equal(out[0].role, 'csuite');
  assert.ok(Math.abs(out[0].stakePct - 1) < 1e-9);
});

test('cleanCongress parses ranges and marks same-day buy/sell pairs as wash', () => {
  const { rows } = cleanCongress([
    { ticker: 'MSFT', representative: 'Josh Gottheimer', transaction: 'Purchase', amount: '$500,001 - $1,000,000', traded: '2026-08-14', filed: '2026-09-12', party: 'D' },
    { ticker: 'MSFT', representative: 'Josh Gottheimer', transaction: 'Sale', amount: '$500,001 - $1,000,000', traded: '2026-08-14', filed: '2026-09-12', party: 'D' },
    { ticker: 'SNOW', representative: 'Maria Elvira Salazar', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: '2026-07-01', filed: '2026-09-20', party: 'R' },
    { ticker: null, representative: 'X', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: '2026-09-01', filed: '2026-09-02' }
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(r => r.wash).length, 2);
  assert.equal(rows[2].lagDays, 81);
  assert.deepEqual(amountRange('$15,001 - $50,000'), { lo: 15001, hi: 50000, mid: 32500.5 });
});

test('insiderPatterns flags offerings, fixed-price deals, purchase programs and accumulation', () => {
  const placement = cleanInsider(['A', 'B', 'C'].map(o => buy({ ticker: 'SBLK', owner: o, date: '2026-09-15', shares: 1000, price: 28.27 }))).rows;
  assert.equal(insiderPatterns(placement).placement, true);

  const sameLot = cleanInsider(['Roth', 'Finke'].map(o => buy({ ticker: 'VENU', owner: o, date: '2026-09-11', shares: 200000, price: 1.75 }))).rows;
  assert.equal(insiderPatterns(sameLot).placement, true);

  const fixed = cleanInsider(['2026-09-17', '2026-09-22', '2026-09-23'].map(d => buy({ ticker: 'COE', owner: 'Huang', date: d, shares: 1000, price: 11.5 }))).rows;
  assert.equal(insiderPatterns(fixed).fixedPrice, true);

  const program = cleanInsider(Array.from({ length: 10 }, (_, i) => buy({ ticker: 'TSM', owner: `P${i}`, date: `2026-10-0${(i % 5) + 1}`, shares: 50, price: 80 + i }))).rows;
  assert.equal(insiderPatterns(program).programmatic, true);

  const accum = cleanInsider([['2026-09-10', 20.38], ['2026-09-21', 22.94], ['2026-10-02', 24.41]].map(([d, p]) => buy({ ticker: 'GME', owner: 'Cohen Ryan', date: d, shares: 1e6, price: p }))).rows;
  const pa = insiderPatterns(accum);
  assert.deepEqual(pa.accumulating, ['Cohen Ryan']);
  assert.equal(pa.placement, false);
});

function fixture() {
  const insider = cleanInsider([
    // Real-looking open-market cluster: CEO, CFO, director on different days and prices.
    buy({ ticker: 'RWT', owner: 'Abate', officer_title: 'Chief Executive Officer', date: '2026-09-15', shares: 100000, price: 3.84 }),
    buy({ ticker: 'RWT', owner: 'Carillo', officer_title: 'Chief Financial Officer', date: '2026-09-15', shares: 26065, price: 3.85 }),
    buy({ ticker: 'RWT', owner: 'Kubicek', officer_title: null, is_officer: false, is_director: true, date: '2026-09-16', shares: 50000, price: 3.98 }),
    // Offering-priced cluster: same day, same price.
    ...['A', 'B', 'C', 'D'].map(o => buy({ ticker: 'SBLK', owner: o, date: '2026-09-15', shares: 20000, price: 28.27 })),
    // Fund-only buying.
    buy({ ticker: 'KOD', owner: 'BAKER BROS. ADVISORS LP', officer_title: null, is_director: true, date: '2026-09-28', shares: 200000, price: 72 })
  ], { to: AS_OF }).rows;
  const congress = cleanCongress([
    { ticker: 'RWT', representative: 'Pat Example', transaction: 'Purchase', amount: '$15,001 - $50,000', traded: '2026-09-01', filed: '2026-09-20', party: 'D', chamber: 'House' },
    { ticker: 'RWT', representative: 'Lee Sample', transaction: 'Purchase', amount: '$15,001 - $50,000', traded: '2026-09-02', filed: '2026-09-21', party: 'R', chamber: 'Senate' }
  ]).rows;
  return { insider, congress };
}

test('buildSignals ranks a real open-market cluster above offering-priced and fund-only buying', () => {
  const { insider, congress } = fixture();
  const sigs = buildSignals({ insiderBuys: insider, congressRows: congress, asOf: AS_OF, windowDays: 30, model: DEFAULT_MODEL });
  const by = Object.fromEntries(sigs.map(s => [s.ticker, s]));
  assert.equal(sigs[0].ticker, 'RWT');
  assert.ok(by.RWT.score > by.SBLK.score);
  assert.ok(by.RWT.score > by.KOD.score);
  assert.ok(by.SBLK.notes.some(n => n.key === 'placement'));
  assert.ok(by.KOD.flags.some(f => f.id === 'entity'));
  const ids = by.RWT.flags.map(f => f.id);
  for (const id of ['csuite-cluster', 'cluster', 'convergence', 'bipartisan']) assert.ok(ids.includes(id), id);
  // Contributions add up to the score.
  const total = by.RWT.factors.reduce((s, f) => s + f.contrib, 0);
  assert.ok(Math.abs(Math.round(total) - by.RWT.score) <= 1);
  assert.deepEqual(sigs.map(s => s.rank), sigs.map((_, i) => i + 1));
});

test('insider selling from enrichment lowers the score', () => {
  const { insider, congress } = fixture();
  const base = buildSignals({ insiderBuys: insider, congressRows: congress, asOf: AS_OF, windowDays: 30, model: DEFAULT_MODEL });
  const enr = new Map([['RWT', { buyUsd: 600000, sellUsd: 3000000, sells: 12, complete: true }]]);
  const after = buildSignals({ insiderBuys: insider, congressRows: congress, enrichment: enr, asOf: AS_OF, windowDays: 30, model: DEFAULT_MODEL });
  const s0 = base.find(s => s.ticker === 'RWT'), s1 = after.find(s => s.ticker === 'RWT');
  assert.ok(s1.score < s0.score);
  assert.ok(s1.flags.some(f => f.id === 'selling'));
});

test('presets cover every factor and tiers follow thresholds', () => {
  for (const p of Object.values(PRESETS)) for (const f of FACTORS) assert.ok(Number.isFinite(p.weights[f.key]), `${p.label}.${f.key}`);
  assert.equal(tierOf(50), 'A');
  assert.equal(tierOf(49), 'B');
  assert.equal(tierOf(25), 'C');
  assert.equal(tierOf(24), 'D');
});

test('allocate respects reserve and per-position cap and reports idle cash', () => {
  const items = [{ ticker: 'A', score: 90, tier: 'A' }, { ticker: 'B', score: 60, tier: 'B' }, { ticker: 'C', score: 40, tier: 'C' }];
  const r = allocate(items, { capital: 10000, reserve: 10, cap: 20, method: 'conviction' });
  assert.ok(r.amounts.every(a => a <= 2000));
  assert.equal(r.reserve, 1000);
  assert.ok(r.idle >= 3000 - 3);
  assert.equal(r.minPositionsForFullInvestment, 5);
  const eq = allocate([...items, { ticker: 'D' }, { ticker: 'E' }], { capital: 10000, reserve: 10, cap: 20, method: 'equal' });
  assert.deepEqual(eq.amounts, [1800, 1800, 1800, 1800, 1800]);
  assert.equal(eq.idle, 0);
  assert.ok(Math.abs(eq.effectiveN - 5) < 1e-9);
});

test('buildGraph links buyers to tickers and computes degree', () => {
  const { insider, congress } = fixture();
  const sigs = buildSignals({ insiderBuys: insider, congressRows: congress, asOf: AS_OF, windowDays: 30, model: DEFAULT_MODEL });
  const g = buildGraph(sigs);
  const rwt = g.nodes.find(n => n.id === 't:RWT');
  assert.equal(rwt.degree, 5);
  assert.ok(g.nodes.some(n => n.type === 'member'));
  assert.ok(g.links.every(l => g.nodes.some(n => n.id === l.source) && g.nodes.some(n => n.id === l.target)));
  const noFunds = buildGraph(sigs, { includeFunds: false });
  assert.ok(!noFunds.nodes.some(n => n.type === 'fund'));
});
