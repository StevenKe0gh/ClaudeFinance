/**
 * Parser for text copied from Finanzfluss Copilot pages (German locale):
 * the depot page ("Positionen (N)" table), the transactions page
 * ("Buchungen" list) and the dashboard ("Kennzahlen"). Users paste whole
 * pages, so the parser hunts for those sections and ignores navigation,
 * chart captions and footer text. Missing "-" placeholders (some browsers
 * drop them on copy) are tolerated.
 */

const TYPES = new Set(['ETF', 'Aktie', 'Anleihe', 'Fonds', 'Derivat', 'Zertifikat / Optionsschein', 'Krypto', 'ETC']);
const TX = { Kauf: 'buy', Verkauf: 'sell', Dividende: 'dividend', 'Reverse Split': 'split', Split: 'split', Zinsen: 'interest', Einlage: 'deposit', Entnahme: 'withdrawal', Steuern: 'tax', Gebühren: 'fee', Einbuchung: 'transfer_in', Ausbuchung: 'transfer_out' };

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const EUR = /^(-?)\s*([\d.]+(?:,\d+)?)\s*€$/;
const PCT = /^(-?)\s*([\d.]+(?:,\d+)?)\s*%$/;
const QTY = /^([\d.]+(?:,\d+)?)\s*St\.?$/;
const POS_QTY = /^([\d.]+(?:,\d+)?)\s*St\.\s*zu\s*([\d.]+(?:,\d+)?)\s*€$/;
const AVG = /^⌀\s*([\d.]+(?:,\d+)?)\s*€$/;

/** "1.234,56" → 1234.56 */
export function deNum(s) {
  const v = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
export const eur = s => { const m = EUR.exec(String(s).trim()); return m ? (m[1] ? -1 : 1) * deNum(m[2]) : null; };
export const pct = s => { const m = PCT.exec(String(s).trim()); return m ? (m[1] ? -1 : 1) * deNum(m[2]) : null; };
const isoFromDe = s => { const m = DATE.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function lines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/ /g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\*\s*/, '').trim())
    .filter(l => l && l !== '*');
}

/* ---------- Positions ---------- */
export function parsePositions(L) {
  const start = L.findIndex(l => /^Positionen\s*\(\d+\)$/.test(l));
  if (start < 0) return [];
  let i = start + 1;
  const header = ['Name', 'Aktueller Kurs', 'Aktueller Wert', 'Einstiegswert', 'Kursgewinn', 'Allokation', 'Dividende'];
  while (i < L.length && header.includes(L[i])) i++;
  const out = [];
  while (i + 10 < L.length) {
    const name = L[i], type = L[i + 1];
    if (!TYPES.has(type)) break;
    const price = eur(L[i + 2]);
    const dayPct = pct(L[i + 3]);
    const value = eur(L[i + 4]);
    const q = POS_QTY.exec(L[i + 5]);
    const entry = eur(L[i + 6]);
    const avg = AVG.exec(L[i + 7]);
    const gain = eur(L[i + 8]);
    const gainPctAbs = pct(L[i + 9]);
    const alloc = pct(L[i + 10]);
    if (price == null || value == null || !q || entry == null || gain == null || alloc == null) break;
    let j = i + 11;
    let dividends = 0;
    // An optional dividend amount follows unless the next line already starts a new position.
    if (j < L.length && eur(L[j]) != null && !TYPES.has(L[j + 1])) { dividends = eur(L[j]); j++; }
    out.push({
      name,
      type,
      price,
      dayPct, // Finanzfluss shows the day's sign only by colour; treat as magnitude
      value,
      qty: deNum(q[1]),
      entry,
      avg: avg ? deNum(avg[1]) : entry / Math.max(deNum(q[1]) || 1, 1e-9),
      gain,
      gainPct: gainPctAbs == null ? null : Math.sign(gain || 1) * Math.abs(gainPctAbs), // % shown unsigned; sign follows the € gain
      alloc,
      dividends
    });
    i = j;
  }
  return out;
}

/* ---------- Transactions ---------- */
export function parseTransactions(L) {
  const out = [];
  const starts = [];
  for (let i = 0; i < L.length - 1; i++) if (TX[L[i]] && DATE.test(L[i + 1])) starts.push(i);
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k];
    const b = k + 1 < starts.length ? starts[k + 1] : Math.min(L.length, a + 9);
    const chunk = L.slice(a, b);
    const kind = TX[chunk[0]];
    const date = isoFromDe(chunk[1]);
    const name = chunk[2];
    const assetType = TYPES.has(chunk[3]) ? chunk[3] : null;
    const rest = chunk.slice(assetType ? 4 : 3).filter(x => !/^(Elemente pro Seite|Impressum|Datenschutz)/.test(x) && !/^\d+-\d+ von \d+$/.test(x));
    const amounts = [];
    let qty = null, ratio = null, dashes = 0;
    for (const x of rest) {
      const e = eur(x);
      if (e != null) { amounts.push(e); continue; }
      const q = QTY.exec(x);
      if (q) { qty = deNum(q[1]); continue; }
      if (/^\d+:\d+$/.test(x)) { ratio = x; continue; }
      if (x === '-') { dashes++; continue; }
      break; // anything else ends the record (page footer, next section)
    }
    const row = { date, kind, name, assetType, price: null, qty, tax: 0, total: null, ratio };
    if (kind === 'buy' || kind === 'sell') {
      row.price = amounts[0] ?? null;
      row.total = amounts.length ? amounts[amounts.length - 1] : null;
      if (amounts.length >= 3) row.tax = amounts[1];
      if (row.total == null && row.price != null && qty != null) row.total = row.price * qty;
    } else if (kind === 'dividend' || kind === 'interest') {
      row.total = amounts.length ? amounts[amounts.length - 1] : null;
      row.price = amounts[0] ?? null;
    } else {
      row.total = amounts.length ? amounts[amounts.length - 1] : null;
    }
    void dashes;
    if (date && name) out.push(row);
  }
  return out;
}

export const txKey = t => [t.date, t.kind, t.name, t.qty ?? '', t.price ?? '', t.total ?? ''].join('|');

/* ---------- Key figures (dashboard and depot header) ---------- */
export function parseSummary(L) {
  const s = {};
  const after = (label, n = 1, fn = eur) => {
    const i = L.findIndex(l => l === label);
    if (i < 0) return null;
    for (let k = 1; k <= n + 3 && i + k < L.length; k++) { const v = fn(L[i + k]); if (v != null && --n === 0) return v; }
    return null;
  };
  const before = (label, fn = eur) => { const i = L.findIndex(l => l === label); return i > 0 ? fn(L[i - 1]) : null; };
  const depotIdx = L.findIndex(l => /Depot$/.test(l) && eur(L[L.indexOf(l) + 1] || '') != null);
  if (depotIdx >= 0) {
    s.depotName = L[depotIdx];
    s.depotValue = eur(L[depotIdx + 1]);
    const tw = pct(L[depotIdx + 2] || '');
    if (tw != null) s.twror = tw;
  }
  const ein = L.find(l => /^Einstandswert:/.test(l));
  if (ein) s.costBasis = eur(ein.replace(/^Einstandswert:\s*/, ''));
  s.netWorth = before('Gesamtvermögen') ?? s.netWorth;
  s.invested = after('Investiertes Kapital') ?? s.costBasis;
  const kg = L.findIndex((l, i) => l === 'Kursgewinn' && pct(L[i + 1] || '') != null);
  if (kg >= 0) { s.unrealizedPct = pct(L[kg + 1]); s.unrealized = eur(L[kg + 2] || ''); }
  const rg = L.indexOf('Realisierte Gewinne');
  if (rg >= 0) {
    const vals = L.slice(rg + 1, rg + 6).map(eur).filter(v => v != null);
    if (vals.length >= 2) { s.realizedNet = vals[0]; s.realized = vals[1]; }
  }
  const dv = L.indexOf('Dividenden');
  if (dv >= 0) { const v = L.slice(dv + 1, dv + 5).map(eur).filter(x => x != null); if (v.length) s.dividends = v[v.length - 1]; }
  s.taxesFees = after('Steuern & Gebühren');
  const tw2 = after('TWROR', 1, pct); if (tw2 != null) s.twror = tw2;
  s.irr = after('IZF', 1, pct);
  s.inflation = after('Inflation', 1, pct);
  s.cash = after('Cash');
  const bk = L.indexOf('Buchungen');
  if (bk >= 0) {
    const grab = re => { const l = L.slice(bk, bk + 6).find(x => re.test(x)); return l ? +l.match(/\d+/)[0] : null; };
    s.counts = { buys: grab(/Käufe$/), sells: grab(/Verkäufe$/), dividends: grab(/Dividenden$/) };
  }
  const page = L.find(l => /^\d+-\d+ von \d+$/.test(l));
  if (page) s.txTotal = +page.match(/von (\d+)/)[1];
  for (const k of Object.keys(s)) if (s[k] == null) delete s[k];
  return s;
}

export function parseFinanzfluss(text) {
  const L = lines(text);
  return { positions: parsePositions(L), transactions: parseTransactions(L), summary: parseSummary(L) };
}

/** Merge new transactions into existing ones (dedupe on content), newest first. */
export function mergeTransactions(existing, incoming) {
  const seen = new Map(existing.map(t => [txKey(t), t]));
  let added = 0;
  for (const t of incoming) { const k = txKey(t); if (!seen.has(k)) { seen.set(k, t); added++; } }
  const all = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { all, added };
}
