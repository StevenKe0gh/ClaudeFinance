import { dayDiff, ts } from '../core/util.js';

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;
/** Any single Form 4 line above this is treated as a data error (seen: a $10T row). */
export const MAX_TX_USD = 2e9;

const CSUITE_RE = /\b(CEO|CFO|COO|Chief Executive|Chief Financial|Chief Operating|Chair(?:man|woman|person)?|(?<!Vice[ -])President)\b/i;
const OFFICER_RE = /\b(officer|vp|vice president|treasurer|secretary|counsel|controller|pao|pfo)\b/i;
const ENTITY_RE = /\b(LLC|L\.L\.C\.|LP|L\.P\.|INC|CORP|CORPORATION|FUND|CAPITAL|ADVISORS|ADVISERS|HOLDINGS|PARTNERS|MANAGEMENT|TRUST|LTD|LIMITED|PLC|INSURANCE|BANK|GROUP|INVESTMENTS?|S\.A\.|SE|AG|N\.V\.)\b/i;

/** Who is buying: csuite | officer | director | fund | holder. */
export function roleOf(r) {
  const title = String(r.officer_title || '');
  const owner = String(r.owner || '');
  if (ENTITY_RE.test(owner)) return 'fund';
  if (CSUITE_RE.test(title)) return 'csuite';
  if (r.is_officer || OFFICER_RE.test(title)) return 'officer';
  if (r.is_director || /director/i.test(title)) return 'director';
  return 'holder';
}

export const ROLE_LABEL = { csuite: 'C-suite', officer: 'Officer', director: 'Director', fund: 'Fund / entity', holder: '10% owner / other' };

export function cleanTicker(t) {
  const s = String(t ?? '').toUpperCase().trim().replace(/^\$/, '');
  return TICKER_RE.test(s) ? s : null;
}

/** Parses "$15,001 - $50,000" style ranges. */
export function amountRange(s) {
  const m = String(s || '').match(/\d[\d,]*/g);
  if (!m) return { lo: 0, hi: 0, mid: 0 };
  const v = m.map(x => +x.replace(/,/g, ''));
  const lo = v[0];
  const hi = v.length > 1 ? v[1] : v[0];
  return { lo, hi, mid: (lo + hi) / 2 };
}

export function partyOf(p) {
  const s = String(p || '').toUpperCase();
  return s.startsWith('D') ? 'D' : s.startsWith('R') ? 'R' : s ? 'I' : '';
}

const emptyDrops = () => ({ noTicker: 0, mutualFund: 0, badDate: 0, nonPositive: 0, subPenny: 0, outlier: 0, duplicate: 0 });
/** Prices under 5 cents are almost always unit mismatches (ordinary shares vs ADS) or untradeable OTC lines. */
export const MIN_PRICE = 0.05;
/** Five-letter symbols ending in X are mutual funds (Nasdaq convention), not operating companies. */
export const isMutualFund = t => /^[A-Z]{4}X$/.test(t);

/**
 * Cleans Form 4 rows. Keeps the original fields and adds:
 * ticker, value, role, before, stakePct, newPosition, lateDays.
 */
export function cleanInsider(rows, { from = null, to = null } = {}) {
  const dropped = emptyDrops();
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    const ticker = cleanTicker(r.ticker);
    if (!ticker) { dropped.noTicker++; continue; }
    if (isMutualFund(ticker)) { dropped.mutualFund++; continue; }
    const date = String(r.date || '').slice(0, 10);
    if (!Number.isFinite(ts(date)) || (to && date > to) || (from && date < from)) { dropped.badDate++; continue; }
    const shares = +r.shares, price = +r.price;
    if (!(shares > 0) || !(price > 0)) { dropped.nonPositive++; continue; }
    if (price < MIN_PRICE) { dropped.subPenny++; continue; }
    const value = shares * price;
    if (value > MAX_TX_USD) { dropped.outlier++; continue; }
    const key = [ticker, date, r.owner, shares, price, r.transaction_type, r.shares_owned_after].join('|');
    if (seen.has(key)) { dropped.duplicate++; continue; }
    seen.add(key);
    const after = +r.shares_owned_after;
    const sign = r.transaction_type === 'S' || r.acquired_disposed === 'D' ? -1 : 1;
    const before = Number.isFinite(after) ? after - sign * shares : null;
    out.push({
      ...r,
      ticker,
      date,
      shares,
      price,
      value,
      role: roleOf(r),
      before,
      newPosition: sign > 0 && before != null && before <= 0,
      stakePct: sign > 0 && before > 0 ? (shares / before) * 100 : null,
      lateDays: r.file_date ? dayDiff(date, r.file_date) : null
    });
  }
  return { rows: out, dropped };
}

/**
 * Cleans congressional trade rows and marks wash trades: a member who buys
 * and sells the same ticker on the same day nets to nothing.
 */
export function cleanCongress(rows) {
  const dropped = emptyDrops();
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    const ticker = cleanTicker(r.ticker);
    if (!ticker) { dropped.noTicker++; continue; }
    if (isMutualFund(ticker)) { dropped.mutualFund++; continue; }
    if (!Number.isFinite(ts(r.traded)) && !Number.isFinite(ts(r.filed))) { dropped.badDate++; continue; }
    const tx = String(r.transaction || '');
    const kind = /purchase/i.test(tx) ? 'buy' : /sale/i.test(tx) ? 'sell' : 'other';
    const amt = amountRange(r.amount);
    out.push({
      ...r,
      ticker,
      kind,
      party: partyOf(r.party),
      lo: amt.lo,
      hi: amt.hi,
      mid: amt.mid,
      lagDays: r.traded && r.filed ? dayDiff(r.traded, r.filed) : null,
      wash: false
    });
  }
  const byKey = new Map();
  for (const r of out) {
    const k = `${r.representative}|${r.ticker}|${r.traded}`;
    const g = byKey.get(k) || { buy: false, sell: false, rows: [] };
    g[r.kind] = true;
    g.rows.push(r);
    byKey.set(k, g);
  }
  for (const g of byKey.values()) if (g.buy && g.sell) for (const r of g.rows) r.wash = true;
  return { rows: out, dropped };
}

export function mergeDrops(...ds) {
  const out = emptyDrops();
  for (const d of ds) for (const k of Object.keys(out)) out[k] += (d && d[k]) || 0;
  return out;
}
