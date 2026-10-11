import { html } from './html.js';
import { connectorErrorCopy } from '../data/connector.js';
import { ROLE_LABEL } from '../model/clean.js';
import { fmtUSD } from '../core/util.js';

export const tierChip = (t, lg = false) =>
  html`<span class="tier${lg ? ' lg' : ''}" data-t="${t}" data-tip="${`Tier ${t}: ${{ A: 'strongest evidence', B: 'solid evidence', C: 'some evidence', D: 'weak or mechanical' }[t]}`}">${t}</span>`;

export function flagsList(flags, max = 99) {
  if (!flags.length) return html`<span class="dim">—</span>`;
  const shown = flags.slice(0, max);
  const rest = flags.length - shown.length;
  return html`<span class="flags">${shown.map(f => html`<span class="flag" data-tone="${f.tone}" data-tip="${f.detail}">${f.label}</span>`)}${rest > 0 ? html`<span class="flag more" data-tip="${flags.slice(max).map(f => f.label).join('\n')}">+${rest}</span>` : ''}</span>`;
}

export const roleChip = role => html`<span class="role" data-r="${role}">${ROLE_LABEL[role] || role}</span>`;
export const partyChip = p => html`<span class="party" data-tip="${{ D: 'Democrat', R: 'Republican', I: 'Independent' }[p] || 'Party unknown'}">${p || '?'}</span>`;

export function errorAlert(e) {
  const c = connectorErrorCopy(e);
  return html`<div class="alert" data-tone="error" role="alert"><div><b>${c.title}</b>${c.body} <span class="dim mono">(${c.code})</span></div></div>`;
}

export const kpi = (label, value, sub = '') => html`<div class="kpi"><span class="label">${label}</span><span class="v">${value}</span><span class="s">${sub}</span></div>`;

export const scoreCell = s => html`<span class="score" data-tip="${`Conviction score ${s.score} / 100 · rank ${s.rank}`}"><b>${s.score}</b><span class="meter"><i style="width:${s.score}%"></i></span></span>`;

export const skeletonRows = (cols, n = 8) =>
  html`${Array.from({ length: n }, () => html`<tr>${Array.from({ length: cols }, (_, i) => html`<td><div class="skel" style="width:${[30, 70, 60, 80, 50, 90][i % 6]}%"></div></td>`)}</tr>`)}`;

export const usdCell = v => (v ? fmtUSD(v) : '—');
