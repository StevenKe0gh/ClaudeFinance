import { html } from './html.js';
import { fmtUSD, fmtDate } from '../core/util.js';
import { STAGES } from '../model/policy.js';

/** Five-step legislative track: Introduced → Law. */
export function stageTrack(stage) {
  const step = stage?.step || 1;
  return html`<span class="pl-stage" data-tip="${`${stage?.raw || 'Introduced'} · step ${step} of 5`}" aria-label="${STAGES[step - 1]}">${STAGES.map((_, i) => html`<i${i < step ? html` class="on"` : ''}></i>`)}<em>${STAGES[step - 1]}</em></span>`;
}

/** "Washington" lines for one company: bills that name it and recent federal awards. */
export function policyLines(p, { max = 2 } = {}) {
  if (!p || (!p.bills.length && !p.contracts)) return '';
  const bills = [...p.bills].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return html`<ul class="pl-lines">
    ${bills.slice(0, max).map(b => html`<li><span class="pl-ic" aria-hidden="true">§</span><span><b>${b.billId || b.id}</b> ${b.title}${b.sponsor ? html` <em>· ${b.sponsor}${b.date ? `, ${fmtDate(b.date, { year: false })}` : ''}</em>` : ''}</span></li>`)}
    ${bills.length > max ? html`<li class="xs muted">+${bills.length - max} more bills name it</li>` : ''}
    ${p.contracts ? html`<li><span class="pl-ic" aria-hidden="true">$</span><span><b>${fmtUSD(p.contracts.usd)}</b> in federal awards over 60 days <em>· ${p.contracts.n} action${p.contracts.n > 1 ? 's' : ''}, mostly ${p.contracts.agency}</em></span></li>` : ''}
  </ul>`;
}
