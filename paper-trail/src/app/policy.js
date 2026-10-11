import { addDays, isoDate } from '../core/util.js';
import { cleanFeedItem, cleanBill, cleanContract, policyIndex } from '../model/policy.js';

export const CONTRACT_DAYS = 60;
export const CONTRACT_MIN = 1e7;
export const DEFAULT_TOPICS = ['Diesel', 'Russia', 'Sanction', 'Tariff', 'Defense', 'Semiconductor'];

/**
 * Loads the policy monitor's data into store.policy: the newest bill
 * introductions (with the tickers Quiver tagged), federal awards of $10M+
 * over 60 days, and per-topic bill searches on demand.
 */
export function createPolicy({ store, quiver }) {
  let memo = { feed: null, awards: null, idx: new Map() };
  const set = patch => store.set({ policy: { ...store.get().policy, ...patch } });

  async function load({ refresh = false } = {}) {
    const cur = store.get().policy;
    if (cur.status === 'loading') return;
    set({ status: 'loading', error: null });
    const asOf = isoDate();
    const [feed, awards] = await Promise.allSettled([
      quiver.legislationFeed({ pages: 3, refresh }),
      quiver.recentContracts({ from: addDays(asOf, -CONTRACT_DAYS), to: asOf, minAmount: CONTRACT_MIN, refresh })
    ]);
    const items = feed.status === 'fulfilled' ? dedupe(feed.value.rows.map(cleanFeedItem)) : store.get().policy.feed;
    const rows = awards.status === 'fulfilled' ? awards.value.rows.map(cleanContract).filter(a => a.ticker) : store.get().policy.awards;
    const err = feed.status === 'rejected' ? feed.reason : awards.status === 'rejected' ? awards.reason : null;
    set({ status: err && !items.length && !rows.length ? 'error' : 'done', error: err, feed: items, awards: rows, loadedAt: Date.now(), asOf });
  }

  async function topic(term, { refresh = false } = {}) {
    const key = term.toLowerCase();
    const topics = { ...store.get().policy.topics };
    if (topics[key]?.status === 'loading') return;
    topics[key] = { ...(topics[key] || {}), status: 'loading' };
    set({ topics });
    try {
      // Quiver sorts bills by Congress, not date, so read deep enough to find the newest of a broad topic.
      const r = await quiver.bills(term, { pages: 4, refresh });
      const bills = dedupe(r.rows.map(cleanBill)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.stage.step - a.stage.step);
      set({ topics: { ...store.get().policy.topics, [key]: { status: 'done', bills, complete: r.complete, at: Date.now() } } });
    } catch (e) {
      set({ topics: { ...store.get().policy.topics, [key]: { status: 'error', error: e, bills: [] } } });
    }
  }

  /** Memoised ticker → {bills, contracts} index over the loaded feed and awards. */
  function index() {
    const p = store.get().policy;
    if (memo.feed !== p.feed || memo.awards !== p.awards) memo = { feed: p.feed, awards: p.awards, idx: policyIndex({ feed: p.feed, awards: p.awards }) };
    return memo.idx;
  }

  return { load, topic, index, for: t => index().get(t) || null };
}

export const EMPTY_POLICY = Object.freeze({ status: 'idle', error: null, feed: [], awards: [], loadedAt: 0, asOf: null, topics: {} });

function dedupe(items) {
  const seen = new Set();
  return items.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
