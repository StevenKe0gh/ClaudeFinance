import { html } from './html.js';
import { companyOf } from '../core/directory.js';
import { BROKERS, BUY, DEFAULT_BROKERS, availability } from '../model/brokers.js';

const MARK = { yes: '✓', likely: '●', maybe: '?', unlikely: '!', no: '✕' };

/** The investor's brokers and confirmations, from the synced workspace. */
export function brokerSettings(st) {
  const b = (st.workspace && st.workspace.brokers) || {};
  const use = (Array.isArray(b.use) && b.use.length ? b.use : DEFAULT_BROKERS).filter(k => BROKERS[k]);
  return { use: use.length ? use : DEFAULT_BROKERS, marks: b.marks || {} };
}

let memo = { ws: undefined, q: undefined, map: new Map() };

/** ticker → availability, memoised until the broker settings or quotes change. */
export function buyOf(st) {
  const ws = st.workspace && st.workspace.brokers;
  const q = st.cloud && st.cloud.quotes ? st.cloud.quotes.q : null;
  if (memo.ws !== ws || memo.q !== q) memo = { ws, q, map: new Map() };
  const { use, marks } = brokerSettings(st);
  return (ticker, quiverName = '') => {
    if (memo.map.has(ticker)) return memo.map.get(ticker);
    const c = companyOf(ticker);
    const cap = q && q[ticker] ? q[ticker][2] : null;
    const av = availability(ticker, { use, marks, info: { listed: !!c, name: c ? c.name : '', sector: c ? c.sector : '', industry: c ? c.industry : '', quiverName, capM: cap } });
    memo.map.set(ticker, av);
    return av;
  };
}

const whereText = av => av.where.map(b => BROKERS[b].short).join(' · ');

export function buyText(av) {
  switch (av.status) {
    case 'yes': return `Buyable at ${whereText(av)}`;
    case 'likely': return `Likely at ${whereText(av)}`;
    case 'maybe': return 'Check your broker';
    case 'unlikely': return 'Probably not buyable';
    default: return 'Not buyable';
  }
}

export function buyTip(av) {
  return Object.entries(av.per).map(([b, p]) => `${BROKERS[b].label}: ${BUY[p.status].short}${p.confirmed ? ' (you confirmed)' : ' (estimate)'}\n  ${p.reason}`).join('\n');
}

/** Inline availability chip. `label: false` shows the mark only. */
export function buyChip(av, { label = true } = {}) {
  return html`<span class="buy" data-s="${av.status}" data-tip="${buyTip(av)}" aria-label="${buyText(av)}"><i aria-hidden="true">${MARK[av.status]}</i>${label ? buyText(av) : ''}</span>`;
}

/** Per-broker rows with buttons to confirm or rule out the estimate. */
export function buyBlock(av, { name }) {
  const t = av.ticker;
  return html`<div class="buy-block">
    <ul class="buy-rows">${Object.entries(av.per).map(([b, p]) => html`<li>
      <span class="buy-b">${BROKERS[b].label}</span>
      <span class="buy" data-s="${p.status}"><i aria-hidden="true">${MARK[p.status]}</i>${BUY[p.status].short}${p.confirmed ? '' : html`<em>estimate</em>`}</span>
      <span class="buy-acts">
        <button class="btn ghost sm" type="button" data-buy-mark="${`${t}|${b}|${p.confirmed && p.status === 'yes' ? 'clear' : 'yes'}`}" aria-pressed="${p.confirmed && p.status === 'yes'}" data-tip="${p.confirmed && p.status === 'yes' ? 'Undo' : `You found it in ${BROKERS[b].label}`}">✓ Can buy</button>
        <button class="btn ghost sm" type="button" data-buy-mark="${`${t}|${b}|${p.confirmed && p.status === 'no' ? 'clear' : 'no'}`}" aria-pressed="${p.confirmed && p.status === 'no'}" data-tip="${p.confirmed && p.status === 'no' ? 'Undo' : `Not offered in ${BROKERS[b].label}`}">✕ Not there</button>
      </span>
      <span class="buy-why">${p.reason}</span>
    </li>`)}</ul>
    <div class="buy-foot"><a class="xs" href="${`https://www.google.com/search?q=${encodeURIComponent(`${name || t} ${t} Aktie ISIN`)}`}" target="_blank" rel="noopener noreferrer">Find the ISIN to search your app ↗</a><button class="linkish xs" type="button" data-brokers>Change brokers</button></div>
  </div>`;
}

/** Settings dialog content: which brokers the investor uses. */
export function brokerForm(st) {
  const { use, marks } = brokerSettings(st);
  const confirmed = Object.values(marks).reduce((n, m) => n + Object.keys(m).length, 0);
  return html`<div class="buy-form">
    <p class="small muted">Signals you cannot buy drop out of the radar and the plan. Pick the brokers you trade with.</p>
    ${Object.entries(BROKERS).map(([k, b]) => html`<label class="check"><input type="checkbox" data-broker="${k}" ${use.includes(k) ? 'checked' : ''}> <b>${b.label}</b> <span class="xs muted">· ${b.venue}</span></label>`)}
    <p class="xs muted">None of these brokers publishes its instrument list where this page can read it, so availability is an estimate from the listing, the kind of security and its size. Rules that hold for any EU retail account: US-listed ETFs and closed-end funds cannot be bought (no PRIIPs key information document). When you check a stock in your app, mark it on its card and that answer wins${confirmed ? ` (you have confirmed ${confirmed} so far)` : ''}.</p>
  </div>`;
}
