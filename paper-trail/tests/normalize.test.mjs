import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResult, rowsOf, objectOf } from '../src/data/normalize.js';

const block = v => ({ type: 'text', text: JSON.stringify(v) });

test('one text block per row', () => {
  const res = { content: [block({ ticker: 'A' }), block({ ticker: 'B' })] };
  assert.deepEqual(rowsOf(res).map(r => r.ticker), ['A', 'B']);
});

test('truncated wrapper exposes items and paging metadata', () => {
  const res = { content: [block({ truncated: true, original_item_count: 500, returned_item_count: 2, note: '…', items: [{ ticker: 'A' }, { ticker: 'B' }] })] };
  const { rows, meta } = parseResult(res);
  assert.equal(rows.length, 2);
  assert.equal(meta.truncated, true);
  assert.equal(meta.original, 500);
  assert.equal(meta.returned, 2);
});

test('empty-result wrapper yields no rows, not a bogus row', () => {
  const res = { content: [block({ count: 0, results: [], message: 'No data found for this query.' })] };
  const { rows, meta } = parseResult(res);
  assert.equal(rows.length, 0);
  assert.match(meta.message, /No data/);
});

test('single object for profile tools', () => {
  const profile = { profile: { name: 'X' }, recent_trades: [] };
  const res = { content: [block(profile)] };
  assert.deepEqual(objectOf(res), profile);
});

test('structuredContent wins when present', () => {
  assert.deepEqual(rowsOf({ structuredContent: { result: [{ a: 1 }] }, content: [] }), [{ a: 1 }]);
  assert.deepEqual(rowsOf({ structuredContent: [{ a: 2 }] }), [{ a: 2 }]);
});

test('non-JSON text blocks are ignored', () => {
  assert.deepEqual(rowsOf({ content: [{ type: 'text', text: 'hello' }, block({ a: 1 })] }), [{ a: 1 }]);
});

test('payload fallback', () => {
  assert.deepEqual(rowsOf({ content: [], payload: [{ a: 3 }] }), [{ a: 3 }]);
  assert.equal(rowsOf(null).length, 0);
});
