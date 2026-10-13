import { html, raw, esc } from './html.js';
import { clamp, ts, fmtDate, fmtUSD, fmtInt } from '../core/util.js';
import { DAY } from '../core/config.js';

const widthOf = el => Math.max(260, Math.round(el.clientWidth || el.parentElement?.clientWidth || 600));

function niceStep(max, n = 3) {
  const rawStep = max / n;
  const p = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const m = rawStep / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Column path with a 3px rounded data end and a square baseline. */
function colPath(x, y, w, base, r = 3) {
  const h = base - y;
  if (h <= 0.5) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${base}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${base}Z`;
}

/* ---------- Inline sparkline (daily activity) ---------- */
export function sparkline(values, { w = 76, h = 18 } = {}) {
  const n = values.length || 1;
  const max = Math.max(1, ...values);
  const bw = w / n;
  let s = '';
  values.forEach((v, i) => {
    if (!v) return;
    const bh = Math.max(2, (v / max) * h);
    s += `<rect x="${(i * bw).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${Math.max(1, bw - 0.6).toFixed(2)}" height="${bh.toFixed(2)}"${i >= n - 7 ? ' class="on"' : ''}/>`;
  });
  return raw(`<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" stroke="var(--line-3)"/>${s}</svg>`);
}

/* ---------- Factor contributions ---------- */
export function stackbar(factors, width = 96) {
  const parts = factors.filter(f => f.contrib > 0.2);
  return raw(`<span class="stackbar" style="width:${width}px" aria-hidden="true">${parts.map(f => `<i data-g="${f.group}" style="width:${f.contrib.toFixed(2)}%"></i>`).join('')}</span>`);
}

export function waterfall(signal) {
  let acc = 0;
  const rows = signal.factors.map(f => {
    const start = acc;
    acc += f.contrib;
    const left = clamp((start / 100) * 100, 0, 100);
    const width = clamp((f.contrib / 100) * 100, 0, 100 - left);
    const tip = `${f.label}\nRaw ${(f.norm * 100).toFixed(0)}% × weight ${f.weight}${f.mult < 0.999 ? ` × ${f.mult.toFixed(2)} adjustment` : ''} = ${f.contrib.toFixed(1)} pts`;
    return html`<div class="wf-row" data-tip="${tip}"><span class="n">${f.label}</span><span class="track"><i data-g="${f.group}" style="left:${left}%;width:${Math.max(width, f.contrib > 0 ? 0.6 : 0)}%"></i></span><span class="v">${f.contrib >= 0.05 ? '+' + f.contrib.toFixed(1) : '0'}</span></div>`;
  });
  return html`<div class="wf">${rows}<div class="wf-row total"><span class="n">Score</span><span class="track"><i data-g="cross" style="left:0;width:${signal.score}%;opacity:.35"></i></span><span class="v">${signal.score}</span></div>
    ${signal.notes.length ? html`<div class="wf-notes">${signal.notes.map(n => html`<span>× ${n.mult.toFixed(2)} ${n.label}</span>`)}</div>` : ''}</div>`;
}

/* ---------- Daily activity with brush ---------- */
export function activityChart(el, { days, insider, congress, range, onRange }) {
  const W = widthOf(el), H = 150, L = 34, R = 8, T = 10, B = 22;
  const n = days.length;
  const band = (W - L - R) / n;
  const bw = Math.max(1, Math.min(18, band - 2));
  const totals = days.map((_, i) => insider[i] + congress[i]);
  const max = Math.max(1, ...totals);
  const step = niceStep(max, 3);
  const top = Math.ceil(max / step) * step;
  const Y = v => T + (H - T - B) * (1 - v / top);
  const X = i => L + band * i;
  let s = '';
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="${v ? 'gl' : 'bl'}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${fmtInt(v)}</text>`;
  if (range) {
    const a = days.indexOf(range[0]), b = days.indexOf(range[1]);
    if (a >= 0 && b >= 0) s += `<rect class="brush" x="${X(a)}" y="${T}" width="${X(b) + band - X(a)}" height="${H - T - B}"/>`;
  }
  days.forEach((d, i) => {
    const x = X(i) + (band - bw) / 2;
    const yi = Y(insider[i]);
    const yc = Y(insider[i] + congress[i]);
    const base = Y(0);
    if (insider[i]) s += `<path class="m-ins" d="${colPath(x, yi, bw, base, congress[i] ? 0 : 2)}"/>`;
    if (congress[i]) s += `<path class="m-cong" d="${colPath(x, yc, bw, yi - (insider[i] ? 1.5 : 0), 2)}"/>`;
    s += `<rect class="hit" x="${X(i)}" y="${T}" width="${band}" height="${H - T - B}" data-i="${i}" data-tip="${esc(`${fmtDate(d)}\nInsider buys: ${insider[i]}\nCongress filings: ${congress[i]}`)}"/>`;
    const dt = new Date(ts(d));
    if (dt.getUTCDay() === 1 && (n <= 31 || dt.getUTCDate() <= 7)) s += `<text class="ax" x="${X(i) + band / 2}" y="${H - 6}" text-anchor="middle">${fmtDate(d, { year: false })}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Daily insider purchases and congressional filings">${s}</svg>`;

  // Drag to select a date range; click a single day to toggle it.
  const svg = el.firstChild;
  let start = null;
  const idx = ev => {
    const box = svg.getBoundingClientRect();
    const x = (ev.clientX - box.left) * (W / box.width);
    return clamp(Math.floor((x - L) / band), 0, n - 1);
  };
  svg.addEventListener('pointerdown', ev => { start = idx(ev); svg.setPointerCapture(ev.pointerId); });
  svg.addEventListener('pointerup', ev => {
    if (start == null) return;
    const end = idx(ev);
    const a = Math.min(start, end), b = Math.max(start, end);
    start = null;
    if (range && a === b && range[0] === days[a] && range[1] === days[a]) onRange(null);
    else onRange([days[a], days[b]]);
  });
}

/* ---------- 12-month event timeline ---------- */
export function timeline(el, { events, from, to, lanes }) {
  const W = widthOf(el);
  const L = W < 520 ? 70 : 92, R = 10, laneH = 54, T = 4;
  const H = T + laneH * lanes.length + 24;
  const t0 = ts(from), t1 = ts(to) + DAY;
  const X = t => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  let s = '';
  const cur = new Date(t0);
  cur.setUTCDate(1);
  cur.setUTCMonth(cur.getUTCMonth() + 1);
  while (cur.getTime() < t1) {
    const x = X(cur.getTime());
    s += `<line class="gl" x1="${x}" x2="${x}" y1="${T}" y2="${T + laneH * lanes.length}"/>`;
    const m = cur.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const lbl = cur.getUTCMonth() === 0 ? `${m} ’${String(cur.getUTCFullYear()).slice(2)}` : m;
    if (W >= 560 || cur.getUTCMonth() % 2 === 0) s += `<text class="ax" x="${x}" y="${H - 7}" text-anchor="middle">${lbl}</text>`;
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  lanes.forEach((name, i) => {
    const y0 = T + i * laneH;
    s += `<text class="ax-l" x="0" y="${y0 + laneH / 2 + 4}">${esc(name)}</text>`;
    s += `<line class="bl" x1="${L}" x2="${W - R}" y1="${y0 + laneH}" y2="${y0 + laneH}"/>`;
  });
  const size = usd => 3.5 + 4.5 * clamp(Math.log10(Math.max(usd, 1) / 1000) / 4, 0, 1);
  for (const e of [...events].sort((a, b) => b.usd - a.usd)) {
    const t = ts(e.date);
    if (!(t >= t0 && t < t1)) continue;
    const x = X(t);
    const y0 = T + e.lane * laneH;
    const cy = y0 + laneH / 2;
    if (e.kind === 'award') {
      const h = 5 + 30 * clamp(Math.log10(Math.max(e.usd, 1) / 1e5) / 4, 0, 1);
      const base = y0 + laneH - 4;
      s += `<g data-tip="${esc(e.tip)}"><rect class="hit" x="${x - 5}" y="${base - h - 4}" width="10" height="${h + 8}"/><line x1="${x}" x2="${x}" y1="${base}" y2="${base - h}" stroke="var(--grp-cross)" stroke-width="2" stroke-linecap="round"/></g>`;
    } else {
      const r = size(e.usd);
      const up = e.kind === 'buy';
      const cy2 = up ? cy - 8 : cy + 8;
      const pts = up
        ? `${x},${cy2 - r} ${x + r},${cy2 + r * 0.8} ${x - r},${cy2 + r * 0.8}`
        : `${x - r},${cy2 - r * 0.8} ${x + r},${cy2 - r * 0.8} ${x},${cy2 + r}`;
      s += `<g data-tip="${esc(e.tip)}"><circle class="hit" cx="${x}" cy="${cy2}" r="${r + 6}"/><polygon points="${pts}" class="${up ? 'm-buy' : 'm-sell'} ring"/></g>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Event timeline">${s}</svg>`;
}

/* ---------- Single-series columns ---------- */
export function columns(el, data, { format = fmtUSD, height = 160, label = 'Values' } = {}) {
  const W = widthOf(el), H = height, L = 48, R = 8, T = 18, B = 22;
  const max = Math.max(1, ...data.map(d => d.value));
  const step = niceStep(max, 3);
  const top = Math.ceil(max / step) * step;
  const Y = v => T + (H - T - B) * (1 - v / top);
  const band = (W - L - R) / Math.max(1, data.length);
  const bw = Math.min(22, band * 0.62);
  let s = '';
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="${v ? 'gl' : 'bl'}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${esc(format(v))}</text>`;
  const maxI = data.findIndex(d => d.value === max);
  data.forEach((d, i) => {
    const cx = L + band * i + band / 2;
    const y = Y(d.value);
    s += `<g data-tip="${esc(`${d.label}: ${format(d.value)}`)}"><rect class="hit" x="${cx - band / 2}" y="${T}" width="${band}" height="${H - T - B}"/><path class="m-acc" d="${colPath(cx - bw / 2, y, bw, Y(0))}"/></g>`;
    if (W >= 420 || i % 2 === (data.length - 1) % 2) s += `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    if (i === maxI || i === data.length - 1) s += `<text class="vl" x="${cx}" y="${y - 5}" text-anchor="middle">${esc(format(d.value))}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

/* ---------- Line with crosshair ---------- */
export function diverging(el, data, { format = v => fmtInt(v), label = 'Net' } = {}) {
  const W = widthOf(el), H = 130, L = 8, R = 8, T = 10, B = 22;
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const mid = T + (H - T - B) / 2, half = (H - T - B) / 2 - 3;
  const band = (W - L - R) / Math.max(1, data.length);
  const bw = Math.min(22, band * 0.6);
  let s = `<line class="bl" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>`;
  data.forEach((d, i) => {
    const cx = L + band * i + band / 2, x0 = cx - bw / 2, h = (Math.abs(d.value) / max) * half;
    let path = '';
    if (h > 0.5) {
      const r = Math.min(3, h);
      path = d.value > 0
        ? `M${x0},${mid}L${x0},${mid - h + r}Q${x0},${mid - h} ${x0 + r},${mid - h}L${x0 + bw - r},${mid - h}Q${x0 + bw},${mid - h} ${x0 + bw},${mid - h + r}L${x0 + bw},${mid}Z`
        : `M${x0},${mid}L${x0},${mid + h - r}Q${x0},${mid + h} ${x0 + r},${mid + h}L${x0 + bw - r},${mid + h}Q${x0 + bw},${mid + h} ${x0 + bw},${mid + h - r}L${x0 + bw},${mid}Z`;
    }
    s += `<g data-tip="${esc(`${d.label}: ${d.value > 0 ? '+' : ''}${format(d.value)}`)}"><rect class="hit" x="${cx - band / 2}" y="${T}" width="${band}" height="${H - T - B}"/>${path ? `<path d="${path}" class="${d.value > 0 ? 'm-buy' : 'm-sell'}"/>` : `<circle cx="${cx}" cy="${mid}" r="2" fill="var(--fg-3)"/>`}</g>`;
    s += `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

/* Triangle glyph for buy/sell (shape carries the meaning, not only color). */
export function tri(kind, s = 5) {
  const up = kind === 'buy';
  const h = s * 1.7;
  const pts = up ? `${s},0 ${2 * s},${h} 0,${h}` : `0,0 ${2 * s},0 ${s},${h}`;
  return raw(`<svg width="${2 * s}" height="${h}" viewBox="0 0 ${2 * s} ${h}" aria-hidden="true"><polygon points="${pts}" class="${up ? 'm-buy' : 'm-sell'}"/></svg>`);
}

/* ---------- Price history with trade markers ---------- */
/**
 * Daily closes as a line with buy/sell triangles where insiders or members
 * traded. Markers snap to the nearest trading day on or after their date.
 * @param {{t:string[], c:number[], markers?:{date:string, kind:'buy'|'sell', who:string, tip:string}[], ref?:{value:number,label:string}}} p
 */
export function priceChart(el, { t, c, markers = [], ref = null, currency = '$' }) {
  const W = widthOf(el), H = 220, L = 46, R = 58, T = 14, B = 24;
  const n = t.length;
  if (n < 2) { el.innerHTML = ''; return; }
  const vals = ref ? [...c, ref.value] : c;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  lo = Math.max(0, lo - pad); hi += pad;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = i => L + (W - L - R) * (i / (n - 1));
  const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const fmt = v => currency + (v >= 1000 ? fmtInt(v) : v >= 10 ? v.toFixed(0) : v.toFixed(2));
  let s = '';
  for (let v = lo; v <= hi + 1e-9; v += step) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${esc(fmt(v))}</text>`;
  // month ticks
  let lastM = '';
  for (let i = 0; i < n; i++) {
    const m = t[i].slice(0, 7);
    if (m !== lastM) {
      if (lastM && (i > n * 0.04) && (i < n * 0.97)) s += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(new Date(t[i] + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }))}</text>`;
      lastM = m;
    }
  }
  const up = c[n - 1] >= c[0];
  const col = up ? 'var(--buy)' : 'var(--sell)';
  const pts = c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  s += `<path d="M${pts[0]}L${pts.join('L')}L${X(n - 1)},${Y(lo)}L${X(0)},${Y(lo)}Z" fill="${col}" fill-opacity=".08"/>`;
  s += `<path d="M${pts.join('L')}" fill="none" stroke="${col}" stroke-width="1.75" stroke-linejoin="round"/>`;
  if (ref) s += `<line x1="${L}" x2="${W - R}" y1="${Y(ref.value)}" y2="${Y(ref.value)}" stroke="var(--ent-insider)" stroke-dasharray="4 3" stroke-width="1"/><text class="ax" x="${W - R + 4}" y="${Y(ref.value) + 3.5}" style="fill:var(--ent-insider)">${esc(ref.label)}</text>`;
  // markers
  const idxOf = d => { let lo2 = 0, hi2 = n - 1; if (d > t[hi2]) return -1; while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (t[mid] < d) lo2 = mid + 1; else hi2 = mid; } return lo2; };
  const stack = new Map();
  const mk = [];
  for (const m of markers) {
    if (m.date < t[0]) continue;
    const i = idxOf(m.date);
    if (i < 0) continue;
    const k = `${i}|${m.kind}`;
    const layer = stack.get(k) || 0;
    stack.set(k, layer + 1);
    if (layer > 2) continue;
    const x = X(i), y = Y(c[i]);
    const sz = 5;
    const yy = m.kind === 'buy' ? y + 8 + layer * 10 : y - 8 - layer * 10;
    const poly = m.kind === 'buy' ? `${x},${yy - sz} ${x + sz},${yy + sz * .8} ${x - sz},${yy + sz * .8}` : `${x - sz},${yy - sz * .8} ${x + sz},${yy - sz * .8} ${x},${yy + sz}`;
    mk.push(`<polygon points="${poly}" class="${m.kind === 'buy' ? 'm-buy' : 'm-sell'} ring" data-tip="${esc(m.tip)}" style="cursor:default"/>`);
  }
  const li = n - 1;
  s += `<circle cx="${X(li)}" cy="${Y(c[li])}" r="3.5" fill="${col}" class="ring"/><text class="vl" x="${X(li) + 7}" y="${Y(c[li]) + 4}">${esc(fmt(c[li]))}</text>`;
  s += `<g class="xh" visibility="hidden"><line class="bl" y1="${T}" y2="${H - B}"/><circle r="4" class="m-acc ring"/></g><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
  s += mk.join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Daily closing price with trade markers">${s}</svg>`;
  const svg = el.firstChild, xh = svg.querySelector('.xh'), hit = svg.querySelector('rect.hit');
  const tipEl = document.getElementById('tip');
  hit.addEventListener('pointermove', ev => {
    const box = svg.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W / box.width);
    const i = clamp(Math.round(((px - L) / (W - L - R)) * (n - 1)), 0, n - 1);
    const [ln, cc] = xh.children;
    ln.setAttribute('x1', X(i)); ln.setAttribute('x2', X(i));
    cc.setAttribute('cx', X(i)); cc.setAttribute('cy', Y(c[i]));
    xh.setAttribute('visibility', 'visible');
    const chg = (c[i] / c[0] - 1) * 100;
    hit.setAttribute('data-tip', `${fmtDate(t[i])}\nClose ${fmt(c[i])}\n${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% since ${fmtDate(t[0], { year: false })}`);
  });
  hit.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); tipEl.hidden = true; });
}
