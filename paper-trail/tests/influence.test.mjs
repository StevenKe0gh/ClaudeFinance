import { test } from 'node:test';
import assert from 'node:assert/strict';
import { influenceUniverse, lobbyingLastYear, contractsLastYear, influencePoints, packInfluence, unpackInfluence } from '../src/model/influence.js';

const S = { stocks: [{ ticker: 'MSFT', company: 'Microsoft', count: 4 }, { ticker: 'LMT', company: 'Lockheed', count: 1 }] };
const Hh = { stocks: [{ ticker: 'MSFT', company: 'Microsoft', count: 10 }, { ticker: 'NVDA', company: 'Nvidia', count: 7 }] };

test('the universe adds both chambers and ranks by members holding', () => {
  const u = influenceUniverse({ Senate: S, House: Hh });
  assert.deepEqual(u.map(x => [x.ticker, x.members]), [['MSFT', 14], ['NVDA', 7], ['LMT', 1]]);
  assert.equal(influenceUniverse({ Senate: S, House: null }).length, 2);
});

test('lobbying and awards count only the last 12 months', () => {
  const lob = [{ amount: 1e6, date: '2026-07-20' }, { amount: 2e6, date: '2026-04-20' }, { amount: 5e6, date: '2025-07-20' }];
  assert.equal(lobbyingLastYear(lob, '2026-10-16'), 3e6);
  const awards = [{ total_dollars_obligated: 5e7, action_date: '2026-09-01' }, { total_dollars_obligated: -1e6, action_date: '2026-09-02' }, { total_dollars_obligated: 9e9, action_date: '2025-01-01' }];
  assert.equal(contractsLastYear(awards, '2026-10-16'), 5e7);
});

test('points carry holdings, lobbying, awards and the insider flag, and survive the shared document', () => {
  const u = influenceUniverse({ Senate: S, House: Hh });
  const pts = influencePoints(u, { lobbying: new Map([['MSFT', [{ amount: 3e6, date: '2026-08-01' }]]]), contracts: new Map(), asOf: '2026-10-16', insiders: new Set(['NVDA']) });
  assert.equal(pts[0].lobby, 3e6);
  assert.equal(pts[1].insider, true);
  const back = unpackInfluence(JSON.parse(JSON.stringify(packInfluence(pts, { asOf: '2026-10-16' }))));
  assert.equal(back[0].members, 14);
  assert.equal(back[0].lobby, 3e6);
});
