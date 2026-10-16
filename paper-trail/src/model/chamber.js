import { amountRange, cleanTicker, partyOf } from './clean.js';
import { dayDiff } from '../core/util.js';

/**
 * What sitting members of one chamber most likely hold, estimated from the
 * trades they disclosed. Members report trades (STOCK Act), not a live
 * portfolio, so a position counts as held when the member, a spouse or a child bought it
 * and has not reported a full sale since. A partial sale keeps it held; a
 * partial sale with no earlier purchase in the window means it was owned
 * before the window began (size unknown). Sizes are purchase ranges at their
 * midpoints, at cost: what was put in, not today's value.
 */

/** "Tuberville, Tommy" → "Tommy Tuberville"; suffixes stay at the end. */
export function displayName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  const i = s.indexOf(',');
  if (i < 0) return s;
  let last = s.slice(0, i).trim();
  let first = s.slice(i + 1).trim();
  const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV)$/i;
  let suffix = '';
  for (const part of ['last', 'first']) {
    const v = part === 'last' ? last : first;
    const m = SUFFIX.exec(v);
    if (m) { suffix = m[1]; if (part === 'last') last = v.slice(0, m.index); else first = v.slice(0, m.index); }
  }
  return [first, last, suffix].filter(Boolean).join(' ');
}

const kindOf = t => {
  const s = String(t || '').toLowerCase();
  if (s.startsWith('purchase')) return 'buy';
  if (s.includes('full')) return 'exit';
  if (s.startsWith('sale')) return 'trim';
  return null;
};
const ORDER = { buy: 0, trim: 1, exit: 2 };

/**
 * @param rows Quiver congressional trades (`get_congress_trades`) for one chamber
 * @param opts.chamber 'Senate' | 'House'; rows from the other chamber are skipped
 * @param opts.isCurrent bioguide → true for a sitting member
 * @param opts.asOf YYYY-MM-DD, for the 90-day activity counts
 * @returns {{ stocks, members, positions }} stocks ranked by how many members hold them
 */
export function chamberHoldings(rows, { chamber = 'Senate', isCurrent = () => true, asOf = null } = {}) {
  const trades = [];
  for (const r of rows || []) {
    if (r.chamber && r.chamber !== chamber) continue;
    const ticker = cleanTicker(r.ticker);
    const kind = kindOf(r.transaction);
    if (!ticker || !kind || !r.traded || !isCurrent(r.bioguide_id)) continue;
    trades.push({ ...r, ticker, kind, mid: amountRange(r.amount).mid });
  }
  trades.sort((a, b) => (a.traded < b.traded ? -1 : a.traded > b.traded ? 1 : ORDER[a.kind] - ORDER[b.kind]));

  // One position per senator, stock and owner (self, spouse, child): a spouse's full sale does not close the senator's own shares.
  const pos = new Map();
  const companies = new Map();
  const recent = new Map();
  for (const t of trades) {
    const key = `${t.bioguide_id}|${t.ticker}|${t.owner || ''}`;
    let p = pos.get(key);
    if (!p) { p = { bioguide: t.bioguide_id, name: t.representative, party: partyOf(t.party), ticker: t.ticker, open: false, cost: 0, known: true, since: null }; pos.set(key, p); }
    if (t.kind === 'buy') {
      if (!p.open) { p.open = true; p.cost = 0; p.known = true; p.since = t.traded; }
      p.cost += t.mid;
    } else if (t.kind === 'trim') {
      if (!p.open) { p.open = true; p.cost = 0; p.known = false; p.since = null; }
      else p.cost = Math.max(0, p.cost - t.mid);
    } else {
      p.open = false;
      p.cost = 0;
    }
    p.last = { date: t.traded, kind: t.kind, amount: t.amount };
    if (t.company && !companies.has(t.ticker)) companies.set(t.ticker, t.company);
    if (asOf && dayDiff(t.traded, asOf) <= 90) {
      const a = recent.get(t.ticker) || { buys: 0, sells: 0 };
      if (t.kind === 'buy') a.buys++; else a.sells++;
      recent.set(t.ticker, a);
    }
  }

  // Merge owners into one holder per senator and stock.
  const byStock = new Map();
  for (const p of pos.values()) {
    if (!p.open) continue;
    const holders = byStock.get(p.ticker) || new Map();
    const h = holders.get(p.bioguide) || { bioguide: p.bioguide, name: displayName(p.name), filer: p.name, party: p.party, cost: 0, known: false, since: null, last: null };
    if (p.known) { h.cost += p.cost; h.known = true; }
    if (p.since && (!h.since || p.since < h.since)) h.since = p.since;
    if (!h.last || p.last.date > h.last.date) h.last = p.last;
    holders.set(p.bioguide, h);
    byStock.set(p.ticker, holders);
  }

  const stocks = [...byStock].map(([ticker, m]) => {
    const holders = [...m.values()].sort((a, b) => b.cost - a.cost);
    const parties = { D: 0, R: 0, I: 0 };
    for (const h of holders) if (parties[h.party] != null) parties[h.party]++;
    const last = holders.reduce((x, h) => (!x || h.last.date > x.date ? { ...h.last, name: h.name } : x), null);
    return { ticker, company: companies.get(ticker) || '', count: holders.length, parties, cost: holders.reduce((s, h) => s + h.cost, 0), holders, last, recent: recent.get(ticker) || { buys: 0, sells: 0 } };
  }).sort((a, b) => b.count - a.count || b.cost - a.cost || a.ticker.localeCompare(b.ticker));

  const members = new Set();
  for (const s of stocks) for (const h of s.holders) members.add(h.bioguide);
  return { stocks, members: members.size, positions: stocks.reduce((n, s) => n + s.count, 0) };
}

/** Compact form for the shared document visitors without the connector read; holder lists are capped to keep it under the size limit. */
export function packHoldings(res, { asOf, from, limit = 120, holders = 25 }) {
  return {
    v: 2, asOf, from, savedAt: Date.now(), members: res.members, positions: res.positions,
    stocks: res.stocks.slice(0, limit).map(s => ({
      t: s.ticker, c: s.company, n: s.count, p: [s.parties.D, s.parties.R, s.parties.I], usd: Math.round(s.cost), rb: s.recent.buys, rs: s.recent.sells,
      h: s.holders.slice(0, holders).map(h => [h.bioguide, h.name, h.party, Math.round(h.cost), h.known ? 1 : 0, h.since || '', h.last.date, h.last.kind, h.filer])
    }))
  };
}

/** The shared document back into the shape senateHoldings returns. */
export function unpackHoldings(doc) {
  if (!doc || doc.v !== 2 || !Array.isArray(doc.stocks)) return null;
  const stocks = doc.stocks.map(s => {
    const holders = s.h.map(([bioguide, name, party, cost, known, since, date, kind, filer]) => ({ bioguide, name, filer: filer || name, party, cost, known: !!known, since: since || null, last: { date, kind } }));
    const last = holders.reduce((x, h) => (!x || h.last.date > x.date ? { ...h.last, name: h.name } : x), null);
    return { ticker: s.t, company: s.c, count: s.n, parties: { D: s.p[0], R: s.p[1], I: s.p[2] }, cost: s.usd, holders, last, recent: { buys: s.rb, sells: s.rs } };
  });
  return { stocks, members: doc.members, positions: doc.positions };
}
