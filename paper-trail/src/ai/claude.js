import { fmtUSD } from '../core/util.js';
import { ROLE_LABEL } from '../model/clean.js';

/**
 * Prompts for the two Claude features. Claude sees only what the page sends
 * (no browsing, no memory), so each prompt carries its data and its format.
 */

const RULES = `Rules: use only the data given. The investor weighs congressional buying above insider buying, above all when the member sits on a committee that oversees the company's industry (marked committee_oversight); lead with those. Prices, where present, are the last US close from a daily snapshot; there are no valuations or earnings, so never state any; say what to check instead. Congressional amounts are ranges and can be filed up to 45 days late. Form 4 code P is an open-market purchase and S a sale. Describe patterns; never accuse anyone of wrongdoing. Be specific with names, dates and dollar figures from the data.`;

const compactSignal = (s, quotes) => ({
  ticker: s.ticker,
  company: s.company || undefined,
  ...priceFields(s, quotes),
  tier: s.tier,
  score: s.score,
  rank: s.rank,
  last_activity: s.lastActivity,
  factors: Object.fromEntries(s.factors.map(f => [f.key, Math.round(f.contrib * 10) / 10])),
  adjustments: s.notes.map(n => `${n.label} ×${n.mult.toFixed(2)}`),
  flags: s.flags.map(f => f.label),
  insiders: s.insider.buyers.slice(0, 5).map(b => ({ name: b.name, role: ROLE_LABEL[b.role], title: b.title || undefined, usd: Math.round(b.usd), buys: b.tx, last: b.lastDate, stake_increase_pct: b.stakePct == null ? undefined : Math.round(b.stakePct) })),
  insider_total_usd: Math.round(s.insider.usd),
  congress: s.congress.members.slice(0, 5).map(m => ({ name: m.name, party: m.party, chamber: m.chamber, est_usd: Math.round(m.usd), ranges: m.ranges, filed: m.lastFiled, same_day_sell: m.washOnly || undefined, committee_oversight: m.oversees ? `${m.oversees.committee}${m.oversees.role ? ` (${m.oversees.role})` : ''} oversees ${m.oversees.themeLabel}` : undefined })),
  congress_buys_window: s.congress.buys,
  congress_sells_window: s.congress.sells,
  congress_buys_90d: s.congress.conv90
});

function priceFields(s, quotes) {
  const q = quotes && quotes[s.ticker];
  if (!q) return {};
  const avg = s.insider.avgPrice;
  return { last_close_usd: q[0], day_change_pct: q[1], insider_avg_buy_usd: avg ? +avg.toFixed(2) : undefined, vs_insider_avg_pct: avg ? +((q[0] / avg - 1) * 100).toFixed(1) : undefined };
}

const BUYABLE = { yes: 'yes (investor confirmed)', likely: 'likely', maybe: 'uncertain', unlikely: 'unlikely' };

export function deskBriefPrompt({ signals, asOf, windowDays, capital, quotes = null, buy = null, brokers = [] }) {
  // Names the investor's brokers cannot sell never reach the desk.
  const usable = buy ? signals.filter(s => buy(s.ticker, s.company).status !== 'no') : signals;
  const top = usable.slice(0, 14).map(s => ({ ...compactSignal(s, quotes), ...(buy ? { buyable: BUYABLE[buy(s.ticker, s.company).status] } : {}) }));
  return `You are the lead analyst on a small research desk. A retail investor in Germany plans to put about ${fmtUSD(capital)} into US stocks showing unusual insider and congressional buying${brokers.length ? `, buying through ${brokers.join(' or ')}` : ''}. Below are the top ${top.length} signals from our conviction model for the ${windowDays} days to ${asOf}, ranked by score. Weigh them against each other.

${RULES}${buy ? ' Each signal says whether the investor can likely buy it at their brokers ("buyable", an estimate unless confirmed). Allocate money only to names that are likely or confirmed buyable; mention uncertain ones as "check availability first".' : ''}

Reply in Markdown, under 550 words, with exactly these sections:
## Read of the tape
Two or three sentences on what the filings say overall this period.
## Strongest signals
The 4 to 6 names you would research first, best first. One bullet each: ticker, the specific evidence, and why it beats the names below it.
## Discount these
2 to 4 bullets naming high-scoring tickers whose buying is likely mechanical, conflicted or stale, and why.
## How I would split the money
A short list: ticker and percent of ${fmtUSD(capital)}, no position above 20%, at least 10% left in cash, one clause of reasoning each.
## Before buying
3 bullets of concrete checks.

DATA (JSON):
${JSON.stringify(top)}`;
}

export function memoPrompt(ctx) {
  return `You are a careful equity analyst. Write a deep-dive memo on ${ctx.ticker}${ctx.company ? ` (${ctx.company})` : ''} for a retail investor splitting about $10,000 across several stocks flagged by insider and congressional buying. The data comes from Quiver Quantitative filings as of ${ctx.as_of}.

${RULES}

Reply in Markdown, under 450 words, with exactly these sections:
## Verdict
One line: signal strength from 1 (noise) to 5 (strong) and the main reason.
## What the filings show
3 to 5 bullets.
## Why it could matter
2 or 3 bullets.
## Innocent explanations and red flags
2 to 4 bullets.
## Check before buying
3 to 5 concrete bullets.
## Position size
One or two sentences: the most of a $10,000 budget you would put here (never above 20%), and why.

DATA (JSON):
${JSON.stringify(ctx)}`;
}

export function sampleErrorCopy(e) {
  switch (e && e.code) {
    case 'cancelled': return 'Stopped.';
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'This page is not allowed to use Claude here. Allow it from the page’s Permissions menu.';
    case 'rate_limited': return 'You have reached a Claude usage limit. Try again later.';
    case 'session_expired': return 'Sign in to claude.ai again, then retry.';
    case 'refused': return 'Claude declined to write this.';
    case 'prompt_too_large': return 'Too much data for one request.';
    default: return 'The answer was interrupted. Try again.';
  }
}

/**
 * Streams a sample() call into an element with Stop support. Returns a
 * controller {stop}. `render(text)` receives the whole text so far.
 */
export function streamInto(sample, prompt, { render, onDone, onError, cache = { gcTime: 3600000 }, modelTier = 'default' }) {
  const ctl = new AbortController();
  sample(prompt, { signal: ctl.signal, modelTier, cache, onText: ({ text }) => render(text) })
    .then(r => onDone && onDone(r))
    .catch(e => onError && onError(e));
  return { stop: () => ctl.abort() };
}

/**
 * Trade-review coaching. The page has already measured everything; Claude
 * turns the measurements into a short, prioritised critique.
 */
export function coachPrompt({ stats, findings, summary, positions }) {
  const data = {
    period: { from: stats.from, to: stats.to, months: +stats.months.toFixed(1) },
    activity: { buys: stats.buys, sells: stats.sells, plan_buys: stats.planBuys, discretionary_buys: stats.discretionaryBuys, discretionary_trades_per_month: +stats.discretionaryPerMonth.toFixed(1), tax_withheld_eur: Math.round(stats.taxes) },
    depot: { positions: stats.positions, fund_share_pct: stats.fundShare == null ? null : +stats.fundShare.toFixed(1), top3_pct: +stats.top3.toFixed(1), positions_under_1pct: stats.tailCount },
    key_figures: summary,
    findings: findings.map(f => ({ tone: f.tone, title: f.title, detail: f.detail, impact_eur: f.impact == null ? undefined : Math.round(f.impact), evidence: f.items.slice(0, 6).map(i => `${i.label}: ${i.value} (${i.sub})`) })),
    largest_positions: [...positions].sort((a, b) => b.alloc - a.alloc).slice(0, 8).map(p => ({ name: p.name, weight_pct: p.alloc, gain_pct: p.gainPct }))
  };
  return `You are a blunt but fair investing coach reviewing a German retail investor's broker history (Scalable Capital, euros, 26.375% capital-gains tax with FIFO lot matching). The numbers below were measured from their own transactions. Do not invent trades or prices beyond them.

Reply in Markdown, under 420 words, with exactly these sections:
## The short version
Two sentences: their biggest strength and their most expensive habit, with euro figures.
## Keep doing
2 or 3 bullets, each tied to evidence.
## Stop or change
3 or 4 bullets, most expensive first. For each: the pattern, what it cost, and a concrete rule to replace it (for example a holding-period rule, a position-size floor, or a sell checklist).
## Next 30 days
3 numbered actions they can take this month, specific to their positions.

Never give tax or legal advice beyond explaining how FIFO and the flat tax work. Not investment advice.

DATA (JSON):
${JSON.stringify(data)}`;
}
