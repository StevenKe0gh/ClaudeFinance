import { directory } from '../core/directory.js';
import { addDays, isoDate, sum } from '../core/util.js';
import { resolveInstrument, shortInstrument } from '../model/instruments.js';
import { analyzeTrades } from '../model/trades.js';
import { cleanInsider, cleanCongress } from '../model/clean.js';

const LOCAL_KEY = 'papertrail.portfolio.v1';

/**
 * The imported depot (positions, key figures, transactions) and everything
 * derived from it. The source of truth is the owner-only `portfolio`
 * collection in the artifact database; outside claude.ai the import lives in
 * this browser's storage instead.
 */
export function createPortfolio({ store, quiver, cloud }) {
  let memo = { key: null, value: null };
  const checks = new Map();
  let checking = null;

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { return null; }
  }

  /** Current raw portfolio: cloud first, then this browser. */
  function raw() {
    const c = store.get().cloud || {};
    if (c.portfolio && (c.portfolio.positions?.length || c.portfolio.transactions?.length)) return { ...c.portfolio, where: 'cloud' };
    const l = readLocal();
    if (l) return { ...l, overrides: l.overrides || {}, where: 'local' };
    return null;
  }

  /** Positions resolved to instruments, plus the trade review. Memoised on input identity. */
  function derived() {
    const p = raw();
    if (!p) return null;
    const key = `${p.importedAt}|${p.transactions?.length}|${JSON.stringify(p.overrides || {})}|${p.where}`;
    if (memo.key === key) return memo.value;
    const overrides = p.overrides || {};
    const resolve = (name, assetType) => resolveInstrument(name, { assetType, directory, overrides });
    const positions = (p.positions || []).map(pos => ({ ...pos, inst: resolve(pos.name, pos.type), short: shortInstrument(pos.name) }));
    const asOf = (p.importedAt || '').slice(0, 10) || isoDate();
    const review = analyzeTrades(p.transactions || [], p.positions || [], { asOf, summary: p.summary || {}, resolve });
    const total = sum(positions, x => x.value);
    const value = { ...p, positions, review, total, resolve, asOf, usTickers: [...new Set(positions.filter(x => x.inst.us && x.inst.ticker).map(x => x.inst.ticker))] };
    memo = { key, value };
    return value;
  }

  async function save({ positions, summary, transactions }) {
    if (cloud.ready) return cloud.savePortfolio({ positions, summary, transactions });
    const prev = readLocal() || {};
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ positions, summary, transactions, overrides: prev.overrides || {}, importedAt: new Date().toISOString() })); } catch { throw { message: 'This browser blocked local storage, so the import could not be kept.' }; }
    store.set({ portfolioLocalAt: Date.now() });
    return { months: new Set(transactions.map(t => t.date.slice(0, 7))).size };
  }

  async function setOverride(name, value) {
    const p = raw() || {};
    const map = { ...(p.overrides || {}) };
    if (value) map[name] = value; else delete map[name];
    if (cloud.ready && p.where !== 'local') return cloud.saveOverrides(map);
    const l = readLocal() || {};
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...l, overrides: map })); } catch { /* ignore */ }
    store.set({ portfolioLocalAt: Date.now() });
  }

  /**
   * Insider and congressional activity for every US-listed holding: 90 days
   * of Form 4 lines and 12 months of congressional trades. Results stream
   * into the store as they arrive.
   */
  function check({ refresh = false } = {}) {
    const d = derived();
    if (!d || !quiver) return Promise.resolve();
    if (checking && !refresh) return checking;
    const asOf = isoDate();
    const tickers = d.usTickers;
    store.set({ holdingChecks: { status: 'running', done: 0, total: tickers.length, at: Date.now() } });
    let done = 0;
    checking = Promise.all(tickers.map(async t => {
      if (!refresh && checks.has(t) && Date.now() - checks.get(t).at < 30 * 60e3) { done++; return; }
      const out = { ticker: t, at: Date.now(), error: null };
      try {
        const [ins, cg] = await Promise.all([
          quiver.tickerInsider(t, { from: addDays(asOf, -90), to: asOf, refresh, maxPages: 2, stage: 'holdings' }).then(r => cleanInsider(r.rows, { to: asOf }).rows),
          quiver.tickerCongress(t, { from: addDays(asOf, -365), refresh }).then(r => cleanCongress(r.rows).rows)
        ]);
        const P = ins.filter(r => r.transaction_type === 'P');
        const S = ins.filter(r => r.transaction_type === 'S');
        const CB = cg.filter(r => r.kind === 'buy' && !r.wash);
        const CS = cg.filter(r => r.kind === 'sell' && !r.wash);
        Object.assign(out, {
          buys: P.length, buyUsd: sum(P, r => r.value), buyers: [...new Set(P.map(r => r.owner))],
          sells: S.length, sellUsd: sum(S, r => r.value), sellers: [...new Set(S.map(r => r.owner))],
          cBuys: CB.length, cSells: CS.length, members: [...new Set(CB.map(r => r.representative))],
          lastBuy: P[0]?.date || null, lastCongress: cg[0]?.traded || null
        });
      } catch (e) { out.error = e || { code: 'upstream_error' }; }
      checks.set(t, out);
      done++;
      store.set({ holdingChecks: { status: done >= tickers.length ? 'done' : 'running', done, total: tickers.length, at: Date.now(), map: new Map(checks) } });
    })).finally(() => { checking = null; });
    return checking;
  }

  return { raw, derived, save, setOverride, check, checks: () => checks };
}

/** Human-readable alerts from a holdings check. */
export function holdingAlerts(d, checks, signals = []) {
  if (!d) return [];
  const out = [];
  const sig = new Map(signals.map(s => [s.ticker, s]));
  for (const pos of d.positions) {
    const t = pos.inst.us ? pos.inst.ticker : null;
    if (!t) continue;
    const c = checks && checks.get(t);
    const s = sig.get(t);
    if (s && (s.tier === 'A' || s.tier === 'B')) out.push({ tone: 'pos', ticker: t, name: pos.short, text: `In today's screen at tier ${s.tier} (score ${s.score}): ${s.flags.slice(0, 2).map(f => f.label).join(', ') || 'insider or congressional buying'}.` });
    if (!c || c.error) continue;
    if (c.buyUsd > 0 && c.buyUsd >= c.sellUsd) out.push({ tone: 'pos', ticker: t, name: pos.short, text: `${c.buyers.length} insider${c.buyers.length > 1 ? 's' : ''} bought ${fmtK(c.buyUsd)} in 90 days${c.sellUsd ? `, against ${fmtK(c.sellUsd)} sold` : ''}.` });
    else if (c.sellUsd >= 1e6 && c.sellUsd > 3 * (c.buyUsd || 0)) out.push({ tone: 'warn', ticker: t, name: pos.short, text: `Insiders sold ${fmtK(c.sellUsd)} in 90 days (${c.sellers.length} seller${c.sellers.length > 1 ? 's' : ''})${c.buyUsd ? ` and bought ${fmtK(c.buyUsd)}` : ', no open-market buys'}. Often routine for large caps; worth a look if it is new.` });
    if (c.cBuys >= 2) out.push({ tone: 'pos', ticker: t, name: pos.short, text: `${c.cBuys} congressional purchases in 12 months (${c.members.slice(0, 3).join(', ')}${c.members.length > 3 ? '…' : ''}).` });
    if (c.cSells >= 3 && c.cSells > 2 * c.cBuys) out.push({ tone: 'warn', ticker: t, name: pos.short, text: `${c.cSells} congressional sales against ${c.cBuys} purchases in 12 months.` });
  }
  const order = { neg: 0, warn: 1, pos: 2, info: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

function fmtK(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
