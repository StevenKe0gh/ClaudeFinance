import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';
import { createWorkspace, mergeSections, remoteSections, WORKSPACE_VERSION } from '../src/app/persist.js';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
beforeEach(() => mem.clear());

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

/** In-memory stand-in for the viewer's `data/users/<id>` collection. */
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const fail = [];
  const writes = [];
  let listener = null;
  const emit = () => listener && listener({ docs: [...docs].map(([id, body]) => ({ id, exists: true, data: () => body })) });
  const col = {
    doc: id => ({
      async set(body) {
        if (fail.length) throw fail.shift();
        writes.push(id);
        docs.set(id, JSON.parse(JSON.stringify(body)));
        queueMicrotask(emit);
      }
    }),
    onSnapshot(next) { listener = next; queueMicrotask(emit); return () => { listener = null; }; }
  };
  return { docs, fail, writes, db: { collection: () => col } };
}
const user = { id: async () => 'u1' };
const section = (value, at) => ({ v: WORKSPACE_VERSION, at, value });

test('mergeSections keeps edits to different sections from two devices', () => {
  const laptop = { watch: [{ ticker: 'GME' }, { ticker: 'BORR' }], brokers: { use: ['scalable'] } };
  const at = { watch: 200, brokers: 100 };
  const phone = { watch: { value: [{ ticker: 'GME' }], at: 150 }, brokers: { value: { use: ['scalable', 'revolut'] }, at: 300 } };
  const m = mergeSections(laptop, at, phone);
  assert.deepEqual(m.ws.watch, laptop.watch, 'the newer local plan stays');
  assert.deepEqual(m.ws.brokers, { use: ['scalable', 'revolut'] }, 'the newer remote broker choice comes in');
  assert.deepEqual(m.changed, ['brokers']);
  assert.deepEqual(m.push, ['watch']);
});

test('remoteSections falls back to the legacy single document', () => {
  const legacy = { id: 'workspace', data: { v: WORKSPACE_VERSION, updatedAt: 42, watch: [1], lastSeen: 'x' } };
  assert.deepEqual(remoteSections([legacy]), { watch: { value: [1], at: 42 }, lastSeen: { value: 'x', at: 42 } });
  const sec = { id: 'ws.watch', data: section([2], 50) };
  assert.deepEqual(remoteSections([legacy, sec]), { watch: { value: [2], at: 50 } }, 'sections win over the legacy copy');
});

test('first sync after the switch writes every legacy section and a mirror', async () => {
  const db = fakeDb({ workspace: { v: WORKSPACE_VERSION, updatedAt: 42, watch: [{ ticker: 'GME' }], brokers: { use: ['scalable'], marks: {} } } });
  const store = createStore({});
  const ws = createWorkspace({ store });
  await ws.attach(db.db, user);
  await settle();
  assert.deepEqual(store.get().workspace.watch, [{ ticker: 'GME' }]);
  assert.ok(db.docs.has('ws.watch') && db.docs.has('ws.brokers'));
  assert.equal(db.docs.get('ws.watch').at, 42);
  assert.equal(db.writes.at(-1), 'workspace');
  assert.equal(store.get().wsSync.mode, 'synced');
});

test('a failed write is retried and the page is told', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = fakeDb();
  const store = createStore({});
  const seen = [];
  const ws = createWorkspace({ store, onStatus: s => seen.push(s.mode) });
  await ws.attach(db.db, user);
  await settle();
  db.fail.push({ code: 'unavailable', message: 'offline' });
  ws.update({ watch: [{ ticker: 'BORR' }] });
  t.mock.timers.tick(900);
  await settle();
  assert.equal(store.get().wsSync.mode, 'retrying');
  assert.equal(store.get().wsSync.pending, 1);
  assert.ok(!db.docs.has('ws.watch'));
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(store.get().wsSync.mode, 'synced');
  assert.deepEqual(db.docs.get('ws.watch').value, [{ ticker: 'BORR' }]);
  assert.ok(seen.includes('retrying') && seen.at(-1) === 'synced');
});

test('a write that cannot succeed stops with an error instead of looping', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = fakeDb();
  const store = createStore({});
  const ws = createWorkspace({ store });
  await ws.attach(db.db, user);
  await settle();
  db.fail.push({ code: 'quota_exceeded', message: 'database full' });
  ws.update({ lastSeen: 'now' });
  t.mock.timers.tick(900);
  await settle();
  assert.equal(store.get().wsSync.mode, 'error');
  assert.equal(store.get().wsSync.error, 'database full');
  assert.equal(JSON.parse(mem.get('papertrail.workspace.v2')).lastSeen, 'now', 'the change is kept on this device');
});

test('a remote change to one section does not undo a pending local edit to another', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = fakeDb();
  const store = createStore({});
  const remote = [];
  const ws = createWorkspace({ store, onRemote: (_, changed) => remote.push(...changed) });
  await ws.attach(db.db, user);
  await settle();
  ws.update({ watch: [{ ticker: 'GME' }] });
  // Another device saves its brokers before this one's debounce fires.
  await db.db.collection().doc('ws.brokers').set(section({ use: ['revolut'], marks: {} }, Date.now() + 5));
  await settle();
  t.mock.timers.tick(900);
  await settle();
  assert.deepEqual(store.get().workspace.brokers, { use: ['revolut'], marks: {} });
  assert.deepEqual(db.docs.get('ws.watch').value, [{ ticker: 'GME' }]);
  assert.deepEqual(remote, ['brokers']);
});

test('a new viewer with nothing saved writes nothing, and the mirror is never read back', async () => {
  const db = fakeDb();
  const store = createStore({});
  const ws = createWorkspace({ store });
  await ws.attach(db.db, user);
  await settle();
  assert.deepEqual(db.writes, []);
  assert.deepEqual(remoteSections([{ id: 'workspace', data: { v: WORKSPACE_VERSION, mirror: true, updatedAt: 9, watch: [] } }]), {});
});
