import { isoDate } from '../core/util.js';
import { signalLine } from '../model/cards.js';

/**
 * Shared documents in the artifact's database, written by the daily job (or
 * the page itself) and read by every view:
 *
 *   logos/p<N>          { logos: { TICKER: dataUri } }           daily job
 *   quotes/latest       { asOf, q: { TICKER: [last, pct, mcapM] } } daily job
 *   prices/<TICKER>     { t: [date], c: [close], cur, name }     daily job (Yahoo)
 *   briefs/<date>       { headline, markdown, picks, alerts, steps } daily job
 *   jobs/status         { state, startedAt, finishedAt, steps, message }
 *   daily/<date>_<W>d   { date, w, top: [[ticker, score, tier]], cards: [[ticker, company, tier, score, line]], kpis } page
 *   portfolio/main      { positions, summary, importedAt }        page (import)
 *   portfolio/tx-<YYYY-MM> { rows }                               page (import)
 *   portfolio/overrides { map: { name: { ticker } } }             page
 *   config/app          { triggerId, schedule }                   setup
 *   members/track       { asOf, horizon, members: { bioguide: { n, ex, hit, score } } }  daily job (weekly)
 *   public/senate       estimated Senate holdings (model/chamber.js packHoldings)  owner's page
 *   public/house        estimated House holdings, same shape                      owner's page
 *   public/families     President Trump's disclosed trades by sector (model/family.js)  owner's page
 *   public/influence    lobbying and contracts of the stocks Congress holds most     owner's page
 *
 * Owner-only collections (portfolio, briefs, jobs, config) are enforced by
 * db rules declared at publish.
 */
export function createCloud({ store }) {
  let db = null;
  const unsubs = [];
  const prices = new Map();
  const pending = new Map();

  const set = patch => store.set({ cloud: { ...store.get().cloud, ...patch } });

  function watchCollection(path, fn, query = q => q) {
    try {
      unsubs.push(query(db.collection(path)).onSnapshot(snap => fn(snap.docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))), () => {}));
    } catch { /* invalid path or capability gone */ }
  }
  function watchDoc(path, fn) {
    try { unsubs.push(db.doc(path).onSnapshot(s => fn(s.exists ? s.data() : null), () => {})); } catch { /* ignore */ }
  }

  return {
    get ready() { return !!db; },
    attach(handle) {
      db = handle;
      if (!db) { set({ status: 'off' }); return; }
      set({ status: 'on' });
      watchCollection('logos', docs => {
        const map = {};
        for (const d of docs) Object.assign(map, d.logos || {});
        set({ logos: map, logoCount: Object.keys(map).length });
      });
      watchDoc('quotes/latest', d => set({ quotes: d }));
      watchDoc('jobs/status', d => set({ job: d }));
      watchDoc('members/track', d => set({ track: d }));
      watchDoc('config/app', d => set({ config: d }));
      watchDoc('public/senate', d => set({ senate: d }));
      watchDoc('public/house', d => set({ house: d }));
      watchDoc('public/families', d => set({ families: d }));
      watchDoc('public/influence', d => set({ influence: d }));
      watchCollection('briefs', docs => set({ briefs: docs.sort((a, b) => (a.id < b.id ? 1 : -1)) }), q => q.orderBy('date', 'desc').limit(30));
      watchCollection('daily', docs => set({ snapshots: docs }), q => q.orderBy('date', 'desc').limit(20));
      watchCollection('portfolio', docs => {
        const main = docs.find(d => d.id === 'main') || null;
        const overrides = (docs.find(d => d.id === 'overrides') || {}).map || {};
        const tx = docs.filter(d => d.id.startsWith('tx-')).flatMap(d => d.rows || []).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        set({ portfolio: main ? { ...main, transactions: tx, overrides } : { positions: [], transactions: tx, overrides, summary: {} }, portfolioLoaded: true });
      });
    },
    detach() { while (unsubs.length) unsubs.pop()(); },

    /** Yahoo price history for one ticker, cached for the session. */
    async prices(ticker) {
      if (!db) return null;
      if (prices.has(ticker)) return prices.get(ticker);
      if (pending.has(ticker)) return pending.get(ticker);
      const p = db.doc(`prices/${ticker}`).get().then(s => {
        const v = s.exists ? s.data() : null;
        prices.set(ticker, v);
        pending.delete(ticker);
        return v;
      }).catch(() => { pending.delete(ticker); return null; });
      pending.set(ticker, p);
      return p;
    },

    /** Daily snapshot of the top signals, once per day and window. */
    async saveSnapshot({ signals, asOf, windowDays, model, kpis }) {
      if (!db) return false;
      const id = `${asOf}_${windowDays}d`;
      const existing = (store.get().cloud.snapshots || []).find(s => s.id === id);
      if (existing && Date.now() - (existing.savedAt || 0) < 3 * 3600e3) return false;
      // `cards` lets visitors without the connector see why the strongest signals rank.
      const cards = signals.filter(s => s.tier === 'A' || s.tier === 'B').slice(0, 16).map(s => [s.ticker, s.company || '', s.tier, s.score, signalLine(s)]);
      const body = { date: asOf, w: windowDays, model: model.preset, savedAt: Date.now(), kpis, top: signals.slice(0, 120).map(s => [s.ticker, s.score, s.tier]), cards };
      try { await db.doc(`daily/${id}`).set(body); return true; } catch { return false; }
    },

    /** Shared summaries visitors without the connector read (only the owner's page may write them). */
    async savePublic(path, body) {
      if (!db) return false;
      try { await db.doc(path).set(body); return true; } catch { return false; }
    },

    /** Saves an imported portfolio: positions and summary in one doc, transactions by month. */
    async savePortfolio({ positions, summary, transactions }) {
      if (!db) throw { code: 'unavailable', message: 'Saving needs the claude.ai viewer.' };
      await db.doc('portfolio/main').set({ positions, summary, importedAt: new Date().toISOString(), source: 'finanzfluss-paste' });
      const byMonth = new Map();
      for (const t of transactions) { const m = t.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(t); }
      for (const [m, rows] of byMonth) await db.doc(`portfolio/tx-${m}`).set({ month: m, rows });
      return { months: byMonth.size };
    },
    async saveOverrides(map) {
      if (!db) return;
      await db.doc('portfolio/overrides').set({ map, updatedAt: Date.now() });
    },
    async markJobRequested() {
      if (!db) return;
      try { await db.doc('jobs/status').update({ requestedAt: Date.now() }); } catch { /* doc may not exist yet */ }
    },
    today: () => isoDate()
  };
}
