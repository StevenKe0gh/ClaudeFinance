import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHolding, tradeFlows, packFlows, unpackFlows } from '../src/model/family.js';
import { FAMILY_STAKES } from '../src/data/families.js';

// Shapes as Quiver returns them, including its wrong tickers on funds and bonds.
const rows = [
  { ticker: 'NFLX', company: 'NETFLIX COM INC', transaction: 'Purchase', amount: '$1,000,001 - $5,000,000', traded: '2026-08-21 00:00:00', filed: '2026-10-08' },
  { ticker: 'NVDA', company: 'NVIDIA CORP', transaction: 'Sale', amount: '$500,001 - $1,000,000', traded: '2026-08-21 00:00:00', filed: '2026-10-08' },
  { ticker: 'MSCI', company: 'Ishares Tr Msci Eafe Etf', transaction: 'Purchase', amount: '$500,001 - $1,000,000', traded: '2026-08-17 00:00:00', filed: '2026-10-08' },
  { ticker: 'AXP', company: 'AMERICAN EXPRESS CO PERP - E 6.4500%', transaction: 'Purchase', amount: '$100,001 - $250,000', traded: '2026-08-05 00:00:00', filed: '2026-10-08' },
  { ticker: null, company: 'KALAMAZOO MI CAP IMPT 2022 AGI B/E 5.00 % Due Oct 1, 2026', transaction: 'Purchase', amount: '$50,001 - $100,000', traded: '2026-08-21 00:00:00', filed: '2026-10-08' },
  { ticker: 'TT', company: 'TRANE TECHNOLOGIES PLC F', transaction: 'Purchase', amount: '$1,001 - $15,000', traded: '2025-12-30', filed: '2026-05-13' }
];

test('funds and bonds are told apart by name, whatever ticker Quiver attached', () => {
  assert.equal(classifyHolding(rows[2]).kind, 'fund');
  assert.equal(classifyHolding(rows[3]).kind, 'bond');
  assert.equal(classifyHolding(rows[4]).kind, 'bond');
  assert.equal(classifyHolding(rows[0]).kind, 'stock');
  assert.ok(classifyHolding(rows[0]).sector);
});

test('tradeFlows sums purchases and sales by sector and stock from the start date', () => {
  const f = tradeFlows(rows, { from: '2026-01-01' });
  assert.equal(f.total.n, 5, 'the December trade is before the window');
  assert.equal(f.latestFiled, '2026-10-08');
  const nflx = f.stocks.find(x => x.ticker === 'NFLX');
  assert.equal(nflx.net, 3000000.5);
  assert.equal(f.stocks.at(-1).ticker, 'NVDA');
  assert.ok(f.categories.some(c => c.key === 'bond' && c.n === 2));
  const back = unpackFlows(JSON.parse(JSON.stringify(packFlows(f, { asOf: '2026-10-16', from: '2026-01-01' }))));
  assert.equal(back.stocks[0].ticker, 'NFLX');
  assert.equal(back.total.n, 5);
});

test('every family stake names who, what, when and a source', () => {
  for (const x of FAMILY_STAKES) {
    assert.ok(x.family && x.who && x.company && x.what && x.reported, x.company);
    assert.ok(x.src.length && x.src.every(([n, u]) => n && /^https:\/\//.test(u)), x.company);
  }
});
