import { CONVERGENCE_DAYS, ENRICH_TOP_N } from '../core/config.js';
import { isoDate, addDays, debounce } from '../core/util.js';
import { cleanInsider, cleanCongress, cleanTicker, mergeDrops } from '../model/clean.js';
import { buildSignals } from '../model/score.js';

const STAGES = [
  { key: 'insider', label: 'Form 4 purchases' },
  { key: 'congress', label: 'Congressional trades' },
  { key: 'aggregate', label: 'Congress aggregates' },
  { key: 'score', label: 'Clean + score' },
  { key: 'enrich', label: 'Insider-selling check' }
];

/**
 * Ingest → clean → score → enrich. Each stage reports status, row counts
 * and timing into the store for the status bar and the Lineage view.
 * A newer run supersedes an older one (generation counter).
 */
export function createPipeline({ store, quiver }) {
  let gen = 0;

  const setStage = (g, key, patch) => {
    if (g !== gen) return;
    const p = store.get().pipeline;
    store.set({ pipeline: { ...p, stages: p.stages.map(s => (s.key === key ? { ...s, ...patch } : s)) } });
  };

  function recompute() {
    const { data, enrichment, session, model } = store.get();
    if (!data) return;
    const signals = buildSignals({
      insiderBuys: data.insiderBuys,
      congressRows: data.congressRows,
      congressAgg: data.congressAgg,
      convergence90: data.convergence90,
      enrichment,
      asOf: data.asOf,
      windowDays: data.windowDays,
      model,
      lastSeen: (session && session.lastSeenPrev) || null
    });
    store.set({ signals });
  }
  const recomputeSoon = debounce(recompute, 120);

  async function timed(g, key, fn) {
    const t0 = performance.now();
    setStage(g, key, { status: 'running' });
    try {
      const r = await fn();
      setStage(g, key, { status: r.complete === false ? 'partial' : 'done', rows: r.rows.length, pages: r.pages, ms: Math.round(performance.now() - t0) });
      return r;
    } catch (e) {
      setStage(g, key, { status: 'error', error: e, ms: Math.round(performance.now() - t0) });
      throw e;
    }
  }

  async function run({ refresh = false } = {}) {
    const g = ++gen;
    const windowDays = store.get().windowDays;
    const asOf = isoDate();
    const from = addDays(asOf, -(windowDays - 1));
    const convFrom = addDays(asOf, -(CONVERGENCE_DAYS - 1));
    store.set({
      pipeline: { status: 'running', startedAt: Date.now(), finishedAt: null, error: null, stages: STAGES.map(s => ({ ...s, status: 'pending', rows: 0, ms: 0 })) },
      enrichment: new Map()
    });

    const [ins, cong, agg, agg90] = await Promise.allSettled([
      timed(g, 'insider', () => quiver.insiderPurchases({ from, to: asOf, refresh })),
      timed(g, 'congress', () => quiver.congressTrades({ from, to: asOf, refresh })),
      timed(g, 'aggregate', () => quiver.congressByTicker({ from, to: asOf, refresh })),
      windowDays >= CONVERGENCE_DAYS ? Promise.resolve(null) : quiver.congressByTicker({ from: convFrom, to: asOf, refresh })
    ]);
    if (g !== gen) return;

    const failures = [ins, cong, agg].filter(r => r.status === 'rejected');
    if (failures.length === 3) {
      store.set({ pipeline: { ...store.get().pipeline, status: 'error', error: failures[0].reason, finishedAt: Date.now() } });
      return;
    }

    const t0 = performance.now();
    setStage(g, 'score', { status: 'running' });
    const ci = ins.status === 'fulfilled' ? cleanInsider(ins.value.rows, { from, to: asOf }) : { rows: [], dropped: {} };
    const cc = cong.status === 'fulfilled' ? cleanCongress(cong.value.rows) : { rows: [], dropped: {} };
    const toMap = rows => {
      const m = new Map();
      for (const r of rows || []) {
        const t = cleanTicker(r.ticker);
        if (!t) continue;
        m.set(t, { buys: +r.purchase_count || 0, sells: +r.sale_count || 0, buyVol: +r.purchase_volume || 0, sellVol: +r.sale_volume || 0, company: r.company || '' });
      }
      return m;
    };
    const congressAgg = agg.status === 'fulfilled' ? toMap(agg.value.rows) : new Map();
    const aggLong = agg90.status === 'fulfilled' && agg90.value ? toMap(agg90.value.rows) : congressAgg;
    const convergence90 = new Map([...aggLong].map(([t, a]) => [t, a.buys]));

    store.set({
      data: {
        asOf, windowDays, from,
        insiderBuys: ci.rows,
        congressRows: cc.rows,
        congressAgg,
        convergence90,
        drops: mergeDrops(ci.dropped, cc.dropped),
        rawCounts: {
          insider: ins.status === 'fulfilled' ? ins.value.rows.length : 0,
          congress: cong.status === 'fulfilled' ? cong.value.rows.length : 0,
          aggregate: congressAgg.size
        },
        coverage: {
          insider: ins.status === 'fulfilled' ? ins.value.complete : false,
          congress: cong.status === 'fulfilled' ? cong.value.complete : false
        },
        failures: failures.map(f => f.reason),
        fetchedAt: Date.now()
      }
    });
    recompute();
    setStage(g, 'score', { status: 'done', rows: store.get().signals.length, ms: Math.round(performance.now() - t0) });
    store.set({ pipeline: { ...store.get().pipeline, status: 'done', finishedAt: Date.now() } });

    await enrich(g, { asOf, refresh });
  }

  /** Pulls 90 days of all Form 4 activity for the top names to detect net selling. */
  async function enrich(g, { asOf, refresh }) {
    const top = store.get().signals.filter(s => s.insider.buyers.length).slice(0, ENRICH_TOP_N);
    if (!top.length) { setStage(g, 'enrich', { status: 'done', rows: 0 }); return; }
    const t0 = performance.now();
    setStage(g, 'enrich', { status: 'running', detail: `0 / ${top.length}` });
    let done = 0;
    let rows = 0;
    await Promise.all(top.map(async s => {
      try {
        const r = await quiver.tickerInsider(s.ticker, { from: addDays(asOf, -89), to: asOf, refresh, maxPages: 2, stage: 'enrich' });
        if (g !== gen) return;
        const { rows: clean } = cleanInsider(r.rows, { to: asOf });
        rows += clean.length;
        const buyUsd = clean.filter(x => x.transaction_type === 'P').reduce((a, x) => a + x.value, 0);
        const sales = clean.filter(x => x.transaction_type === 'S');
        const next = new Map(store.get().enrichment);
        next.set(s.ticker, { buyUsd, sellUsd: sales.reduce((a, x) => a + x.value, 0), sells: sales.length, complete: r.complete });
        store.set({ enrichment: next });
        recomputeSoon();
      } catch { /* enrichment is best-effort; the base signal stands */ }
      done++;
      setStage(g, 'enrich', { detail: `${done} / ${top.length}` });
    }));
    if (g !== gen) return;
    recomputeSoon.flush();
    setStage(g, 'enrich', { status: 'done', rows, ms: Math.round(performance.now() - t0) });
  }

  return { run, recompute };
}
