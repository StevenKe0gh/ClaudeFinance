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
