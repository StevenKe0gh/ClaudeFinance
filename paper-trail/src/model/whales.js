/**
 * Whales: Berkshire Hathaway plus the ten best-performing concentrated
 * stock-picking hedge funds of 2025 that file 13Fs. Multi-strategy, quant
 * and macro funds (Bridgewater, D.E. Shaw, Citadel, Millennium) are left
 * out on purpose: they hold thousands of hedged positions, so a 13F line
 * from them says little about conviction.
 *
 * 13F holdings arrive 45 days after each quarter end, so "whale buying" is
 * always one quarter old. Returns are as reported by the press; funds do
 * not publish audited numbers.
 */
export const WHALES = [
  { id: 'berkshire', name: 'Berkshire Hathaway', manager: 'Greg Abel, Warren Buffett', match: /\bberkshire hathaway inc\b/i, ret: null, basis: 'Always tracked' },
  { id: 'perceptive', name: 'Perceptive Advisors', manager: 'Joseph Edelman', match: /\bperceptive advisors\b/i, ret: 82, basis: '2025, Institutional Investor' },
  { id: 'd1', name: 'D1 Capital Partners', manager: 'Dan Sundheim', match: /\bd1 capital\b/i, ret: 33.7, basis: '2025 public portfolio, Institutional Investor' },
  { id: 'tci', name: 'TCI Fund Management', manager: 'Chris Hohn', match: /\btci fund management\b/i, ret: 27, basis: '2025, Financial Times' },
  { id: 'whalerock', name: 'Whale Rock Capital', manager: 'Alex Sacerdote', match: /\bwhale rock\b/i, ret: 27, basis: '2025, Hedge Vision' },
  { id: 'appaloosa', name: 'Appaloosa', manager: 'David Tepper', match: /\bappaloosa\b/i, ret: 23.3, basis: '2025, Institutional Investor' },
  { id: 'pershing', name: 'Pershing Square', manager: 'Bill Ackman', match: /\bpershing square capital\b/i, ret: 20.9, basis: '2025, Pershing Square' },
  { id: 'viking', name: 'Viking Global', manager: 'Andreas Halvorsen', match: /\bviking global\b/i, ret: 18, basis: '2025 hybrid fund, Institutional Investor' },
  { id: 'situational', name: 'Situational Awareness', manager: 'Leopold Aschenbrenner', match: /\bsituational awareness\b/i, ret: 47, basis: 'first half of 2025 only' },
  { id: 'lonepine', name: 'Lone Pine Capital', manager: 'Stephen Mandel', match: /\blone pine capital\b/i, ret: 16, basis: 'first half of 2025 only' },
  { id: 'coatue', name: 'Coatue Management', manager: 'Philippe Laffont', match: /\bcoatue\b/i, ret: 9, basis: 'first half of 2025 only' }
];

/** Funds Quiver posts its own fund-update headlines for; the whale feed queries these. */
export const FEED_QUERIES = { berkshire: 'BERKSHIRE HATHAWAY INC', appaloosa: 'Appaloosa', pershing: 'Pershing Square', situational: 'Situational Awareness' };

export const whaleOf = name => WHALES.find(w => w.match.test(String(name || ''))) || null;

const num = s => +String(s).replace(/[,$]/g, '');
const money = (n, unit) => num(n) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[String(unit || '').toUpperCase()] || 1);
/** "Q2 2026" → "2026Q2" so quarters sort as strings. */
export const quarterKey = q => { const m = /Q([1-4])\s+(\d{4})/.exec(String(q || '')); return m ? `${m[2]}Q${m[1]}` : ''; };
/** "06-30-2026" report period → "2026Q2". */
const periodKey = s => { const m = /(\d{2})-\d{2}-(\d{4})/.exec(String(s || '')); return m ? `${m[2]}Q${Math.ceil(+m[1] / 3)}` : ''; };

/** One fund-update headline → { fund, action, ticker, shares, usd } or null. */
export function parseFundHeadline(headline) {
  const h = String(headline || '').replace(/^Fund Update:\s*/i, '').trim();
  let m;
  if ((m = /^([\d,]+) (.+?) \(([A-Z][A-Z0-9.\-]*)\) shares added to (.+?) portfolio$/.exec(h))) return { fund: m[4], action: 'buy', ticker: m[3], shares: num(m[1]), usd: null };
  if ((m = /^(.+?) added ([\d,]+) shares of (.+?) \(\$([A-Z][A-Z0-9.\-]*)\) to their portfolio$/.exec(h))) return { fund: m[1], action: 'buy', ticker: m[4], shares: num(m[2]), usd: null };
  if ((m = /^(.+?) opened a \$([\d.,]+)([KMBT]?) position in \$([A-Z][A-Z0-9.\-]*) stock$/.exec(h))) return { fund: m[1], action: 'new', ticker: m[4], shares: null, usd: money(m[2], m[3]) };
  if ((m = /^New \$([\d.,]+)([KMBT]?) \$([A-Z][A-Z0-9.\-]*) stock position opened by (.+)$/.exec(h))) return { fund: m[4], action: 'new', ticker: m[3], shares: null, usd: money(m[1], m[2]) };
  return null;
}

const MOVE = /([A-Z0-9][A-Z0-9&.,'()/\- ]*?) (added|removed) ([\d,]+) shares \(([+\-]?(?:[\d.]+|inf))%\) (?:to|from) their portfolio in (Q[1-4] \d{4}), for an estimated \$([\d,]+)/g;

/** The "largest recent moves" list inside a fund-update summary. */
export function parseMoves(summary) {
  const out = [];
  const text = String(summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const m of text.matchAll(MOVE)) {
    const pct = m[4].includes('inf') ? Infinity : +m[4];
    const action = m[2] === 'added' ? (pct === Infinity ? 'new' : 'buy') : pct <= -99.5 ? 'exit' : 'sell';
    out.push({ fund: m[1].trim(), action, shares: num(m[3]), pct, quarter: quarterKey(m[5]), usd: num(m[6]) });
  }
  return out;
}

const HOLD_MOVE = /(An addition|A decrease) of -?([\d,]+) shares of \$([A-Z][A-Z0-9.\-]*) \(~ \$([\d,]+) ?\) ?\. This was an? (?:increase|decrease) of ~([\d.]+|inf)%/g;

/** "FUND Just Disclosed New Holdings": the fund's own largest moves of the quarter. */
export function parseHoldingsUpdate(headline, summary) {
  const m = /^Fund Update: (.+?) Just Disclosed New Holdings$/i.exec(String(headline || '').trim());
  if (!m) return null;
  const text = String(summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const moves = [];
  for (const x of text.matchAll(HOLD_MOVE)) {
    const pct = x[5] === 'inf' ? Infinity : +x[5];
    const add = x[1] === 'An addition';
    moves.push({ ticker: x[3], action: add ? (pct === Infinity ? 'new' : 'buy') : pct >= 99.5 ? 'exit' : 'sell', shares: num(x[2]), usd: num(x[4]), pct: add ? pct : -pct });
  }
  return { fund: m[1], quarter: periodKey(text), moves };
}

const ACTION_RANK = { new: 4, buy: 3, sell: 2, exit: 1 };

/**
 * Whale activity for one ticker from Quiver's fund-update news (moves) and
 * the ticker's top owners (holdings). Moves keep one entry per whale and
 * quarter; holdings keep 13F filers only (Form 4 insiders are dropped).
 */
export function whaleActivity(ticker, { news = [], owners = [] }) {
  const moves = new Map();
  const add = (whale, mv) => {
    const k = `${whale.id}|${mv.quarter}`;
    const cur = moves.get(k);
    if (!cur || (mv.usd || 0) > (cur.usd || 0) || (!cur.usd && ACTION_RANK[mv.action] > ACTION_RANK[cur.action])) moves.set(k, { ...cur, ...mv, whale, usd: mv.usd || (cur && cur.usd) || null });
  };
  for (const r of news) {
    const tags = String(r.tickers || '').replace(/[{}\s]/g, '').split(',');
    if (ticker && !tags.includes(ticker)) continue;
    const hu = parseHoldingsUpdate(r.headline, r.summary);
    if (hu) {
      const w = whaleOf(hu.fund);
      if (w) for (const mv of hu.moves) if (mv.ticker === ticker) add(w, { ...mv, quarter: hu.quarter, date: String(r.datetime || '').slice(0, 10) });
      continue;
    }
    const h = parseFundHeadline(r.headline);
    const quarter = periodKey(r.summary) || '';
    if (h && h.ticker === ticker) { const w = whaleOf(h.fund); if (w) add(w, { action: h.action, shares: h.shares, usd: h.usd, pct: null, quarter, date: String(r.datetime || '').slice(0, 10) }); }
    for (const mv of parseMoves(r.summary)) { const w = whaleOf(mv.fund); if (w) add(w, { ...mv, date: String(r.datetime || '').slice(0, 10) }); }
  }
  const holders = [];
  for (const o of owners) {
    if (o.form_type) continue;
    const w = whaleOf(o.owner_name);
    if (w && !holders.some(h => h.whale.id === w.id)) holders.push({ whale: w, shares: +o.shares || 0, date: o.date || null });
  }
  return {
    ticker,
    moves: [...moves.values()].sort((a, b) => b.quarter.localeCompare(a.quarter) || (b.usd || 0) - (a.usd || 0)),
    holders
  };
}

/** Whale-wide feed: the newest buys Quiver posted for the tracked funds. */
export function whaleFeed(rows) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const hu = parseHoldingsUpdate(r.headline, r.summary);
    if (hu) {
      const w = whaleOf(hu.fund);
      if (w) for (const mv of hu.moves) {
        const k = `${w.id}|${mv.ticker}|${hu.quarter}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ whale: w, ...mv, quarter: hu.quarter, date: String(r.datetime || '').slice(0, 10), url: r.url || null });
      }
      continue;
    }
    const h = parseFundHeadline(r.headline);
    if (!h) continue;
    const w = whaleOf(h.fund);
    if (!w) continue;
    const quarter = periodKey(r.summary);
    const k = `${w.id}|${h.ticker}|${quarter}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // The summary's own move line for this fund carries the dollar value and the percentage change.
    const own = parseMoves(r.summary).find(mv => whaleOf(mv.fund) === w);
    out.push({ whale: w, ticker: h.ticker, action: own && own.action === 'new' ? 'new' : h.action, shares: h.shares || (own && own.shares) || null, usd: h.usd || (own && own.usd) || null, pct: own ? own.pct : null, quarter, date: String(r.datetime || '').slice(0, 10), url: r.url || null });
  }
  return out.sort((a, b) => b.quarter.localeCompare(a.quarter) || (b.usd || 0) - (a.usd || 0));
}

export const ACTION_LABEL = { new: 'New position', buy: 'Added', sell: 'Trimmed', exit: 'Sold out' };
export const quarterLabel = k => (k ? `Q${k.slice(5)} ${k.slice(0, 4)}` : '');
