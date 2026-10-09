import { fmtUSD } from '../core/util.js';
import { ROLE_LABEL } from '../model/clean.js';

/**
 * Prompts for the two Claude features. Claude sees only what the page sends
 * (no browsing, no memory), so each prompt carries its data and its format.
 */

const RULES = `Rules: use only the data given. There are no share prices, valuations or earnings in it, so never state any; say what to check instead. Congressional amounts are ranges and can be filed up to 45 days late. Form 4 code P is an open-market purchase and S a sale. Describe patterns; never accuse anyone of wrongdoing. Be specific with names, dates and dollar figures from the data.`;

const compactSignal = s => ({
  ticker: s.ticker,
  company: s.company || undefined,
  tier: s.tier,
  score: s.score,
  rank: s.rank,
  last_activity: s.lastActivity,
  factors: Object.fromEntries(s.factors.map(f => [f.key, Math.round(f.contrib * 10) / 10])),
  adjustments: s.notes.map(n => `${n.label} ×${n.mult.toFixed(2)}`),
  flags: s.flags.map(f => f.label),
  insiders: s.insider.buyers.slice(0, 5).map(b => ({ name: b.name, role: ROLE_LABEL[b.role], title: b.title || undefined, usd: Math.round(b.usd), buys: b.tx, last: b.lastDate, stake_increase_pct: b.stakePct == null ? undefined : Math.round(b.stakePct) })),
  insider_total_usd: Math.round(s.insider.usd),
  congress: s.congress.members.slice(0, 5).map(m => ({ name: m.name, party: m.party, chamber: m.chamber, est_usd: Math.round(m.usd), ranges: m.ranges, filed: m.lastFiled, same_day_sell: m.washOnly || undefined })),
  congress_buys_window: s.congress.buys,
  congress_sells_window: s.congress.sells,
  congress_buys_90d: s.congress.conv90
});

export function deskBriefPrompt({ signals, asOf, windowDays, capital }) {
  const top = signals.slice(0, 14).map(compactSignal);
  return `You are the lead analyst on a small research desk. A retail investor plans to put about ${fmtUSD(capital)} into US stocks showing unusual insider and congressional buying. Below are the top ${top.length} signals from our conviction model for the ${windowDays} days to ${asOf}, ranked by score. Weigh them against each other.

${RULES}

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
