import { html } from './html.js';
import { fmtUSD, fmtCompact } from '../core/util.js';
import { ACTION_LABEL, quarterLabel, WHALES } from '../model/whales.js';

const retChip = w => (w.ret == null ? '' : html`<span class="wh-ret" data-tip="${`${w.manager} · ${w.basis}`}">${w.ret > 0 ? '+' : ''}${w.ret}%${/first half/.test(w.basis) ? ' H1' : ''} ’25</span>`);

/** Whale moves and holdings for one company, from a whales.get(ticker) entry. */
export function whaleBlock(entry) {
  if (!entry || entry.status === 'loading') return html`<p class="xs muted wh-load">Checking 13F filings of the ${WHALES.length - 1} top funds and Berkshire…</p>`;
  if (entry.status === 'error') return html`<p class="xs muted">13F data could not be loaded.</p>`;
  const { moves, holders } = entry.data;
  const holdOnly = holders.filter(h => !moves.some(m => m.whale.id === h.whale.id));
  if (!moves.length && !holdOnly.length) return html`<p class="xs muted">None of the ${WHALES.length - 1} top funds or Berkshire reported a position or a large move.</p>`;
  return html`<ul class="wh-rows">
    ${moves.slice(0, 6).map(m => html`<li data-a="${m.action}">
      <span class="wh-n">${m.whale.name}${retChip(m.whale)}</span>
      <span class="wh-a" data-a="${m.action}">${ACTION_LABEL[m.action]}</span>
      <span class="wh-v mono">${m.usd ? fmtUSD(m.usd) : m.shares ? `${fmtCompact(m.shares)} sh` : ''}${m.pct != null && Number.isFinite(m.pct) && m.action !== 'exit' ? html` <em>${m.pct > 0 ? '+' : ''}${Math.round(m.pct)}%</em>` : ''}</span>
      <span class="wh-q xs muted">${quarterLabel(m.quarter)}</span>
    </li>`)}
    ${holdOnly.map(h => html`<li data-a="hold">
      <span class="wh-n">${h.whale.name}${retChip(h.whale)}</span>
      <span class="wh-a" data-a="hold">Holds</span>
      <span class="wh-v mono">${fmtCompact(h.shares)} sh</span>
      <span class="wh-q xs muted">${h.date ? `as of ${h.date}` : ''}</span>
    </li>`)}
  </ul>
  <p class="xs dim">13F filings appear 45 days after each quarter ends, so these moves are one quarter old.${entry.partial ? ' Part of the data could not be loaded.' : ''}</p>`;
}
