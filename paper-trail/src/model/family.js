import { amountRange, cleanTicker } from './clean.js';
import { companyOf } from '../core/directory.js';

/**
 * President Trump's disclosed trades (STOCK Act reports, run by outside
 * managers) summed by sector. Quiver's ticker column is unreliable for funds
 * and bonds ("MSCI" on an iShares EAFE fund, "AXP" on American Express
 * preferreds), so the name decides those first.
 */
const BOND = /\d(?:\.\d+)?\s*%|\bB\/E\b|\bDUE\b|\bNOTES?\b|\bBDS\b|\bREV\b|\bRFDG\b|\bSCH DIST\b|\bPERP\b|\bCTF\b|\bOBLIG/i;
const FUND = /\bETF\b|\bINDEX\b|\bFUND\b|\bFDS?\b|\bISHARES\b|\bSPDR\b|\bVANGUARD\b|\bTRUST\b(?!.*\bINC\b)|\bTR\b/i;

export const CATEGORIES = { stock: 'Stocks', fund: 'Funds and ETFs', bond: 'Bonds', other: 'Other' };

/** One disclosed trade → { kind, sector, ticker, name }. */
export function classifyHolding(r) {
  const name = String(r.company || '');
  if (BOND.test(name)) return { kind: 'bond', sector: 'Bonds', ticker: null, name };
  if (FUND.test(name)) return { kind: 'fund', sector: 'Funds and ETFs', ticker: null, name };
  const t = cleanTicker(r.ticker);
  const c = t ? companyOf(t) : null;
  if (c) return { kind: 'stock', sector: c.sector || 'Other', ticker: t, name: c.name };
  return { kind: t ? 'stock' : 'other', sector: 'Other', ticker: t, name };
}

const side = s => (/^purchase/i.test(s) ? 'buy' : /^sale/i.test(s) ? 'sell' : null);

/**
 * @param rows `get_trump_trades` rows
 * @param opts.from YYYY-MM-DD, trades on or after (by trade date)
 * @returns {{ total, categories, sectors, stocks, latestFiled, n }} purchases and sales at range midpoints
 */
export function tradeFlows(rows, { from = null } = {}) {
  const cats = new Map();
  const sectors = new Map();
  const stocks = new Map();
  const total = { buy: 0, sell: 0, n: 0 };
  let latestFiled = '';
  const add = (m, k, s, usd, extra) => {
    const v = m.get(k) || { key: k, buy: 0, sell: 0, n: 0, ...extra };
    v[s] += usd;
    v.n++;
    m.set(k, v);
    return v;
  };
  for (const r of rows || []) {
    const s = side(r.transaction);
    const date = String(r.traded || '').slice(0, 10);
    if (!s || !date || (from && date < from)) continue;
    const usd = amountRange(r.amount).mid;
    const c = classifyHolding(r);
    total[s] += usd;
    total.n++;
    if (String(r.filed || '') > latestFiled) latestFiled = String(r.filed).slice(0, 10);
    add(cats, c.kind, s, usd);
    add(sectors, c.sector, s, usd);
    if (c.kind === 'stock' && c.ticker) {
      const v = add(stocks, c.ticker, s, usd, { ticker: c.ticker, name: c.name, sector: c.sector, last: '' });
      if (date > v.last) v.last = date;
    }
  }
  const net = v => ({ ...v, net: v.buy - v.sell });
  return {
    total,
    latestFiled,
    categories: [...cats.values()].map(net).sort((a, b) => b.buy + b.sell - (a.buy + a.sell)),
    sectors: [...sectors.values()].map(net).sort((a, b) => b.net - a.net),
    stocks: [...stocks.values()].map(net).sort((a, b) => b.net - a.net)
  };
}

/** Compact form for the shared document. */
export function packFlows(f, { asOf, from }) {
  const r = v => [v.key, Math.round(v.buy), Math.round(v.sell), v.n];
  const movers = [...f.stocks.slice(0, 20), ...f.stocks.slice(-20)].filter((v, i, a) => a.indexOf(v) === i);
  return { v: 1, asOf, from, savedAt: Date.now(), latestFiled: f.latestFiled, total: f.total, categories: f.categories.map(r), sectors: f.sectors.map(r), stocks: movers.map(v => [v.ticker, v.name, v.sector, Math.round(v.buy), Math.round(v.sell), v.n, v.last]) };
}

export function unpackFlows(doc) {
  if (!doc || doc.v !== 1) return null;
  const r = ([key, buy, sell, n]) => ({ key, buy, sell, n, net: buy - sell });
  return {
    total: doc.total, latestFiled: doc.latestFiled,
    categories: doc.categories.map(r),
    sectors: doc.sectors.map(r).sort((a, b) => b.net - a.net),
    stocks: doc.stocks.map(([ticker, name, sector, buy, sell, n, last]) => ({ ticker, name, sector, buy, sell, n, last, net: buy - sell })).sort((a, b) => b.net - a.net)
  };
}
