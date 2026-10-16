import { html, raw, esc } from './html.js';
import { fmtUSD } from '../core/util.js';
import { nameOf } from './brand.js';

const W = 960, H = 400, L = 64, R = 96, T = 34, B = 48;

/**
 * Bubble chart: lobbying in the last four quarters (log scale) against the
 * members of Congress holding the stock; bubble area = federal awards in 12
 * months; filled accent = insiders bought in the current window.
 */
export function influenceChart(points, { insiders = new Set() } = {}) {
  if (!points.length) return '';
  const lmax = Math.max(1e6, ...points.map(p => p.lobby)) * 1.4;
  const lo = 1e4;
  const x = v => (v > lo ? L + 40 + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(lmax) - Math.log10(lo))) * (W - L - R - 40) : L + 14);
  const ymax = Math.max(2, ...points.map(p => p.members)) + 1;
  const y = v => H - B - (v / ymax) * (H - T - B);
  const amax = Math.max(1, ...points.map(p => p.awards));
  const r = v => 5 + 20 * Math.sqrt(v / amax);
  const xt = [1e5, 1e6, 1e7, 1e8].filter(v => v <= lmax * 1.2);
  const step = ymax > 40 ? 10 : ymax > 16 ? 5 : ymax > 6 ? 2 : 1;
  const yt = Array.from({ length: Math.floor(ymax / step) + 1 }, (_, i) => i * step);
  // Name the points that stand out: most held, biggest lobbyists, biggest award winners.
  const named = new Set([
    ...[...points].sort((a, b) => b.members - a.members).slice(0, 6),
    ...[...points].sort((a, b) => b.lobby - a.lobby).slice(0, 5),
    ...[...points].sort((a, b) => b.awards - a.awards).slice(0, 3)
  ].map(p => p.ticker));
  const order = [...points].sort((a, b) => b.awards - a.awards);
  let s = '';
  for (const v of yt) s += `<line class="if-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="if-ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  for (const v of xt) s += `<line class="if-grid" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}"/><text class="if-ax" x="${x(v)}" y="${H - B + 18}" text-anchor="middle">${esc(fmtUSD(v))}</text>`;
  s += `<text class="if-ax" x="${L + 14}" y="${H - B + 18}" text-anchor="middle">none</text>`;
  s += `<text class="if-title" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Lobbying, last four quarters (log scale)</text>`;
  s += `<text class="if-title" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Members of Congress holding it</text>`;
  // Labels go right, left, above or below their bubble, whichever clears the labels already placed; otherwise none.
  const placed = [];
  const clear = (a) => a.x0 >= L && a.x1 <= W - 4 && a.y0 >= 4 && a.y1 <= H - B && placed.every(b => a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  const labelFor = (t, cx, cy, rr) => {
    const w = t.length * 7.2 + 2, h = 12;
    for (const [lx, ly, anchor] of [[cx + rr + 4, cy + 4, 'start'], [cx - rr - 4, cy + 4, 'end'], [cx, cy - rr - 5, 'middle'], [cx, cy + rr + 13, 'middle']]) {
      const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
      const box = { x0, x1: x0 + w, y0: ly - h + 2, y1: ly + 2 };
      if (clear(box)) { placed.push(box); return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${esc(t)}</text>`; }
    }
    return '';
  };
  const labels = new Map();
  for (const p of [...points].sort((a, b) => b.members - a.members || b.lobby - a.lobby)) if (named.has(p.ticker)) labels.set(p.ticker, labelFor(p.ticker, x(p.lobby), y(p.members), r(p.awards)));
  for (const p of order) {
    const cx = x(p.lobby).toFixed(1), cy = y(p.members).toFixed(1), rr = r(p.awards).toFixed(1);
    const name = nameOf(p.ticker, p.company);
    const tip = `${name} (${p.ticker})\n${p.members} members hold it (${p.senate} Senate, ${p.house} House)\nLobbying, 4 quarters: ${fmtUSD(p.lobby)}\nFederal awards, 12 months: ${fmtUSD(p.awards)}${insiders.has(p.ticker) ? '\nInsiders bought in the current window' : ''}`;
    s += `<g class="if-pt${insiders.has(p.ticker) ? ' ins' : ''}" data-open="${esc(p.ticker)}" data-tip="${esc(tip)}" tabindex="0" role="button" aria-label="${esc(`${name}: ${p.members} members, lobbying ${fmtUSD(p.lobby)}`)}"><circle cx="${cx}" cy="${cy}" r="${rr}"/>${labels.get(p.ticker) || ''}</g>`;
  }
  return html`<div class="if-wrap">${raw(`<svg class="if-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lobbying against members of Congress holding each stock">${s}</svg>`)}
    <div class="if-legend xs muted"><span><i class="if-dot"></i>bubble size: federal awards, last 12 months</span><span><i class="if-dot ins"></i>insiders bought in the current window</span><span>click a bubble for the dossier</span></div></div>`;
}
