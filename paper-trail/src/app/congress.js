import { chamberHoldings, packHoldings, unpackHoldings } from '../model/chamber.js';
import { tradeFlows, packFlows, unpackFlows } from '../model/family.js';
import { influenceUniverse, influencePoints, packInfluence, unpackInfluence } from '../model/influence.js';
import { isSenator, isRepresentative } from '../core/committees.js';
import { isoDate, addDays } from '../core/util.js';

/**
 * Trades since `from` feed each chamber's estimate. The Senate files a few
 * thousand trades in six years; the House files that many in a few months
 * (managed accounts trade daily), so the House looks back to the start of
 * the current Congress to stay fast.
 */
export const CHAMBERS = {
  Senate: { from: '2020-01-01', since: 'since 2020', shardDays: 182, isCurrent: isSenator, doc: 'public/senate', cloudKey: 'senate', member: 'senator' },
  House: { from: '2025-01-03', since: 'since the 119th Congress began (3 January 2025)', shardDays: 31, isCurrent: isRepresentative, doc: 'public/house', cloudKey: 'house', member: 'representative' }
};
export const TRUMP_FROM = '2026-01-01';
const FRESH_MS = 20 * 3600e3;

/**
 * Loads a summary live from Quiver when the viewer has the connector and
 * saves it under `public/` so visitors without the connector still see the
 * last one. `store[key]` = { status, data, asOf, from, error }.
 */
function createLoader({ store, cloud, key, cloudKey, doc, unpack, fetch, from }) {
  const set = patch => store.set({ [key]: { ...(store.get()[key] || {}), ...patch } });
  let busy = null;
  let memo = { doc: undefined, data: null };
  const saved = () => {
    const d = store.get().cloud?.[cloudKey] || null;
    if (d !== memo.doc) memo = { doc: d, data: unpack(d) };
    return memo.data ? { data: memo.data, asOf: d.asOf, from: d.from, savedAt: d.savedAt } : null;
  };
  return {
    current() {
      const s = store.get()[key] || {};
      if (s.data) return { data: s.data, asOf: s.asOf, from: s.from, source: 'live' };
      const c = saved();
      return c ? { ...c, source: 'saved' } : null;
    },
    status: () => store.get()[key] || {},
    async load({ refresh = false } = {}) {
      const st = store.get();
      if (busy || st.caps.mcp !== 'on') return busy;
      if (!refresh && st[key]?.data) return null;
      // A copy saved in the last day is current enough: filings arrive weeks after the trades.
      const c = saved();
      if (!refresh && c && Date.now() - (c.savedAt || 0) < FRESH_MS) return null;
      set({ status: 'loading', error: null });
      busy = (async () => {
        try {
          const asOf = isoDate();
          const data = await fetch({ asOf, refresh });
          set({ status: 'done', data, asOf, from });
          cloud.savePublic(doc, data.pack(asOf));
        } catch (e) {
          set({ status: 'error', error: e });
        } finally {
          busy = null;
        }
      })();
      return busy;
    }
  };
}

/** Congress holdings by chamber, and the President's disclosed trades. */
export function createCongress({ store, quiver, cloud }) {
  const chambers = {};
  for (const [chamber, c] of Object.entries(CHAMBERS)) {
    chambers[chamber] = createLoader({
      store, cloud, key: `hold${chamber}`, cloudKey: c.cloudKey, doc: c.doc, from: c.from, unpack: unpackHoldings,
      fetch: async ({ asOf, refresh }) => {
        const res = await quiver.chamberTrades({ chamber, from: c.from, to: asOf, shardDays: c.shardDays, refresh });
        const data = chamberHoldings(res.rows, { chamber, isCurrent: c.isCurrent, asOf });
        Object.defineProperty(data, 'pack', { value: d => packHoldings(data, { asOf: d, from: c.from }) });
        return data;
      }
    });
  }
  const trump = createLoader({
    store, cloud, key: 'trump', cloudKey: 'families', doc: 'public/families', from: TRUMP_FROM, unpack: unpackFlows,
    fetch: async ({ asOf, refresh }) => {
      const res = await quiver.trumpTrades({ from: TRUMP_FROM, to: asOf, refresh });
      const data = tradeFlows(res.rows, { from: TRUMP_FROM });
      Object.defineProperty(data, 'pack', { value: d => packFlows(data, { asOf: d, from: TRUMP_FROM }) });
      return data;
    }
  });
  // Influence map: lobbying and contracts for the stocks Congress holds most. Needs a holdings estimate first.
  const influence = createLoader({
    store, cloud, key: 'influence', cloudKey: 'influence', doc: 'public/influence', from: null, unpack: unpackInfluence,
    fetch: async ({ asOf, refresh }) => {
      const hold = { Senate: chambers.Senate.current()?.data, House: chambers.House.current()?.data };
      const universe = influenceUniverse(hold);
      if (!universe.length) throw { code: 'not_ready', message: 'Congress holdings are not loaded yet.' };
      const lobbying = new Map();
      const contracts = new Map();
      const year = +asOf.slice(0, 4);
      await Promise.all(universe.map(async u => {
        const [l, c] = await Promise.all([
          quiver.lobbying(u.ticker, { yearFrom: year - 1, refresh }).catch(() => ({ rows: [] })),
          quiver.contracts(u.ticker, { from: addDays(asOf, -365), to: asOf, refresh }).catch(() => ({ rows: [] }))
        ]);
        lobbying.set(u.ticker, l.rows);
        contracts.set(u.ticker, c.rows);
      }));
      const insiders = new Set(store.get().signals.filter(s => s.insider && s.insider.buyers && s.insider.buyers.length).map(s => s.ticker));
      const data = influencePoints(universe, { lobbying, contracts, asOf, insiders });
      Object.defineProperty(data, 'pack', { value: d => packInfluence(data, { asOf: d }) });
      return data;
    }
  });
  return { chambers, trump, influence };
}
