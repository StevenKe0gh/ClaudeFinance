/**
 * Minimal observable store. `set` shallow-merges a patch and notifies
 * subscribers with the list of top-level keys that changed, so views can
 * skip work that does not concern them.
 */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.keys(next).filter(k => next[k] !== state[k]);
      if (!changed.length) return;
      state = { ...state, ...next };
      for (const fn of subs) fn(state, changed);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

/** Tiny pub/sub for app-wide events (navigation, toasts, selection). */
export function createBus() {
  const m = new Map();
  return {
    on(type, fn) {
      if (!m.has(type)) m.set(type, new Set());
      m.get(type).add(fn);
      return () => m.get(type).delete(fn);
    },
    emit(type, payload) {
      for (const fn of m.get(type) || []) fn(payload);
    }
  };
}
