/**
 * Policy monitor model: bills before Congress and federal contract awards,
 * cleaned from Quiver rows and cross-referenced with the trading signals.
 * Pure functions; the view and the Claude tools both use them.
 */

const DAY = 864e5;
const day = s => (s ? String(s).slice(0, 10) : '');

/** Quiver's newsfeed tags tickers as a Postgres array literal: "{KKR,BLK}". */
export function parseTickers(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v !== 'string') return [];
  return v.replace(/^\{|\}$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, '').toUpperCase()).filter(t => /^[A-Z][A-Z0-9.\-]{0,7}$/.test(t));
}

const BILL_ID = '(?:H\\.R\\.|S\\.|H\\.J\\.Res\\.|S\\.J\\.Res\\.|H\\.Res\\.|S\\.Res\\.|H\\.Con\\.Res\\.|S\\.Con\\.Res\\.)\\s*\\d+';
const INTRO_RE = new RegExp(`^(Senator|Representative|Rep\\.|Delegate|Resident Commissioner)\\s+(.+?)\\s+introduces\\s+(${BILL_ID}):\\s*(.+)$`, 'i');

/** "Senator Elizabeth Warren introduces S. 5512: Stop Wall Street Looting Act" → parts. */
export function parseBillHeadline(headline) {
  const m = INTRO_RE.exec(String(headline || '').trim());
  if (!m) return null;
  return { role: /^sen/i.test(m[1]) ? 'Senator' : 'Representative', sponsor: m[2].trim(), billId: m[3].replace(/\s+/g, ' '), title: m[4].trim() };
}

/** Strip Quiver's boilerplate from feed summaries: the "we have received" lead and the disclaimer tail. */
export function cleanSummary(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^We have received text from .*?Here is a short summary of the bill:\s*/i, '')
    .replace(/^.*?Quiver AI Summary\s*/i, '');
  const cut = t.search(/\s(Disclaimer: This is an AI-generated|Check out the Quiver Quantitative API|Relevant Companies)/);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/…$/, '…').trim();
}

const VERB = /^(Introduces|Reintroduces|Praises|Issues|Announces|Applauds|Joins|Calls|Leads|Votes|Statement|Secures|Celebrates|Releases|Responds|Unveils|Urges|Demands|Welcomes|Condemns|Hosts|Honors|Delivers|Slams|Blasts|Pushes|Presses|Questions|Supports|Backs|Signs|Sends|Writes|Launches|Visits|Meets|Champions|Introduced|Passes|Statement:|on|and|to|for|the|of)$/;
/** "Press Release: Rep. Mike Kelly Issues Statement…" → "Mike Kelly". */
export function releaseAuthor(headline) {
  const m = /^Press Release:\s*(?:Rep\.|Representative|Senator|Sen\.|Congressman|Congresswoman|Leader|Speaker|Chairman|Chairwoman|Chair)?\s*(.+)$/.exec(String(headline || ''));
  if (!m) return null;
  const out = [];
  for (const w of m[1].split(/\s+/)) {
    if (VERB.test(w) || !/^[A-Z][\w.'’-]*$/.test(w) || out.length >= 4) break;
    out.push(w.replace(/[’']s$/, ''));
  }
  return out.length ? out.join(' ') : null;
}

/** One newsfeed row (legislation_automated) → a bill introduction or a press release. */
export function cleanFeedItem(r) {
  const bill = parseBillHeadline(r.headline);
  const sum = String(r.summary || '');
  const rec = /received on (\d{4}-\d{2}-\d{2})/.exec(sum);
  const cos = /currently has (\d+) cosponsors?/.exec(sum);
  return {
    kind: bill ? 'bill' : 'release',
    id: bill ? bill.billId : r.url || r.headline,
    at: r.datetime ? String(r.datetime) : '',
    date: day(r.datetime),
    received: rec ? rec[1] : null,
    cosponsors: cos ? +cos[1] : null,
    sponsor: bill ? bill.sponsor : releaseAuthor(r.headline),
    role: bill ? bill.role : null,
    billId: bill ? bill.billId : null,
    title: bill ? bill.title : String(r.headline || '').replace(/^Press Release:\s*/i, ''),
    tickers: parseTickers(r.tickers),
    summary: cleanSummary(sum),
    url: r.url || null,
    bioguide: (/images\/([A-Z]\d{6})_congress/.exec(r.image || '') || [])[1] || null
  };
}

/** Legislative stage → step on a five-step track. */
export const STAGES = ['Introduced', 'In committee', 'Passed one chamber', 'Passed both', 'Law'];
export function stageOf(stage) {
  const s = String(stage || '').toLowerCase();
  let step = 1;
  if (/public-law|became.?law|signed/.test(s)) step = 5;
  else if (/enrolled/.test(s)) step = 4;
  // GovInfo text versions: a bill "Referred-in" or "Received-in" a chamber has passed the other one.
  else if (/engrossed|received-in|referred-in|passed|agreed-to|amendment/.test(s)) step = 3;
  else if (/reported|placed-on-calendar|committee-discharged/.test(s)) step = 2;
  return { step, label: STAGES[step - 1], raw: stage || '' };
}

/** One get_congress_legislation row → a bill. */
export function cleanBill(r) {
  const id = `${{ hr: 'H.R.', s: 'S.', hjres: 'H.J.Res.', sjres: 'S.J.Res.', hres: 'H.Res.', sres: 'S.Res.', hconres: 'H.Con.Res.', sconres: 'S.Con.Res.' }[String(r.type || '').toLowerCase()] || String(r.type || '').toUpperCase()} ${r.number}`.trim();
  const title = String(r.clean_title || '').replace(new RegExp(`^${BILL_ID}:\\s*`), '');
  return {
    kind: 'bill',
    id,
    congress: r.congress ? +r.congress : null,
    title,
    chamber: r.chamber || '',
    stage: stageOf(r.stage),
    date: day(r.date),
    tickers: parseTickers(r.tickers),
    summary: cleanSummary(r.summary)
  };
}

/** Agency names shortened for chips and legends. */
const AGENCY = [
  [/defense|army|navy|air force|missile|logistics agency/i, 'Defense'],
  [/homeland|customs|coast guard|fema|immigration/i, 'Homeland Security'],
  [/veterans/i, 'Veterans Affairs'],
  [/health|hhs|nih|cdc|food and drug/i, 'Health'],
  [/energy/i, 'Energy'],
  [/treasury|internal revenue/i, 'Treasury'],
  [/justice|fbi|prisons/i, 'Justice'],
  [/state$|department of state/i, 'State'],
  [/aeronautics|nasa/i, 'NASA'],
  [/transportation|aviation/i, 'Transportation'],
  [/general services/i, 'GSA'],
  [/social security/i, 'Social Security'],
  [/agriculture/i, 'Agriculture'],
  [/commerce/i, 'Commerce'],
  [/interior/i, 'Interior'],
  [/education/i, 'Education']
];
export function agencyShort(name) {
  const n = String(name || '').trim();
  for (const [re, label] of AGENCY) if (re.test(n)) return label;
  return n.replace(/^Department of (the )?/i, '') || 'Other';
}

/** One get_gov_contracts row → an award. Negative amounts are de-obligations. */
export function cleanContract(r) {
  return {
    ticker: String(r.ticker || '').toUpperCase(),
    recipient: String(r.recipient || '').trim(),
    date: day(r.action_date),
    action: r.action_type || null,
    desc: String(r.award_description || '').replace(/\s+/g, ' ').replace(/\*{2,}/g, '').replace(/IGF::\w+::IGF/g, '').trim(),
    usd: +r.total_dollars_obligated || 0,
    agency: agencyShort(r.funding_agency_name),
    agencyFull: r.funding_agency_name || '',
    url: r.usaspending_permalink || null
  };
}

/** Awards summed per company, largest first. */
export function contractLeaders(awards) {
  const by = new Map();
  for (const a of awards) {
    if (!a.ticker || a.usd <= 0) continue;
    let g = by.get(a.ticker);
    if (!g) by.set(a.ticker, g = { ticker: a.ticker, recipient: a.recipient, usd: 0, n: 0, agencies: new Map(), top: null, last: '' });
    g.usd += a.usd;
    g.n++;
    g.agencies.set(a.agency, (g.agencies.get(a.agency) || 0) + a.usd);
    if (!g.top || a.usd > g.top.usd) g.top = a;
    if (a.date > g.last) g.last = a.date;
  }
  return [...by.values()].map(g => ({ ...g, agency: [...g.agencies].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.usd - a.usd);
}

/** ticker → { bills: [feed items], contracts: leader row } for quick lookups from any view. */
export function policyIndex({ feed = [], bills = [], awards = [] }) {
  const idx = new Map();
  const get = t => { let v = idx.get(t); if (!v) idx.set(t, v = { bills: [], contracts: null }); return v; };
  const seen = new Set();
  for (const b of [...feed.filter(x => x.kind === 'bill'), ...bills]) {
    for (const t of b.tickers) {
      const k = `${t}|${b.billId || b.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      get(t).bills.push(b);
    }
  }
  for (const g of contractLeaders(awards)) get(g.ticker).contracts = g;
  return idx;
}

/** Name key for matching sponsors to Quiver's member names: last + first name (Mark and Mike Kelly both serve). */
export function nameKey(name) {
  let n = String(name || '');
  // Quiver writes some members as "Fetterman, John".
  if (n.includes(',')) { const [last, ...rest] = n.split(','); n = `${rest.join(' ')} ${last}`; }
  const parts = n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(p => p.length > 1);
  if (!parts.length) return '';
  return `${parts[parts.length - 1]}|${parts[0]}`;
}

/**
 * Where policy meets trading: companies named in recent bills or receiving
 * large awards that also show buying in the screen, the depot or the plan.
 * A bill's own sponsor trading a company the bill names is flagged first.
 */
export function crossReference({ feed = [], awards = [], signals = [], congressRows = [], held = new Set(), planned = new Set() }) {
  const sig = new Map(signals.map(s => [s.ticker, s]));
  const idx = policyIndex({ feed, awards });
  const tradesBy = new Map();
  const push = (k, r) => { if (!k) return; if (!tradesBy.has(k)) tradesBy.set(k, []); tradesBy.get(k).push(r); };
  for (const r of congressRows) {
    push(nameKey(r.representative), r);
    if (r.bioguide_id) push(`id:${r.bioguide_id}`, r);
  }
  const out = [];
  for (const [t, p] of idx) {
    const s = sig.get(t) || null;
    const sponsorTrades = [];
    for (const b of p.bills) {
      const rows = (b.bioguide && tradesBy.get(`id:${b.bioguide}`)) || (b.sponsor && tradesBy.get(nameKey(b.sponsor))) || [];
      for (const r of rows) if (r.ticker === t) sponsorTrades.push({ bill: b, trade: r });
    }
    const why = [];
    if (sponsorTrades.length) why.push('sponsor');
    if (s && s.congress.members.some(m => !m.washOnly)) why.push('congress');
    if (s && s.insider.buyers.length) why.push('insider');
    if (held.has(t)) why.push('held');
    if (planned.has(t)) why.push('plan');
    if (!why.length) continue;
    const weight = (sponsorTrades.length ? 40 : 0) + (s ? s.score : 0) + (held.has(t) ? 15 : 0) + (planned.has(t) ? 10 : 0) + Math.min(15, p.bills.length * 5) + (p.contracts ? Math.min(15, Math.log10(Math.max(1, p.contracts.usd / 1e6)) * 7) : 0);
    out.push({ ticker: t, signal: s, bills: p.bills, contracts: p.contracts, sponsorTrades, why, weight });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Words worth searching bill titles for, from a free-text event ("US-Russia diesel deal"). */
const STOP = new Set('about after again against also among and any are because been before being between both but can could deal deals did does doing down during each event few for from further had has have having her here him his how into its itself just like more most new news now off once only other our out over own profit profits same she should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your companies company stocks stock which benefit benefits winners losers impact affect'.split(' '));
export function searchTerms(q, max = 4) {
  const words = String(q || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).map(w => w.trim()).filter(w => w.length >= 3 && !STOP.has(w.toLowerCase()));
  const uniq = [];
  for (const w of words) if (!uniq.some(u => u.toLowerCase() === w.toLowerCase())) uniq.push(w);
  return uniq.sort((a, b) => (/^[A-Z]/.test(b) - /^[A-Z]/.test(a)) || b.length - a.length).slice(0, max);
}

/** Is a feed item new since the viewer last looked? */
export const isNewSince = (item, seenAt) => !!(seenAt && item.at && Date.parse(item.at) > seenAt);

export const daysAgo = (iso, asOf) => (iso ? Math.round((Date.parse(asOf) - Date.parse(iso)) / DAY) : null);
