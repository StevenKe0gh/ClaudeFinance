import { debounce } from '../core/util.js';

const KEY = 'papertrail.workspace.v2';
const AT_KEY = 'papertrail.workspace.at';
export const WORKSPACE_VERSION = 2;

export const DEFAULT_WORKSPACE = Object.freeze({
  v: WORKSPACE_VERSION,
  watch: [],
  portfolio: { capital: 10000, reserve: 10, cap: 20, method: 'conviction' },
  model: null,
  lastSeen: null,
  updatedAt: 0
});

/** Fields of the workspace object that are bookkeeping, not sections. */
const META = new Set(['v', 'updatedAt', 'mirror']);
const PREFIX = 'ws.';
/** The read-only copy of the whole workspace that the daily job reads. */
const MIRROR = 'workspace';
/** Write errors that retrying cannot fix. */
const FATAL = new Set(['invalid_argument', 'transform_error', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed']);
const RETRY_MIN = 2000;
const RETRY_MAX = 60000;

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable: keep in memory */ }
}
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/**
 * Remote section documents (`ws.<key>`: `{ v, key, at, value }`) from one
 * snapshot of the viewer's collection. Without any, a legacy single
 * `workspace` document stands in, every section stamped with its
 * `updatedAt`.
 */
export function remoteSections(docs) {
  const out = {};
  let legacy = null;
  for (const d of docs) {
    if (!d || !d.data) continue;
    if (d.id === MIRROR) { legacy = d.data; continue; }
    if (!d.id.startsWith(PREFIX) || d.data.v !== WORKSPACE_VERSION) continue;
    out[d.id.slice(PREFIX.length)] = { value: d.data.value ?? null, at: +d.data.at || 0 };
  }
  // The mirror this module writes is never read back; only a pre-section document is.
  if (Object.keys(out).length || !legacy || legacy.v !== WORKSPACE_VERSION || legacy.mirror) return out;
  for (const [k, value] of Object.entries(legacy)) if (!META.has(k)) out[k] = { value, at: +legacy.updatedAt || 0 };
  return out;
}

/**
 * Section-by-section merge: for each section the newer stamp wins, so an
 * edit to the plan on one device and to the brokers on another both
 * survive. Returns the merged workspace and stamps, the sections taken
 * from remote (`changed`) and the local ones remote lacks or has older
 * (`push`).
 */
export function mergeSections(ws, at, remote) {
  const next = { ...ws };
  const stamps = { ...at };
  const changed = [];
  const push = [];
  for (const [k, r] of Object.entries(remote)) {
    if (r.at > (stamps[k] || 0)) { next[k] = r.value; stamps[k] = r.at; changed.push(k); }
    else if ((stamps[k] || 0) > r.at) push.push(k);
  }
  for (const k of Object.keys(stamps)) if (!(k in remote) && !META.has(k)) push.push(k);
  if (changed.length) next.updatedAt = Math.max(ws.updatedAt || 0, ...changed.map(k => stamps[k]));
  return { ws: next, at: stamps, changed, push };
}

/**
 * Workspace persistence: the viewer's plan, portfolio settings, brokers,
 * model weights and last visit. Primary store is the artifact's `db`
 * (private per viewer, synced across devices), one document per section
 * so edits on two devices to different sections never overwrite each
 * other; localStorage is the offline copy. A failed write is retried with
 * backoff and the sync state is published as `store.wsSync` so the page
 * can say when changes are only on this device.
 */
export function createWorkspace({ store, onRemote, onStatus }) {
  let col = null;
  let unsub = null;
  let mode = 'memory';
  let at = readJson(AT_KEY) || {};
  const dirty = new Set();
  let mirrorDirty = false;
  let pumping = false;
  let retryMs = 0;
  let retryTimer = 0;
  let lastError = '';

  const local = readJson(KEY);
  const usable = local && local.v === WORKSPACE_VERSION ? local : null;
  store.set({ workspace: { ...DEFAULT_WORKSPACE, ...(usable || {}) } });
  if (usable) mode = 'local';

  const status = () => ({ mode, pending: dirty.size, error: lastError });
  const setMode = (m, err = '') => {
    const was = mode;
    mode = m;
    lastError = err;
    store.set({ wsSync: status() });
    if (was !== m && onStatus) onStatus(status(), was);
  };
  store.set({ wsSync: status() });

  const saveLocal = () => { writeJson(KEY, store.get().workspace); writeJson(AT_KEY, at); };

  /** Writes dirty sections one at a time, then the mirror; on failure keeps them dirty and retries. */
  async function pump() {
    if (pumping || !col) return;
    pumping = true;
    clearTimeout(retryTimer);
    try {
      if (dirty.size) setMode('saving');
      while (dirty.size) {
        const k = dirty.values().next().value;
        const ws = store.get().workspace;
        await col.doc(PREFIX + k).set({ v: WORKSPACE_VERSION, key: k, at: at[k] || 0, value: clone(ws[k]) });
        // A newer edit to the same section during the write leaves it dirty for another pass.
        if (store.get().workspace[k] === ws[k]) dirty.delete(k);
        mirrorDirty = true;
      }
      if (mirrorDirty) {
        mirrorDirty = false;
        await col.doc(MIRROR).set({ ...clone(store.get().workspace), mirror: true });
      }
      retryMs = 0;
      setMode('synced');
    } catch (e) {
      const code = e && e.code;
      const msg = (e && e.message) || 'write failed';
      if (FATAL.has(code)) { setMode('error', msg); return; }
      retryMs = Math.min(retryMs ? retryMs * 2 : RETRY_MIN, RETRY_MAX);
      setMode('retrying', msg);
      retryTimer = setTimeout(pump, retryMs);
    } finally {
      pumping = false;
    }
    if (dirty.size && mode === 'synced') pump();
  }
  const save = debounce(() => { saveLocal(); pump(); }, 900);

  function onDocs(docs) {
    const cur = store.get().workspace;
    const remote = remoteSections(docs);
    const m = mergeSections(cur, at, remote);
    at = m.at;
    for (const k of m.push) dirty.add(k);
    // First visit after the switch to sections: write every section the legacy document had.
    if (!docs.some(d => d.id.startsWith(PREFIX))) for (const k of Object.keys(remote)) dirty.add(k);
    if (m.changed.length) {
      store.set({ workspace: { ...DEFAULT_WORKSPACE, ...m.ws } });
      saveLocal();
      onRemote && onRemote(store.get().workspace, m.changed);
    }
    if (dirty.size) pump();
  }

  function subscribe() {
    unsub = col.onSnapshot(
      qs => onDocs(qs.docs.filter(d => d.exists).map(d => ({ id: d.id, data: d.data() }))),
      e => {
        unsub = null;
        // The bridge stopped answering: a fresh subscription is the only recovery.
        if (e && e.code === 'unavailable') { setMode('retrying', e.message || 'connection lost'); setTimeout(() => col && subscribe(), RETRY_MIN); return; }
        setMode('error', (e && e.message) || 'sync stopped');
      }
    );
  }

  return {
    get mode() { return mode; },
    get pending() { return dirty.size; },
    update(patch) {
      const now = Date.now();
      for (const k of Object.keys(patch)) if (!META.has(k)) { at[k] = Math.max(now, (at[k] || 0) + 1); dirty.add(k); }
      const cur = store.get().workspace;
      if (!col && mode === 'memory') mode = 'local';
      store.set({ workspace: { ...cur, ...patch, updatedAt: now }, wsSync: status() });
      save();
    },
    /** Write pending changes now (page hidden or closing). */
    flush: () => save.flush(),
    async attach(db, user) {
      if (!db || !user) return;
      const id = await user.id().catch(() => null);
      if (!id) return;
      try { col = db.collection(`data/users/${id}`); } catch { col = null; return; }
      setMode(dirty.size ? 'saving' : 'synced');
      subscribe();
    },
    detach() { unsub && unsub(); unsub = null; col = null; clearTimeout(retryTimer); }
  };
}
