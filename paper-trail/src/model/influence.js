import { addDays } from '../core/util.js';

/**
 * Influence map: for the stocks members of Congress hold most, how much the
 * company lobbies and how much federal money it wins. One point per company:
 * members holding it (Senate + House estimates), lobbying in the last four
 * reported quarters, contract awards in the last 12 months.
 */

/** The stocks to plot: most held across both chambers, each counted once per member. */
export function influenceUniverse(holdings, { limit = 30 } = {}) {
  const by = new Map();
  for (const [chamber, h] of Object.entries(holdings)) {
    if (!h) continue;
    for (const s of h.stocks) {
      const v = by.get(s.ticker) || { ticker: s.ticker, company: s.company, senate: 0, house: 0 };
      v[chamber === 'Senate' ? 'senate' : 'house'] += s.count;
      by.set(s.ticker, v);
    }
  }
  return [...by.values()].map(v => ({ ...v, members: v.senate + v.house })).sort((a, b) => b.members - a.members || a.ticker.localeCompare(b.ticker)).slice(0, limit);
}

/** Lobbying reported in the four quarters before `asOf` (every registrant: in-house and outside firms). */
export function lobbyingLastYear(rows, asOf) {
  const from = addDays(asOf, -365);
  return (rows || []).filter(r => String(r.date || '').slice(0, 10) > from).reduce((s, r) => s + (+r.amount || 0), 0);
}

/** Federal awards obligated in the 12 months before `asOf`. */
export function contractsLastYear(rows, asOf) {
  const from = addDays(asOf, -365);
  return (rows || []).filter(r => String(r.action_date || '').slice(0, 10) > from).reduce((s, r) => s + Math.max(0, +r.total_dollars_obligated || 0), 0);
}

/** Points ready to draw; `insiders` = tickers insiders bought in the current window. */
export function influencePoints(universe, { lobbying, contracts, asOf, insiders = new Set() }) {
  return universe.map(u => ({
    ...u,
    lobby: lobbyingLastYear(lobbying.get(u.ticker), asOf),
    awards: contractsLastYear(contracts.get(u.ticker), asOf),
    insider: insiders.has(u.ticker)
  }));
}

export const packInfluence = (points, { asOf }) => ({ v: 1, asOf, savedAt: Date.now(), p: points.map(x => [x.ticker, x.company, x.senate, x.house, Math.round(x.lobby), Math.round(x.awards)]) });
export const unpackInfluence = doc => (doc && doc.v === 1 ? doc.p.map(([ticker, company, senate, house, lobby, awards]) => ({ ticker, company, senate, house, members: senate + house, lobby, awards, insider: false })) : null);
