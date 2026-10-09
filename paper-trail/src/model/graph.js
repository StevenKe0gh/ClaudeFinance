/**
 * Entity graph for link analysis: tickers, members of Congress and insiders
 * as nodes; purchases as weighted edges. Insiders who bought more than one
 * ticker and members who bought several tickers become bridges between
 * clusters, which is what the view is for.
 */
export function buildGraph(signals, { maxTickers = 40, perTickerInsiders = 4, includeMembers = true, includeInsiders = true, includeFunds = true } = {}) {
  const nodes = new Map();
  const links = [];
  const add = (id, data) => {
    const n = nodes.get(id);
    if (n) { n.weight += data.weight || 0; return n; }
    const fresh = { id, degree: 0, ...data };
    nodes.set(id, fresh);
    return fresh;
  };

  for (const s of signals.slice(0, maxTickers)) {
    add(`t:${s.ticker}`, { type: 'ticker', label: s.ticker, ticker: s.ticker, score: s.score, tier: s.tier, weight: 0 });
    if (includeInsiders) {
      for (const b of s.insider.buyers.slice(0, perTickerInsiders)) {
        const isEntity = b.role === 'fund' || b.role === 'holder';
        if (isEntity && !includeFunds) continue;
        const id = `i:${b.name}`;
        add(id, { type: isEntity ? 'fund' : 'insider', label: b.name, role: b.role, weight: b.usd });
        links.push({ source: id, target: `t:${s.ticker}`, usd: b.usd, kind: 'insider', role: b.role });
      }
    }
    if (includeMembers) {
      for (const m of s.congress.members) {
        if (m.washOnly) continue;
        const id = `m:${m.name}`;
        add(id, { type: 'member', label: m.name, party: m.party, chamber: m.chamber, weight: m.usd });
        links.push({ source: id, target: `t:${s.ticker}`, usd: m.usd, kind: 'congress' });
      }
    }
  }
  // Drop tickers that ended up with no counterpart (e.g. every buyer filtered out).
  for (const l of links) { nodes.get(l.source).degree++; nodes.get(l.target).degree++; }
  const list = [...nodes.values()].filter(n => n.degree > 0);
  return { nodes: list, links };
}
