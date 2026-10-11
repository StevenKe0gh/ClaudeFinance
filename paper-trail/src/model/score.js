import { clamp, dayDiff, median, groupBy, dayRange, addDays } from '../core/util.js';
import { insiderPatterns } from './patterns.js';

/**
 * Conviction model. Ten factors, each normalised to 0–1, combined by
 * user-adjustable weights into a 0–100 score, with multipliers for patterns
 * that make buying less informative. Every number shown in the UI can be
 * traced back to a factor here (see docs/SIGNAL_MODEL.md).
 */

export const FACTORS = [
  { key: 'iBreadth', group: 'insider', label: 'Insider breadth', short: 'Breadth', desc: 'Different insiders buying, weighted by seniority and how recent the buy is.' },
  { key: 'iSize', group: 'insider', label: 'Insider dollars', short: 'Dollars', desc: 'Dollars put in by insiders, seniority- and recency-weighted. $25K scores 0, $10M scores 1 (log scale).' },
  { key: 'iStake', group: 'insider', label: 'Stake increase', short: 'Stake Δ', desc: 'Median increase in each buyer’s holding. A new position counts as 100%; 50% or more scores 1.' },
  { key: 'iSenior', group: 'insider', label: 'Seniority', short: 'Senior', desc: 'Most senior buyer: CEO, CFO, COO, president or chair scores 1; other officers 0.6; directors 0.5.' },
  { key: 'cBreadth', group: 'congress', label: 'Congress breadth', short: 'Members', desc: 'Different members of Congress buying. Each counts by how recent the trade itself is (half-life 30 days, so late filings count less) and by their track record (0.5× for a poor record up to 1.5× for a strong one). Same-day buy-and-sell pairs are ignored.' },
  { key: 'cSize', group: 'congress', label: 'Congress dollars', short: 'Cong. $', desc: 'Midpoint of reported ranges. $1K scores 0, the common $1K–15K range about 0.3, $1M scores 1 (log scale).' },
  { key: 'cBipartisan', group: 'congress', label: 'Bipartisan', short: 'Bipart.', desc: 'Democrats and Republicans both bought.' },
  { key: 'cOversight', group: 'congress', label: 'Committee oversight', short: 'Oversight', desc: 'A buyer sits on a committee or subcommittee whose jurisdiction covers the company’s industry (for example Armed Services and defense contractors). One recent buyer scores about 0.75; a chair or ranking member counts 1.3×.' },
  { key: 'convergence', group: 'cross', label: 'Convergence', short: 'Converge', desc: 'Insiders bought and members of Congress bought in the window (1) or in the last 90 days (0.7).' },
  { key: 'freshness', group: 'cross', label: 'Freshness', short: 'Fresh', desc: 'How recent the latest buy is; halves every 10 days.' }
];
export const FACTOR_BY_KEY = Object.fromEntries(FACTORS.map(f => [f.key, f]));

export const PRESETS = {
  congressLed: { label: 'Congress-led', short: 'Congress-led', tiers: { A: 31, B: 25, C: 19 }, weights: { iBreadth: 12, iSize: 10, iStake: 5, iSenior: 9, cBreadth: 16, cSize: 9, cBipartisan: 4, cOversight: 24, convergence: 12, freshness: 10 } },
  balanced: { label: 'Balanced', short: 'Balanced', tiers: { A: 50, B: 38, C: 25 }, weights: { iBreadth: 20, iSize: 18, iStake: 8, iSenior: 14, cBreadth: 10, cSize: 5, cBipartisan: 3, cOversight: 8, convergence: 12, freshness: 10 } },
  insider: { label: 'Insider-first', short: 'Insider', tiers: { A: 60, B: 48, C: 35 }, weights: { iBreadth: 25, iSize: 22, iStake: 10, iSenior: 17, cBreadth: 5, cSize: 2, cBipartisan: 1, cOversight: 3, convergence: 8, freshness: 10 } },
  congress: { label: 'Congress-first', short: 'Congress', tiers: { A: 34, B: 24, C: 15 }, weights: { iBreadth: 8, iSize: 6, iStake: 3, iSenior: 5, cBreadth: 22, cSize: 13, cBipartisan: 8, cOversight: 24, convergence: 12, freshness: 10 } }
};

export const DEFAULT_MODEL = Object.freeze({
  preset: 'congressLed',
  weights: { ...PRESETS.congressLed.weights },
  halfLife: 21,
  tiers: { ...PRESETS.congressLed.tiers }
});

/** Half-life in days for the age of a congressional trade (trade date, not filing date). */
export const CONGRESS_HALF_LIFE = 30;

export const ROLE_WEIGHT = { csuite: 1, officer: 0.7, director: 0.8, fund: 0.45, holder: 0.4 };
const SENIORITY = { csuite: 1, officer: 0.6, director: 0.5, fund: 0.25, holder: 0.2 };

export const MULT = { placement: 0.55, fixedPrice: 0.5, programmatic: 0.35, entityOnly: 0.7, stakeJump: 0.7, floor: 0.2 };

export function tierOf(score, tiers = DEFAULT_MODEL.tiers) {
  return score >= tiers.A ? 'A' : score >= tiers.B ? 'B' : score >= tiers.C ? 'C' : 'D';
}

const logNorm = (v, lo, hi) => (v > 0 ? clamp(Math.log10(v / lo) / Math.log10(hi / lo), 0, 1) : 0);

/**
 * @param {object} p
 * @param {object[]} p.insiderBuys    cleaned Form 4 code-P rows in the window
 * @param {object[]} p.congressRows   cleaned congressional purchases filed in the window
 * @param {Map<string,object>} p.congressAgg  ticker → {buys, sells, buyVol, sellVol, company} (window)
 * @param {Map<string,number>} p.convergence90  ticker → congressional purchases in 90 days
 * @param {Map<string,object>} [p.enrichment] ticker → {buyUsd, sellUsd, sells, complete}
 * @param {string} p.asOf
 * @param {number} p.windowDays
 * @param {object} p.model
 * @param {string|null} [p.lastSeen] ISO timestamp of the previous visit
 * @param {((ticker:string, bioguide:string|null) => object|null)|null} [p.oversight] committee-oversight lookup (model/oversight.js)
 * @param {((bioguide:string|null) => {score:number, n:number, ex:number, hit:number}|null)|null} [p.track] member track record (0–1 score, neutral 0.5)
 */
export function buildSignals({ insiderBuys, congressRows, congressAgg = new Map(), convergence90 = new Map(), enrichment = new Map(), asOf, windowDays, model = DEFAULT_MODEL, lastSeen = null, oversight = null, track = null }) {
  const H = model.halfLife || 21;
  const rec = d => (d ? Math.pow(0.5, Math.max(0, dayDiff(d, asOf)) / H) : 0);
  // Congressional trades age from the trade date, not the filing: a purchase
  // disclosed 40 days late is 40-day-old information.
  const recTrade = d => (d ? Math.pow(0.5, Math.max(0, dayDiff(d, asOf)) / CONGRESS_HALF_LIFE) : 0);
  // Track record scales each member between 0.5× and 1.5×; unknown is neutral.
  const trackWeight = m => 0.5 + (m.track && Number.isFinite(m.track.score) ? m.track.score : 0.5);
  const wsum = FACTORS.reduce((s, f) => s + (model.weights[f.key] || 0), 0) || 1;
  const from = addDays(asOf, -(windowDays - 1));
  const days = dayRange(from, asOf);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const insiderBy = groupBy(insiderBuys, r => r.ticker);
  const congressBy = groupBy(congressRows.filter(r => r.kind === 'buy'), r => r.ticker);
  const tickers = new Set([...insiderBy.keys(), ...congressBy.keys()]);
  for (const [t, a] of congressAgg) if (a.buys > 0) tickers.add(t);

  const out = [];
  for (const ticker of tickers) {
    const buys = insiderBy.get(ticker) || [];
    const cRows = congressBy.get(ticker) || [];
    const agg = congressAgg.get(ticker) || null;
    const daily = new Array(days.length).fill(0);

    // ---- insider side
    const buyers = [];
    for (const [owner, g] of groupBy(buys, b => b.owner)) {
      const role = g[0].role;
      const usd = g.reduce((s, b) => s + b.value, 0);
      const lastDate = g.reduce((m, b) => (b.date > m ? b.date : m), '');
      const firstDate = g.reduce((m, b) => (b.date < m ? b.date : m), lastDate);
      const pcts = g.map(b => (b.newPosition ? 100 : b.stakePct)).filter(x => x != null);
      buyers.push({
        name: owner, role, title: g[0].officer_title || '', usd, tx: g.length, firstDate, lastDate,
        stakePct: pcts.length ? Math.max(...pcts) : null,
        newPosition: g.some(b => b.newPosition),
        avgPrice: usd / g.reduce((s, b) => s + b.shares, 0)
      });
      for (const b of g) { const i = dayIndex.get(b.date); if (i != null) daily[i]++; }
    }
    buyers.sort((a, b) => b.usd - a.usd);
    const pat = buys.length ? insiderPatterns(buys) : null;
    const insiderUsd = buyers.reduce((s, b) => s + b.usd, 0);
    const insiderLast = buyers.reduce((m, b) => (b.lastDate > m ? b.lastDate : m), '');

    // ---- congress side
    const members = [];
    for (const [name, g] of groupBy(cRows, r => r.representative)) {
      const real = g.filter(r => !r.wash);
      members.push({
        name, party: g[0].party, chamber: g[0].chamber || '', bioguide: g[0].bioguide_id || null,
        usd: real.reduce((s, r) => s + r.mid, 0), tx: g.length, washOnly: !real.length,
        lastFiled: g.reduce((m, r) => (r.filed > m ? r.filed : m), ''),
        lastTraded: g.reduce((m, r) => (r.traded > m ? r.traded : m), ''),
        late: g.filter(r => r.lagDays > 45).length,
        ranges: [...new Set(g.map(r => r.amount))],
        oversees: oversight ? oversight(ticker, g[0].bioguide_id || null) : null,
        track: track ? track(g[0].bioguide_id || null) : null
      });
      for (const r of g) { const i = dayIndex.get(r.filed); if (i != null) daily[i]++; }
    }
    members.sort((a, b) => b.usd - a.usd);
    const realMembers = members.filter(m => !m.washOnly);
    const cBuys = agg ? agg.buys : cRows.length;
    const cSells = agg ? agg.sells : 0;
    const cUsd = realMembers.reduce((s, m) => s + m.usd, 0) || (agg && !cRows.length ? agg.buyVol : 0);
    const congressLast = members.reduce((m, x) => (x.lastFiled > m ? x.lastFiled : m), '');
    const parties = new Set(realMembers.map(m => m.party));
    const washes = cRows.filter(r => r.wash).length;
    const conv90 = convergence90.get(ticker) || 0;

    // ---- factors
    const B = buyers.reduce((s, b) => s + ROLE_WEIGHT[b.role] * rec(b.lastDate), 0);
    const D = buyers.reduce((s, b) => s + b.usd * ROLE_WEIGHT[b.role] * rec(b.lastDate), 0);
    const stake = median(buyers.map(b => (b.stakePct == null ? null : Math.min(b.stakePct, 300))).filter(x => x != null));
    const memberRec = m => recTrade(m.lastTraded || m.lastFiled) * trackWeight(m);
    const M = realMembers.reduce((s, m) => s + memberRec(m), 0) || (agg && !cRows.length && agg.buys > 0 ? 0.5 : 0);
    const overseers = realMembers.filter(m => m.oversees);
    const O = overseers.reduce((s, m) => s + memberRec(m) * (m.oversees.leader ? 1.3 : 1), 0);
    const last = insiderLast > congressLast ? insiderLast : congressLast;

    const norm = {
      iBreadth: buyers.length ? 1 - Math.exp(-B / 1.6) : 0,
      iSize: logNorm(D, 25e3, 10e6),
      iStake: stake == null ? 0 : clamp(stake / 50, 0, 1),
      iSenior: buyers.length ? Math.max(...buyers.map(b => SENIORITY[b.role])) : 0,
      cBreadth: 1 - Math.exp(-M / 1.4),
      cSize: logNorm(cUsd, 1e3, 1e6),
      cBipartisan: parties.has('D') && parties.has('R') ? 1 : 0,
      cOversight: 1 - Math.exp(-O / 0.7),
      convergence: buyers.length && realMembers.length ? 1 : buyers.length && conv90 > 0 ? 0.7 : 0,
      freshness: last ? Math.pow(0.5, Math.max(0, dayDiff(last, asOf)) / 10) : 0
    };

    // ---- multipliers
    const notes = [];
    let mI = 1;
    if (pat?.placement) { mI *= MULT.placement; notes.push({ key: 'placement', label: 'Offering-priced buys', mult: MULT.placement }); }
    if (pat?.fixedPrice) { mI *= MULT.fixedPrice; notes.push({ key: 'fixedPrice', label: 'Fixed-price buys', mult: MULT.fixedPrice }); }
    if (pat?.programmatic) { mI *= MULT.programmatic; notes.push({ key: 'programmatic', label: 'Purchase-program pattern', mult: MULT.programmatic }); }
    if (pat?.stakeJump && !pat.placement) { mI *= MULT.stakeJump; notes.push({ key: 'stakeJump', label: 'Outsized stake jump', mult: MULT.stakeJump }); }
    const entityOnly = buyers.length > 0 && buyers.every(b => b.role === 'fund' || b.role === 'holder');
    if (entityOnly) { mI *= MULT.entityOnly; notes.push({ key: 'entityOnly', label: 'Only funds or large holders bought', mult: MULT.entityOnly }); }
    const enr = enrichment.get(ticker);
    let sellShare = null;
    if (enr && (enr.sellUsd > 0 || enr.buyUsd > 0)) {
      sellShare = enr.sellUsd / (enr.sellUsd + Math.max(enr.buyUsd, insiderUsd));
      if (sellShare > 0.05) {
        const m = 1 - 0.6 * sellShare;
        mI *= m;
        notes.push({ key: 'insiderSelling', label: `Insider selling (${Math.round(sellShare * 100)}% of 90-day volume)`, mult: m });
      }
    }
    mI = Math.max(MULT.floor, mI);
    let mC = 1;
    if (cBuys + cSells > 0 && cSells > 0) {
      mC = 1 - 0.5 * (cSells / (cBuys + cSells));
      notes.push({ key: 'congressSelling', label: `Congressional sales (${cSells} of ${cBuys + cSells} trades)`, mult: mC });
    }
    const multFor = f => (f.group === 'insider' ? mI : f.group === 'congress' ? mC : f.key === 'convergence' ? Math.min(mI, mC) : 1);

    const factors = FACTORS.map(f => {
      const w = model.weights[f.key] || 0;
      const m = multFor(f);
      return { key: f.key, label: f.label, short: f.short, group: f.group, norm: norm[f.key], weight: w, mult: m, contrib: (100 * w * norm[f.key] * m) / wsum };
    });
    const score = Math.round(clamp(factors.reduce((s, f) => s + f.contrib, 0), 0, 100));

    // ---- flags (what a reviewer should notice)
    const flags = [];
    if (overseers.length) {
      const o = overseers[0];
      const lead = o.oversees.role === 'chair' ? 'chairs' : o.oversees.role === 'ranking' ? 'is ranking member on' : 'sits on';
      flags.push({ id: 'oversight', tone: 'pos', label: overseers.length > 1 ? `Oversight ×${overseers.length}` : 'Oversight', detail: `${o.name} ${lead} ${o.oversees.committee}, which oversees ${o.oversees.themeLabel}${overseers.length > 1 ? `; ${overseers.length - 1} more buyer${overseers.length > 2 ? 's' : ''} also oversee${overseers.length > 2 ? '' : 's'} the industry` : ''}.` });
    }
    const proven = realMembers.filter(m => m.track && m.track.n >= 8 && m.track.score >= 0.65).sort((a, b) => b.track.score - a.track.score);
    const weak = realMembers.filter(m => m.track && m.track.n >= 8 && m.track.score <= 0.35);
    if (proven.length) {
      const t = proven[0].track;
      flags.push({ id: 'track', tone: 'pos', label: proven.length > 1 ? `Strong track record ×${proven.length}` : 'Strong track record', detail: `${proven[0].name}'s past purchases beat the S&P 500 by ${t.ex >= 0 ? '+' : ''}${(t.ex * 100).toFixed(1)}% on average ${t.horizon || 90} days later (${t.n} trades, ${Math.round(t.hit * 100)}% beat it).` });
    }
    if (weak.length && !proven.length) {
      const t = weak[0].track;
      flags.push({ id: 'track-weak', tone: 'warn', label: 'Weak track record', detail: `${weak[0].name}'s past purchases trailed the S&P 500 by ${(Math.abs(t.ex) * 100).toFixed(1)}% on average ${t.horizon || 90} days later (${t.n} trades).` });
    }
    const late = realMembers.filter(m => m.lastTraded && m.lastFiled && dayDiff(m.lastTraded, m.lastFiled) > 30);
    if (late.length && late.length === realMembers.length) flags.push({ id: 'stale', tone: 'warn', label: 'Old trades', detail: `Disclosed more than 30 days after the trade; the information is ${dayDiff(late[0].lastTraded, asOf)} days old.` });
    const sen = buyers.filter(b => b.role === 'csuite');
    const insidersProper = buyers.filter(b => b.role === 'csuite' || b.role === 'officer' || b.role === 'director');
    if (sen.length >= 2) flags.push({ id: 'csuite-cluster', tone: 'pos', label: `C-suite cluster ×${sen.length}`, detail: `${sen.map(b => b.name).join(', ')} bought on the open market.` });
    else if (sen.length === 1) flags.push({ id: 'csuite', tone: 'pos', label: 'C-suite buy', detail: `${sen[0].name} (${sen[0].title || 'senior officer'}) bought on the open market.` });
    if (insidersProper.length >= 3) flags.push({ id: 'cluster', tone: 'pos', label: `Insider cluster ×${insidersProper.length}`, detail: 'Three or more officers or directors bought in the window.' });
    if (pat?.accumulating.length) flags.push({ id: 'accumulating', tone: 'pos', label: 'Accumulating', detail: `${pat.accumulating.join(', ')} bought on 3+ days at changing prices.` });
    if (pat?.newPositions) flags.push({ id: 'new', tone: 'pos', label: `New position ×${pat.newPositions}`, detail: 'Buyer held no shares before this purchase.' });
    if (norm.convergence > 0) flags.push({ id: 'convergence', tone: 'pos', label: 'Congress + insiders', detail: realMembers.length ? 'Members of Congress and insiders both bought in this window.' : `Insiders bought in this window; members of Congress made ${conv90} purchase${conv90 === 1 ? '' : 's'} in the last 90 days.` });
    if (norm.cBipartisan) flags.push({ id: 'bipartisan', tone: 'pos', label: 'Bipartisan', detail: 'Democrats and Republicans both bought.' });
    if (realMembers.length >= 3) flags.push({ id: 'members', tone: 'pos', label: `${realMembers.length} members buying`, detail: 'Three or more members of Congress bought.' });
    if (pat?.placement) flags.push({ id: 'placement', tone: 'warn', label: 'Offering-priced', detail: 'Several insiders bought on one day at one price, which usually means an offering or private placement rather than market orders.' });
    if (pat?.fixedPrice) flags.push({ id: 'fixed', tone: 'warn', label: 'Fixed price', detail: 'One buyer bought on several days at an identical price, typical of a tender or negotiated deal.' });
    if (pat?.programmatic) flags.push({ id: 'program', tone: 'warn', label: 'Purchase program', detail: 'Many small, uniform purchases, typical of employee or director purchase plans.' });
    if (pat?.stakeJump) flags.push({ id: 'jump', tone: 'warn', label: 'Outsized stake jump', detail: 'A buyer more than quintupled their holding in $1M+ of purchases. Open-market buyers rarely do that; conversions and placements often do.' });
    if (entityOnly) flags.push({ id: 'entity', tone: 'info', label: 'Fund / large holder', detail: 'Only funds, companies or 10% owners bought; no management.' });
    if (pat?.lateForm4) flags.push({ id: 'late4', tone: 'warn', label: `Late Form 4 ×${pat.lateForm4}`, detail: 'Filed more than 4 days after the trade (the deadline is 2 business days).' });
    const latePtr = members.reduce((s, m) => s + m.late, 0);
    if (latePtr) flags.push({ id: 'lateptr', tone: 'warn', label: `Late PTR ×${latePtr}`, detail: 'Congressional trade disclosed more than 45 days after it happened, past the STOCK Act deadline.' });
    if (washes) flags.push({ id: 'wash', tone: 'warn', label: 'Offsetting trades', detail: 'A member bought and sold on the same day; these net to zero and are ignored.' });
    if (sellShare != null && sellShare > 0.5) flags.push({ id: 'selling', tone: 'warn', label: 'Insiders net selling', detail: `Sales are ${Math.round(sellShare * 100)}% of insider dollar volume over 90 days.` });

    const company = (agg && agg.company) || cRows.find(r => r.company)?.company || '';

    out.push({
      ticker,
      company,
      score,
      tier: tierOf(score, model.tiers),
      factors,
      notes,
      mult: { insider: mI, congress: mC },
      flags,
      insider: { buyers, usd: insiderUsd, tx: buys.length, lastDate: insiderLast, stakeMedian: stake, patterns: pat, avgPrice: buys.length ? insiderUsd / buys.reduce((n, b) => n + b.shares, 0) : null },
      congress: { members, buys: cBuys, sells: cSells, usd: cUsd, lastFiled: congressLast, conv90, washes, overseers: overseers.length },
      lastActivity: last,
      daily,
      enriched: !!enr,
      isNew: !!(lastSeen && last && last >= String(lastSeen).slice(0, 10))
    });
  }

  out.sort((a, b) => b.score - a.score || b.insider.usd + b.congress.usd - (a.insider.usd + a.congress.usd) || a.ticker.localeCompare(b.ticker));
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}

/** Normalises user weights to percentages (for display). */
export function weightShares(weights) {
  const total = FACTORS.reduce((s, f) => s + (weights[f.key] || 0), 0) || 1;
  return Object.fromEntries(FACTORS.map(f => [f.key, (100 * (weights[f.key] || 0)) / total]));
}
