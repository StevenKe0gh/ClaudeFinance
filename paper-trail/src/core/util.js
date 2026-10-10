import { DAY } from './config.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sum = (xs, f = x => x) => xs.reduce((s, x) => s + (+f(x) || 0), 0);

export function median(xs) {
  const a = xs.filter(x => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function groupBy(xs, key) {
  const m = new Map();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x); else m.set(k, [x]);
  }
  return m;
}

/* ---------- Dates (all calendar math in UTC on YYYY-MM-DD strings) ---------- */

export function isoDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}
export function ts(s) {
  if (!s) return NaN;
  return Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
}
export function addDays(iso, n) {
  return new Date(ts(iso) + n * DAY).toISOString().slice(0, 10);
}
export function dayDiff(a, b) {
  return Math.round((ts(b) - ts(a)) / DAY);
}
/** Inclusive list of ISO days from `from` to `to`. */
export function dayRange(from, to) {
  const out = [];
  for (let t = ts(from), end = ts(to); t <= end; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/* ---------- Formatting ---------- */

export function fmtUSD(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(+n)) return '—';
  n = +n;
  const a = Math.abs(n);
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
}
/** Euros, en-US grouping: €1,234 or €1,234.50 with cents; − for negatives. */
export function fmtEUR(n, { sign = false, cents = false } = {}) {
  if (n == null || !Number.isFinite(+n)) return '—';
  n = +n;
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  const a = Math.abs(n);
  return `${s}€${a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}
export const fmtSignedPct = (n, d = 1) => (n == null || !Number.isFinite(+n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}%`);
export const fmtInt = n => (Number.isFinite(+n) ? Math.round(+n).toLocaleString('en-US') : '—');
export const fmtMoney = n => '$' + Math.round(+n || 0).toLocaleString('en-US');
export function fmtPct(n, digits = 0) {
  if (n == null || !Number.isFinite(+n)) return '—';
  return `${(+n).toFixed(digits)}%`;
}
export function fmtCompact(n) {
  if (!Number.isFinite(+n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(s, { year = true } = {}) {
  const t = ts(s);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return year ? `${base}, ${d.getUTCFullYear()}` : base;
}
export function fmtAge(iso, asOf) {
  const d = dayDiff(iso, asOf);
  if (!Number.isFinite(d)) return '—';
  if (d <= 0) return 'today';
  if (d === 1) return '1d';
  if (d < 60) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}
export function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ---------- Misc ---------- */

export function debounce(fn, ms) {
  let t = 0;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

/** Promise concurrency limiter: limit(fn) runs fn when a slot frees up. */
export function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export function initials(name) {
  const parts = String(name || '').replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : '');
}

export function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
}

/** Tidy company names from filings ("ACME CORP - COMMON STOCK" → "Acme Corp"). */
export function cleanCompany(s) {
  const t = String(s || '')
    .replace(/\s*[-–]\s*(class [a-z] )?(common|ordinary|depositary|american depositary).*$/i, '')
    .replace(/\s+(common stock|cmn|common shares|ordinary shares)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return '';
  return t === t.toUpperCase() ? titleCase(t) : t;
}
