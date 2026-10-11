import { addDays, isoDate } from '../core/util.js';
import { companyOf } from '../core/directory.js';
import { cleanBill, cleanFeedItem, cleanContract, searchTerms } from '../model/policy.js';

/**
 * "Who profits?" — Claude traces an event or policy (a trade deal, a bill,
 * a sanctions package) to the US-listed companies that gain or lose. The
 * page searches bills first and hands them over; where the viewer's plan
 * allows tools, Claude can search more bills and check candidate companies
 * against federal awards, lobbying and the trading screen itself.
 */

export const STATUS = {
  law: 'Law', passed: 'Passed a chamber', bill: 'Bill in Congress', executive: 'Executive action', negotiation: 'In negotiation',
  proposal: 'Proposal', rumour: 'Rumour', hypothetical: 'Hypothetical'
};
export const CHANNEL = { direct: 'Direct', supplier: 'Supplier', competitor: 'Competitor', 'second-order': 'Second-order' };
const CONF = ['high', 'medium', 'low'];

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const billBrief = b => ({ id: b.id, title: clip(b.title, 140), stage: b.stage.label, date: b.date || undefined, tickers: b.tickers.length ? b.tickers : undefined, summary: clip(b.summary, 260) });
const newsBrief = n => ({ date: n.date, item: n.billId ? `${n.billId}: ${clip(n.title, 120)}` : clip(n.title, 140), sponsor: n.sponsor || undefined, tickers: n.tickers.length ? n.tickers : undefined, summary: clip(n.summary, 220) });

/** Bills and legislative news matching the words of a question, newest first. */
export async function searchPolicy(quiver, terms, { perTerm = 6 } = {}) {
  const bills = new Map(), news = new Map();
  await Promise.all(terms.flatMap(t => [
    quiver.bills(t, { pages: 1, stage: 'policy-ai' }).then(r => { for (const b of r.rows.map(cleanBill).sort((a, b2) => (b2.date || '').localeCompare(a.date || '')).slice(0, perTerm)) bills.set(b.id, b); }).catch(() => {}),
    quiver.legislationFeed({ query: t, pages: 1, stage: 'policy-ai' }).then(r => { for (const n of r.rows.map(cleanFeedItem).slice(0, perTerm)) news.set(n.id, n); }).catch(() => {})
  ]));
  return {
    bills: [...bills.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    news: [...news.values()].sort((a, b) => b.at.localeCompare(a.at))
  };
}

/** What the screen, depot and plan say about one ticker, compactly. */
export function screenFacts(t, { signals, held, planned }) {
  const s = signals.find(x => x.ticker === t);
  const c = companyOf(t);
  const members = s ? s.congress.members.filter(m => !m.washOnly) : [];
  return {
    ticker: t,
    company: c?.name || s?.company || undefined,
    industry: c?.industry || c?.sector || undefined,
    in_screen: s ? { tier: s.tier, score: s.score, rank: s.rank } : 'no recent insider or congressional buying',
    congress_buyers: members.length ? members.slice(0, 4).map(m => `${m.name} (${m.party || '?'})${m.oversees ? `, sits on ${m.oversees.committee} which oversees ${m.oversees.themeLabel}` : ''}`) : undefined,
    insider_buyers: s && s.insider.buyers.length ? `${s.insider.buyers.length} insiders bought ${Math.round(s.insider.usd).toLocaleString('en-US')} USD` : undefined,
    investor_holds: held.has(t) || undefined,
    investor_plans: planned.has(t) || undefined
  };
}

/** Federal awards (12 months) and lobbying (4 quarters) for one ticker. */
export async function exposureOf(quiver, t) {
  const asOf = isoDate();
  const y = new Date().getUTCFullYear();
  const [con, lob] = await Promise.allSettled([
    quiver.contracts(t, { from: addDays(asOf, -365), to: asOf }),
    quiver.lobbying(t, { yearFrom: y - 1 })
  ]);
  const out = {};
  if (con.status === 'fulfilled') {
    const rows = con.value.rows.map(cleanContract).filter(a => a.usd > 0);
    const total = rows.reduce((s, a) => s + a.usd, 0);
    const byAgency = new Map();
    for (const a of rows) byAgency.set(a.agency, (byAgency.get(a.agency) || 0) + a.usd);
    out.federal_awards_12m = rows.length ? {
      total_usd: Math.round(total), actions: rows.length,
      agencies: [...byAgency].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v / 1e6)}M`),
      largest: [...rows].sort((a, b) => b.usd - a.usd).slice(0, 2).map(a => `${a.date} ${a.agency} ${Math.round(a.usd / 1e6)}M: ${clip(a.desc, 90)}`)
    } : 'none tagged';
  }
  if (lob.status === 'fulfilled') {
    const rows = lob.value.rows.filter(r => r.year >= y - 1);
    const issues = new Map();
    for (const r of rows) for (const i of String(r.issue || '').split(/\n|,/).map(x => x.trim()).filter(Boolean)) issues.set(i, (issues.get(i) || 0) + 1);
    out.lobbying = rows.length ? { usd_since_last_year: Math.round(rows.reduce((s, r) => s + (+r.amount || 0), 0)), issues: [...issues].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]) } : 'none filed';
  }
  return out;
}

/** The page functions Claude may call. `log` reports progress; `found` collects exposure for the cards. */
export function policyTools({ quiver, facts, log, found }) {
  return [
    {
      name: 'search_bills',
      description: 'Search bills in Congress by a word or short phrase in the bill TITLE (for example "diesel", "sanctions", "refinery", "drone"), plus recent legislative press releases mentioning it. Returns up to 8 bills (id, title, stage, date, stock tickers Quiver tagged, short summary) and up to 6 news items. One or two plain words per search work best; try synonyms.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'One or two words that would appear in a bill title' } }, required: ['query'] },
      async execute(input) {
        const q = String(input.query || '').trim().slice(0, 60);
        if (!q) throw new Error('query is required');
        log(`Searching bills for “${q}”`);
        const r = await searchPolicy(quiver, [q], { perTerm: 8 });
        return { query: q, bills: r.bills.slice(0, 8).map(billBrief), news: r.news.slice(0, 6).map(newsBrief) };
      }
    },
    {
      name: 'company_exposure',
      description: 'Check up to 8 US tickers at once. For each: federal contract awards over 12 months (total, main agencies, largest awards), lobbying spend and issues since last year, and what the investor\'s screen shows (recent insider and congressional buying, conviction tier, committee oversight, whether they hold or plan to buy it). Call it on your candidate winners and losers before answering.',
      inputSchema: { type: 'object', properties: { tickers: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'US stock tickers, e.g. ["VLO","MPC"]' } }, required: ['tickers'] },
      async execute(input) {
        const list = (Array.isArray(input.tickers) ? input.tickers : String(input.tickers || '').split(/[,\s]+/))
          .map(t => String(t).toUpperCase().trim()).filter(t => /^[A-Z][A-Z0-9.\-]{0,7}$/.test(t)).slice(0, 8);
        if (!list.length) throw new Error('tickers must be a list of US stock tickers');
        log(`Checking ${list.join(', ')}`);
        const rows = await Promise.all(list.map(async t => {
          const x = { ...facts(t), ...(await exposureOf(quiver, t)) };
          found.set(t, x);
          return x;
        }));
        return rows;
      }
    }
  ];
}

export function eventPrompt({ question, asOf, context, tools }) {
  return `You are a policy analyst for a retail investor who follows congressional and insider stock trading. Trace this event or policy to the US-listed companies it would help or hurt:

EVENT: ${JSON.stringify(question)}
Today is ${asOf}.

How to work:
1. Establish what is actually on the table. ${tools ? 'Use search_bills (title words only; try two or three synonyms) and the context below.' : 'Use the bills and news in the context below.'} If you find no bill or official action, say so and classify the event as a negotiation, proposal, rumour or hypothetical.
2. Trace the money: who sells more, who supplies them, who competes for the same customers, whose costs rise, and second-order effects (shipping, inputs, substitutes).
3. ${tools ? 'Check your candidate winners and losers with company_exposure (batch up to 8 tickers per call) before you answer.' : 'Use the screen data in the context for the companies it covers.'}

Rules: US-listed tickers only (ADRs are fine). Separate facts from the data (cite bill ids, awards, screen data) from your own industry reasoning, and label the latter "industry reasoning". Never invent bill numbers, contract values, dates or figures. Never state share prices, valuations or earnings. Describe trading patterns neutrally and never accuse anyone of wrongdoing; congressional buying is context, not proof the event will happen.

Reply with ONLY a JSON object, no prose before or after:
{"headline": string (at most 90 characters), "status": one of ${Object.keys(STATUS).map(k => `"${k}"`).join(', ')}, "status_note": string (at most 160 characters; cite bill ids if any), "mechanism": string (2 or 3 sentences on how the money flows), "winners": [{"ticker": string, "company": string, "why": string (at most 160 characters), "channel": one of ${Object.keys(CHANNEL).map(k => `"${k}"`).join(', ')}, "confidence": "high" | "medium" | "low", "evidence": string (at most 120 characters)}] (3 to 7, strongest first), "losers": [same shape] (0 to 5), "bills": [bill ids you relied on], "watch": [2 to 4 short strings: what would confirm or kill this], "caveat": string (at most 160 characters)}

CONTEXT (JSON):
${JSON.stringify(context)}`;
}

/** Coerce Claude's JSON into the shape the view renders; drop anything malformed. */
export function normalizeAnalysis(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('Claude returned no analysis.'), { code: 'invalid_json' });
  const side = xs => (Array.isArray(xs) ? xs : []).map(x => ({
    ticker: String(x?.ticker || '').toUpperCase().replace(/^\$/, '').trim(),
    company: clip(x?.company, 60),
    why: clip(x?.why, 220),
    channel: CHANNEL[x?.channel] ? x.channel : 'direct',
    confidence: CONF.includes(x?.confidence) ? x.confidence : 'low',
    evidence: clip(x?.evidence, 160)
  })).filter(x => /^[A-Z][A-Z0-9.\-]{0,7}$/.test(x.ticker));
  const dedupe = xs => xs.filter((x, i) => xs.findIndex(y => y.ticker === x.ticker) === i);
  const winners = dedupe(side(v.winners)).slice(0, 8);
  const losers = dedupe(side(v.losers)).filter(x => !winners.some(w => w.ticker === x.ticker)).slice(0, 6);
  return {
    headline: clip(v.headline, 120) || 'Analysis',
    status: STATUS[v.status] ? v.status : 'hypothetical',
    statusNote: clip(v.status_note, 220),
    mechanism: clip(v.mechanism, 600),
    winners, losers,
    bills: (Array.isArray(v.bills) ? v.bills : []).map(b => clip(b, 30)).filter(Boolean).slice(0, 8),
    watch: (Array.isArray(v.watch) ? v.watch : []).map(w => clip(w, 160)).filter(Boolean).slice(0, 5),
    caveat: clip(v.caveat, 220)
  };
}

/**
 * Runs one analysis. Resolves with { result, exposure, context, usedTools }.
 * `onStep(text)` narrates progress; `signal` stops everything.
 */
export async function analyzeEvent({ sample, quiver, question, signals, held, planned, onStep, signal }) {
  const asOf = isoDate();
  const terms = searchTerms(question, 3);
  onStep(terms.length ? `Searching bills for ${terms.map(t => `“${t}”`).join(', ')}` : 'Reading the question');
  const found = terms.length ? await searchPolicy(quiver, terms) : { bills: [], news: [] };
  if (signal?.aborted) throw { code: 'cancelled' };
  const top = signals.slice(0, 30).map(s => [s.ticker, companyOf(s.ticker)?.name || s.company || '', s.tier, s.score, s.congress.overseers ? 'oversight' : s.congress.members.some(m => !m.washOnly) ? 'congress' : 'insider']);
  const context = {
    bills: found.bills.slice(0, 10).map(billBrief),
    news: found.news.slice(0, 8).map(newsBrief),
    screen_top30: { columns: ['ticker', 'company', 'tier', 'score', 'lead'], rows: top },
    investor_holds: [...held].slice(0, 40),
    investor_plans: [...planned].slice(0, 20)
  };
  const lim = await sample.limits().catch(() => null);
  const canTools = !!(lim && lim.tools);
  const exposure = new Map();
  const facts = t => screenFacts(t, { signals, held, planned });
  onStep(canTools ? 'Claude is tracing the money (it may search more bills and check companies)' : 'Claude is tracing the money');
  const opts = { signal, modelTier: 'default' };
  if (canTools) opts.tools = policyTools({ quiver, facts, log: onStep, found: exposure });
  else opts.cache = false;
  const raw = await sample.json(eventPrompt({ question, asOf, context, tools: canTools }), opts);
  const result = normalizeAnalysis(raw);
  return { result, exposure: Object.fromEntries(exposure), bills: found.bills.slice(0, 10), usedTools: canTools, asOf };
}
