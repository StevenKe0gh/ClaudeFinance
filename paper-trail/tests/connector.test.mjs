import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnector } from '../src/data/connector.js';

const block = v => ({ type: 'text', text: JSON.stringify(v) });
const rows = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i }));

function fakeMcp(handler) {
  const calls = [];
  return {
    calls,
    callTool: async (server, tool, input) => { calls.push({ server, tool, input }); return handler(input, calls.length); }
  };
}

test('paged stops on a short page', async () => {
  const mcp = fakeMcp(({ offset, limit }) => ({ content: rows(offset < 300 ? limit : 40, offset).map(block) }));
  const conn = createConnector({ getMcp: () => mcp });
  const r = await conn.paged('t', {}, { pageSize: 150, maxPages: 10 });
  assert.equal(r.rows.length, 340);
  assert.equal(r.complete, true);
  assert.equal(mcp.calls.length, 3);
});

test('paged advances by returned_item_count when the server truncates', async () => {
  // Server holds 600 rows but only returns 120 per response (truncated wrapper).
  const total = 600;
  const mcp = fakeMcp(({ offset, limit }) => {
    const available = Math.max(0, Math.min(limit, total - offset));
    const returned = Math.min(available, 120);
    return { content: [block({ truncated: available > returned, original_item_count: available, returned_item_count: returned, items: rows(returned, offset) })] };
  });
  const conn = createConnector({ getMcp: () => mcp });
  const r = await conn.paged('t', {}, { pageSize: 150, maxPages: 20 });
  assert.equal(r.rows.length, total);
  assert.deepEqual(r.rows.map(x => x.id), rows(total).map(x => x.id));
  assert.equal(r.complete, true);
});

test('sharded splits the window and merges shards', async () => {
  const mcp = fakeMcp(({ date_from, date_to }) => ({ content: [block({ from: date_from, to: date_to })] }));
  const conn = createConnector({ getMcp: () => mcp });
  const r = await conn.sharded('t', {}, { from: '2026-09-01', to: '2026-09-30', shardDays: 7, pageSize: 150 });
  assert.equal(r.shards, 5);
  assert.equal(r.rows[0].from, '2026-09-01');
  assert.equal(r.rows[0].to, '2026-09-07');
  assert.equal(r.rows.at(-1).to, '2026-09-30');
});

test('retries once on a retryable error, then logs success', async () => {
  let n = 0;
  const mcp = { callTool: async () => { if (n++ === 0) throw { code: 'server_unavailable', retryable: true, retryAfterMs: 1 }; return { content: [block({ a: 1 })] }; } };
  const conn = createConnector({ getMcp: () => mcp });
  const r = await conn.call('t', {});
  assert.equal(r.rows.length, 1);
  assert.equal(conn.log[0].status, 'ok');
});

test('non-retryable errors propagate and are logged with their code', async () => {
  const mcp = { callTool: async () => { throw { code: 'tool_error', message: 'subscription required' }; } };
  const conn = createConnector({ getMcp: () => mcp });
  await assert.rejects(conn.call('t', {}), e => e.code === 'tool_error');
  assert.equal(conn.log[0].status, 'error');
  assert.equal(conn.log[0].code, 'tool_error');
});

test('no connector → not_granted', async () => {
  const conn = createConnector({ getMcp: () => null });
  await assert.rejects(conn.call('t', {}), e => e.code === 'not_granted');
});
