import { debounce } from '../core/util.js';

const KEY = 'papertrail.workspace.v2';
export const WORKSPACE_VERSION = 2;

export const DEFAULT_WORKSPACE = Object.freeze({
  v: WORKSPACE_VERSION,
  watch: [],
  portfolio: { capital: 10000, reserve: 10, cap: 20, method: 'conviction' },
  model: null,
  lastSeen: null,
  updatedAt: 0
});

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.v === WORKSPACE_VERSION ? v : null;
  } catch { return null; }
}
function writeLocal(ws) {
  try { localStorage.setItem(KEY, JSON.stringify(ws)); } catch { /* storage unavailable: keep in memory */ }
}

/**
 * Workspace persistence: the viewer's watchlist, portfolio settings, model
 * weights and last visit. Primary store is the artifact's `db` (private per
 * viewer, synced across devices); localStorage is the offline fallback.
 * Writes are coalesced and serialised, one at a time per document.
 */
export function createWorkspace({ store, onRemote }) {
  let ref = null;
  let unsub = null;
  let writing = Promise.resolve();
  let mode = 'memory';

  const local = readLocal();
  store.set({ workspace: { ...DEFAULT_WORKSPACE, ...(local || {}) } });
  if (local) mode = 'local';

  const flush = async () => {
    const ws = store.get().workspace;
    writeLocal(ws);
    if (!ref) return;
    writing = writing.then(() => ref.set(JSON.parse(JSON.stringify(ws)))).catch(() => { mode = 'local'; ref = null; });
    await writing;
  };
  const save = debounce(flush, 900);

  return {
    get mode() { return mode; },
    update(patch) {
      const cur = store.get().workspace;
      store.set({ workspace: { ...cur, ...patch, updatedAt: Date.now() } });
      save();
    },
    flush: () => save.flush(),
    async attach(db, user) {
      if (!db || !user) return;
      const id = await user.id().catch(() => null);
      if (!id) return;
      try { ref = db.doc(`data/users/${id}/workspace`); } catch { ref = null; return; }
      mode = 'synced';
      unsub = ref.onSnapshot(snap => {
        if (!snap.exists) { if (store.get().workspace.updatedAt) flush(); return; }
        const remote = snap.data();
        if (!remote || remote.v !== WORKSPACE_VERSION) return;
        const cur = store.get().workspace;
        if ((remote.updatedAt || 0) > (cur.updatedAt || 0)) {
          store.set({ workspace: { ...DEFAULT_WORKSPACE, ...remote } });
          writeLocal(remote);
          onRemote && onRemote(remote);
        }
      }, () => { mode = 'local'; ref = null; });
    },
    detach() { unsub && unsub(); }
  };
}
