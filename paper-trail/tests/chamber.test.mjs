import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chamberHoldings, displayName, packHoldings, unpackHoldings } from '../src/model/chamber.js';
const senateHoldings = (rows, o) => chamberHoldings(rows, { chamber: 'Senate', ...o });

const t = (o) => ({ chamber: 'Senate', party: 'R', owner: 'Self', amount: '$15,001 - $50,000', company: `${o.ticker} Inc`, ...o });
const rows = [
  t({ representative: 'Tuberville, Tommy', bioguide_id: 'T1', ticker: 'MSFT', transaction: 'Purchase', traded: '2023-01-10' }),
  t({ representative: 'Tuberville, Tommy', bioguide_id: 'T1', ticker: 'MSFT', transaction: 'Sale (Partial)', traded: '2024-02-01', amount: '$1,001 - $15,000' }),
  t({ representative: 'Tuberville, Tommy', bioguide_id: 'T1', ticker: 'AAPL', transaction: 'Purchase', traded: '2023-03-01' }),
  t({ representative: 'Tuberville, Tommy', bioguide_id: 'T1', ticker: 'AAPL', transaction: 'Sale (Full)', traded: '2025-10-07' }),
  t({ representative: 'Whitehouse, Sheldon', bioguide_id: 'W1', party: 'D', ticker: 'MSFT', transaction: 'Sale (Partial)', traded: '2026-09-01' }),
  t({ representative: 'Whitehouse, Sheldon', bioguide_id: 'W1', party: 'D', ticker: 'NVDA', transaction: 'Purchase', traded: '2026-08-20', owner: 'Spouse' }),
  t({ representative: 'Whitehouse, Sheldon', bioguide_id: 'W1', party: 'D', ticker: 'NVDA', transaction: 'Sale (Full)', traded: '2026-09-02', owner: 'Self' }),
  t({ representative: 'Carper, Thomas R.', bioguide_id: 'C1', party: 'D', ticker: 'MSFT', transaction: 'Purchase', traded: '2022-05-01' }),
  t({ representative: 'Fetterman, John', bioguide_id: 'F1', party: 'D', ticker: null, transaction: 'Purchase', traded: '2026-09-16', company: 'DELL INTL LLC' }),
  t({ representative: 'Mullin, Markwayne', bioguide_id: 'M1', ticker: 'MSFT', transaction: 'Exchange', traded: '2026-01-01' })
];
const current = b => b !== 'C1';

test('a purchase opens a position, a full sale closes it, a partial sale keeps it', () => {
  const { stocks, members: senators } = senateHoldings(rows, { isCurrent: current, asOf: '2026-10-15' });
  const msft = stocks.find(s => s.ticker === 'MSFT');
  assert.equal(msft.count, 2, 'Tuberville still holds after a partial sale; Whitehouse held it before the window');
  assert.deepEqual(msft.parties, { D: 1, R: 1, I: 0 });
  assert.equal(stocks.find(s => s.ticker === 'AAPL'), undefined, 'sold in full');
  assert.equal(senators, 2);
  const tub = msft.holders.find(h => h.bioguide === 'T1');
  assert.equal(tub.cost, 32500.5 - 8000.5);
  assert.equal(tub.since, '2023-01-10');
  const wh = msft.holders.find(h => h.bioguide === 'W1');
  assert.equal(wh.known, false, 'size unknown: owned before the first disclosed trade');
  assert.equal(wh.since, null);
});

test("a spouse's purchase is not closed by the senator's own full sale", () => {
  const nvda = senateHoldings(rows, { isCurrent: current }).stocks.find(s => s.ticker === 'NVDA');
  assert.equal(nvda.count, 1);
});

test('former senators, rows without a ticker and exchanges are left out', () => {
  const { stocks } = senateHoldings(rows, { isCurrent: current });
  assert.ok(!stocks.some(s => s.holders.some(h => h.bioguide === 'C1')));
  assert.ok(!stocks.some(s => s.holders.some(h => h.bioguide === 'M1')));
  assert.ok(!stocks.some(s => /DELL/.test(s.company)));
});

test('stocks rank by senators holding, then money in; recent activity counts 90 days', () => {
  const { stocks } = senateHoldings(rows, { isCurrent: current, asOf: '2026-10-15' });
  assert.equal(stocks[0].ticker, 'MSFT');
  assert.deepEqual(stocks[0].recent, { buys: 0, sells: 1 });
  assert.equal(stocks[0].last.name, 'Sheldon Whitehouse');
});

test('displayName puts first names first and keeps suffixes last', () => {
  assert.equal(displayName('Tuberville, Tommy'), 'Tommy Tuberville');
  assert.equal(displayName('McConnell, A. Mitchell Jr.'), 'A. Mitchell McConnell Jr.');
  assert.equal(displayName('Justice II,  James Conley'), 'James Conley Justice II');
  assert.equal(displayName('Pete Ricketts'), 'Pete Ricketts');
});

test('the shared document round-trips', () => {
  const res = senateHoldings(rows, { isCurrent: current, asOf: '2026-10-15' });
  const back = unpackHoldings(JSON.parse(JSON.stringify(packHoldings(res, { asOf: '2026-10-15', from: '2020-01-01' }))));
  assert.equal(back.stocks[0].ticker, 'MSFT');
  assert.equal(back.stocks[0].count, 2);
  assert.equal(back.stocks[0].holders[0].name, 'Tommy Tuberville');
  assert.equal(back.members, 2);
  assert.equal(unpackHoldings({ v: 0 }), null);
});

test('rows from the other chamber are left out', () => {
  const house = rows.map(r => ({ ...r, chamber: 'House' }));
  assert.equal(chamberHoldings(house, { chamber: 'Senate' }).stocks.length, 0);
  assert.ok(chamberHoldings(house, { chamber: 'House', isCurrent: current }).stocks.length > 0);
});
