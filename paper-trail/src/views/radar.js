import { html, raw, mount, on, $, esc } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip, roleChip, partyChip } from '../ui/parts.js';
import { brandHead, nameOf, sectorOf, logoSrc, logo } from '../ui/brand.js';
import { monogram } from '../core/names.js';
import { fmtUSD, fmtMoney, fmtInt, fmtAge, fmtDate, fmtSignedPct, dayDiff, titleCase, clamp } from '../core/util.js';
import { allocate } from '../model/allocate.js';
import { ROLE_LABEL } from '../model/clean.js';
import { PRESETS } from '../model/score.js';
import { trackChip, trackLine } from '../ui/track.js';
import { policyLines } from '../ui/policy.js';
import { buyOf, buyBlock, buyText } from '../ui/brokers.js';
import { notBuyable, doubtful } from '../model/brokers.js';
import { quoteFor } from './signals.js';

const KIND_LABEL = { insider: 'Insiders', congress: 'Congress', cross: 'Both' };
const VERDICT = { A: 'Strong signal', B: 'Worth a look', C: 'Weak signal', D: 'Noise' };
const SOURCES = [['all', 'All'], ['oversight', 'Oversight'], ['congress', 'Congress'], ['insider', 'Insiders'], ['cross', 'Both']];
const ROLE_WORD = { chair: 'chair', ranking: 'ranking member' };
const MAX_NODES = 90;

/**
 * Radar: the whole workflow in one window. Spot (a radial map where the
 * strongest signals sit closest to the centre), understand (a plain-language
 * story card for the focused company) and decide (add to the plan or skip),
 * with the $10k plan redrawn underneath as you go.
 */
export function createRadarView(ctx) {
  const { store, portfolio } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-radar';
  let source = 'all';
  let showSkipped = false;
  let focus = null;
  let layout = { key: null, nodes: [] };
  const prev = new Map();
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  mount(el, html`
    <div class="view-h rd-head">
      <div><h1>Radar</h1><p id="rd-today">Spot the strongest insider and congressional buying, read why it matters, then decide. Everything you add lands in your plan below.</p></div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Who bought" id="rd-src">${SOURCES.map(([k, l]) => html`<button type="button" data-src="${k}">${l}</button>`)}</div>
        <label class="check"><input type="checkbox" id="rd-skipped"> Show skipped</label>
        <button class="btn ghost" type="button" data-nav="signals" data-tip="The same signals as a sortable table">List view</button>
      </div>
    </div>
    <section class="panel rd-plan"><div class="rd-plan-row">
      <div class="rd-plan-l"><span class="label">Your plan</span><b id="rd-plan-cap"></b><span class="xs muted" id="rd-plan-src"></span></div>
      <div class="rd-plan-main" id="rd-plan"></div>
      <button class="btn ghost sm" type="button" data-nav="portfolio" data-tip="Change the amount, cash reserve, cap and sizing method">Adjust</button>
    </div></section>
    <div class="rd-grid">
      <section class="panel rd-stage-panel">
        <div class="panel-h"><h2><span class="step">1</span> Spot</h2><span class="src" id="rd-count"></span><span class="grow"></span><span class="rd-progress" id="rd-progress"></span></div>
        <div class="rd-stage" id="rd-stage"><div class="rd-sweep" aria-hidden="true"></div><svg id="rd-svg" role="img" aria-label="Radar of insider and congressional buying"></svg></div>
        <div class="rd-legend" id="rd-legend"></div>
      </section>
      <section class="panel rd-card" id="rd-card" aria-live="polite"></section>
    </div>`);

  /* ---------- Data ---------- */
  const skippedMap = st => st.workspace?.skipped || {};
  /** A skip holds until the company files something new. */
  const isSkipped = (st, s) => { const d = skippedMap(st)[s.ticker]; return !!d && !(s.lastActivity && s.lastActivity > d); };
  const kindOf = s => {
    const i = s.insider.buyers.length > 0;
    const c = s.congress.members.some(m => !m.washOnly) || s.congress.buys > 0;
    return i && c ? 'cross' : c ? 'congress' : 'insider';
  };

  function candidates(st) {
    const owned = new Set(portfolio.derived()?.usTickers || []);
    const plan = new Set(st.workspace.watch.map(w => w.ticker));
    const buy = buyOf(st);
    return st.signals
      .filter(s => (s.tier !== 'D' || owned.has(s.ticker) || plan.has(s.ticker)))
      // What the investor's brokers cannot sell leaves the radar, unless they already hold or plan it.
      .filter(s => owned.has(s.ticker) || plan.has(s.ticker) || !notBuyable(buy(s.ticker, s.company)))
      .filter(s => source === 'all' || (source === 'oversight' ? s.congress.overseers > 0 : kindOf(s) === source))
      .filter(s => showSkipped || !isSkipped(st, s))
      .slice(0, MAX_NODES)
      .map(s => ({
        s, t: s.ticker, name: nameOf(s.ticker, s.company), sector: sectorOf(s.ticker) || 'Other',
        usd: s.insider.usd + s.congress.usd, kind: kindOf(s),
        fresh: s.lastActivity && st.data ? dayDiff(s.lastActivity, st.data.asOf) <= 3 : false,
        owned: owned.has(s.ticker), planned: plan.has(s.ticker), skipped: isSkipped(st, s), oversight: s.congress.overseers > 0,
        buy: buy(s.ticker, s.company)
      }));
  }

  /** Decision queue: strongest first, undecided only. */
  function queue(st) {
    return candidates(st).filter(n => !n.planned && !n.skipped);
  }

  /* ---------- Layout ---------- */
  function computeLayout(st, items, S) {
    const key = `${S}|${items.map(n => n.t + n.s.score).join(',')}`;
    if (layout.key === key) return layout;
    const cx = S / 2, cy = S / 2;
    const R = S / 2 - (S < 480 ? 52 : 54);
    const top = Math.max(st.model.tiers.A + 10, ...items.map(n => n.s.score + 2));
    const floor = Math.min(st.model.tiers.C - 3, ...items.map(n => n.s.score - 1));
    const rOf = sc => R * (0.1 + 0.9 * clamp((top - sc) / (top - floor), 0, 1));
    const sorted = items.map(n => n.usd).sort((a, b) => a - b);
    const maxUsd = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] || 1);
    const minB = S < 480 ? 4.5 : 6, maxB = S < 480 ? 15 : 22;
    const size = usd => minB + (maxB - minB) * Math.sqrt(Math.min(usd, maxUsd) / maxUsd);

    // Sectors as wedges, widest first from twelve o'clock; width follows count with a floor.
    const bySector = new Map();
    for (const n of items) { if (!bySector.has(n.sector)) bySector.set(n.sector, []); bySector.get(n.sector).push(n); }
    const sectors = [...bySector].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const weight = c => Math.sqrt(c) + 0.6;
    const total = sectors.reduce((s, [, g]) => s + weight(g.length), 0) || 1;
    let a0 = -Math.PI / 2;
    const wedges = sectors.map(([name, g]) => {
      const span = (2 * Math.PI * weight(g.length)) / total;
      const w = { name, count: g.length, a0, a1: a0 + span, mid: a0 + span / 2 };
      a0 += span;
      g.sort((x, y) => y.s.score - x.s.score).forEach((n, i) => {
        const f = g.length === 1 ? 0.5 : 0.15 + 0.7 * ((i * 0.618) % 1);
        n.angle = w.a0 + span * f;
        n.r = size(n.usd);
        n.tr = rOf(n.s.score);
        n.tx = cx + Math.cos(n.angle) * n.tr;
        n.ty = cy + Math.sin(n.angle) * n.tr;
        const p = prev.get(n.t);
        n.x = p ? p.x : n.tx; n.y = p ? p.y : n.ty;
      });
      return w;
    });

    const d3 = window.d3;
    if (d3 && items.length) {
      const sim = d3.forceSimulation(items)
        .force('x', d3.forceX(n => n.tx).strength(0.32))
        .force('y', d3.forceY(n => n.ty).strength(0.32))
        .force('c', d3.forceCollide(n => n.r + 2.5).iterations(3))
        .stop();
      for (let i = 0; i < 240; i++) sim.tick();
    }
    for (const n of items) {
      const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
      const lim = R - n.r - 1;
      if (d > lim) { n.x = cx + (dx / d) * lim; n.y = cy + (dy / d) * lim; }
    }
    const tiers = st.model.tiers;
    layout = { key, S, cx, cy, R, rOf, wedges, nodes: items, rings: [['A', tiers.A], ['B', tiers.B], ['C', tiers.C]].map(([t, v]) => ({ t, v, r: rOf(v) })).filter(x => x.r > R * 0.12 && x.r <= R + 1) };
    return layout;
  }

  /* ---------- Radar ---------- */
  function drawRadar(st) {
    const stage = $('#rd-stage', el);
    const svg = $('#rd-svg', el);
    const items = candidates(st);
    const S = Math.round(clamp(Math.min(stage.clientWidth || 640, (window.innerHeight || 900) - 300), 300, 760));
    stage.style.setProperty('--S', S + 'px');
    if (!st.signals.length) {
      const R = S / 2 - 54;
      svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
      svg.innerHTML = [0.35, 0.65, 1].map(f => `<circle class="rd-ring" cx="${S / 2}" cy="${S / 2}" r="${R * f}"/>`).join('') +
        `<text class="rd-wait" x="${S / 2}" y="${S / 2 + 4}" text-anchor="middle">${st.caps.mcp === 'off' ? 'Open on claude.ai for live filings' : 'Pulling filings from Quiver…'}</text>`;
      stage.classList.add('idle');
      return;
    }
    stage.classList.remove('idle');
    const L = computeLayout(st, items, S);
    const { cx, cy, R } = L;
    stage.style.setProperty('--D', `${Math.round(2 * R)}px`);
    if (!focus || !items.some(n => n.t === focus)) focus = (queue(st)[0] || items[0] || {}).t || null;

    let g = '';
    g += `<defs><clipPath id="rd-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>
      <radialGradient id="rd-core"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>`;
    g += `<circle cx="${cx}" cy="${cy}" r="${R}" class="rd-disc"/>`;
    g += `<circle cx="${cx}" cy="${cy}" r="${L.rings.length ? L.rings[0].r : R * 0.3}" fill="url(#rd-core)"/>`;
    // Sector wedges: alternate faint bands, hairline separators, labels outside.
    L.wedges.forEach((w, i) => {
      if (L.wedges.length > 1) {
        const x = cx + Math.cos(w.a0) * R, y = cy + Math.sin(w.a0) * R;
        g += `<line class="rd-spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      }
      if (i % 2 === 1 && L.wedges.length > 1) g += `<path class="rd-band" d="${arcPath(cx, cy, R, w.a0, w.a1)}"/>`;
      const span = w.a1 - w.a0;
      if (span > 0.16 || S >= 560) {
        const lr = R + (S < 480 ? 8 : 16);
        const lx = cx + Math.cos(w.mid) * lr, ly = cy + Math.sin(w.mid) * lr;
        const anchor = Math.abs(Math.cos(w.mid)) < 0.25 ? 'middle' : Math.cos(w.mid) > 0 ? 'start' : 'end';
        const small = S < 480;
        const label = small ? (TINY_SECTOR[w.name] || w.name).slice(0, 9) : shortSector(w.name);
        g += `<text class="rd-sector${small ? ' sm' : ''}" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}">${esc(label)}${small ? '' : `<tspan class="n"> ${w.count}</tspan>`}</text>`;
      }
    });
    for (const ring of L.rings) g += `<circle class="rd-ring" data-t="${ring.t}" cx="${cx}" cy="${cy}" r="${ring.r.toFixed(1)}"/>`;
    g += `<circle class="rd-ring outer" cx="${cx}" cy="${cy}" r="${R}"/>`;
    g += `<text class="rd-center" x="${cx}" y="${cy + 3.5}" text-anchor="middle">strongest</text>`;

    // Focus line from the centre.
    const fn = L.nodes.find(n => n.t === focus);
    if (fn) g += `<line class="rd-focus-line" x1="${cx}" y1="${cy}" x2="${fn.x.toFixed(1)}" y2="${fn.y.toFixed(1)}"/>`;

    // Nodes, weakest first so the strongest draw on top.
    const order = [...L.nodes].sort((a, b) => a.s.score - b.s.score);
    for (const n of order) g += nodeSvg(st, n, cx, cy);
    if (S >= 480 && L.rings.length) {
      // Put the tier labels along the emptiest spoke so they never sit under a company.
      let best = -Math.PI / 2, bestGap = -1;
      for (let k = 0; k < 24; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 12;
        let gap = Infinity;
        for (const ring of L.rings) {
          const lx = cx + Math.cos(a) * ring.r, ly = cy + Math.sin(a) * ring.r;
          for (const n of L.nodes) gap = Math.min(gap, Math.hypot(n.x - lx, n.y - ly) - n.r);
        }
        if (gap > bestGap) { bestGap = gap; best = a; }
      }
      // Text runs toward the centre on the left half and outward-but-inside on the right, never into the sector names.
      const left = Math.cos(best) < 0;
      for (const ring of L.rings) {
        const lx = cx + Math.cos(best) * ring.r, ly = cy + Math.sin(best) * ring.r;
        g += `<circle class="rd-ring-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2"/><text class="rd-ring-l" x="${(lx + (left ? 6 : -6)).toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="${left ? 'start' : 'end'}">tier ${ring.t} · ${ring.v}+</text>`;
      }
    }

    // Selective direct labels: the five strongest plus the focus, skipped on collision.
    const placed = [];
    const labelled = [...L.nodes].sort((a, b) => b.s.score - a.s.score).slice(0, S < 480 ? 3 : 5);
    if (fn && !labelled.includes(fn)) labelled.push(fn);
    for (const n of labelled) {
      const right = n.x >= cx;
      const text = short(n.name, 18);
      const w = text.length * 6.6 + 8, h = 14;
      const x = right ? n.x + n.r + 5 : n.x - n.r - 5;
      const box = { x0: right ? x : x - w, x1: right ? x + w : x, y0: n.y - h / 2, y1: n.y + h / 2 };
      if (n !== fn && placed.some(b => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue;
      placed.push(box);
      g += `<text class="rd-label${n === fn ? ' on' : ''}" x="${x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(text)}</text>`;
    }

    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svg.setAttribute('width', S);
    svg.setAttribute('height', S);
    svg.innerHTML = g;

    // Enter from the previous position (or the centre), then settle.
    const animate = !reduce();
    const nodesEl = svg.querySelectorAll('.rn');
    if (animate) {
      nodesEl.forEach(nodeEl => {
        const n = L.nodes.find(x => x.t === nodeEl.dataset.t);
        const p = prev.get(n.t) || { x: cx, y: cy, fresh: true };
        nodeEl.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.fresh ? 0.2 : 1})`;
        nodeEl.style.opacity = p.fresh ? '0' : '1';
        nodeEl.style.transitionDelay = p.fresh ? `${Math.min(500, (100 - n.s.score) * 6)}ms` : '0ms';
      });
      svg.getBoundingClientRect();
      requestAnimationFrame(() => nodesEl.forEach(nodeEl => {
        const n = L.nodes.find(x => x.t === nodeEl.dataset.t);
        nodeEl.style.transform = `translate(${n.x}px, ${n.y}px)`;
        nodeEl.style.opacity = '1';
      }));
    } else {
      nodesEl.forEach(nodeEl => { const n = L.nodes.find(x => x.t === nodeEl.dataset.t); nodeEl.style.transform = `translate(${n.x}px, ${n.y}px)`; });
    }
    prev.clear();
    for (const n of L.nodes) prev.set(n.t, { x: n.x, y: n.y });

    $('#rd-count', el).textContent = `${fmtInt(L.nodes.length)} companies · ${st.windowDays} days`;
    const inPlan = new Set(st.workspace.watch.map(w => w.ticker));
    const ab = st.signals.filter(s => s.tier === 'A' || s.tier === 'B');
    const decided = ab.filter(s => inPlan.has(s.ticker) || isSkipped(st, s)).length;
    mount($('#rd-progress', el), ab.length ? html`<span class="rd-prog-t">${fmtInt(decided)} of ${fmtInt(ab.length)} strong signals reviewed</span><span class="rd-prog-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${ab.length}" aria-valuenow="${decided}"><i style="width:${(100 * decided) / ab.length}%"></i></span>` : '');
    legend(st, L);
  }

  function nodeSvg(st, n, cx, cy) {
    const src = logoSrc(n.t);
    const r = n.r;
    const tip = `${n.name} (${n.t})\nTier ${n.s.tier} · score ${n.s.score} · ${KIND_LABEL[n.kind]}\n${fmtUSD(n.usd)} bought${n.s.insider.buyers.length ? ` · ${n.s.insider.buyers.length} insider${n.s.insider.buyers.length > 1 ? 's' : ''}` : ''}${n.s.congress.members.filter(m => !m.washOnly).length ? ` · ${n.s.congress.members.filter(m => !m.washOnly).length} in Congress` : ''}\nLast filing ${fmtAge(n.s.lastActivity, st.data.asOf)}${n.oversight ? `\n◆ ${overseerLine(n.s)}` : ''}${n.owned ? '\nIn your depot' : ''}${n.planned ? '\nIn your plan' : ''}\n${buyText(n.buy)}`;
    let inner = '';
    if (src && r >= 9) inner = `<image href="${src}" x="${-r * 0.62}" y="${-r * 0.62}" width="${r * 1.24}" height="${r * 1.24}" clip-path="url(#rd-clip)" preserveAspectRatio="xMidYMid meet"/>`;
    else if (r >= 10) inner = `<text class="rd-mono" y="${(r * 0.26).toFixed(1)}" text-anchor="middle" style="font-size:${(r * 0.72).toFixed(1)}px">${esc(monogram(n.name, n.t))}</text>`;
    return `<g class="rn${n.t === focus ? ' sel' : ''}${n.skipped ? ' skipped' : ''}${doubtful(n.buy) ? ' nobuy' : ''}" data-t="${esc(n.t)}" data-k="${n.kind}" style="transform:translate(${cx}px,${cy}px)">
      ${n.fresh ? `<circle class="rd-halo" r="${(r + 5).toFixed(1)}"/>` : ''}
      ${n.owned ? `<circle class="rd-own" r="${(r + 3.5).toFixed(1)}"/>` : ''}
      <circle class="rd-dot" r="${r.toFixed(1)}"/>${inner}
      ${n.oversight ? `<g class="rd-gavel" transform="translate(${(-r * 0.72).toFixed(1)},${(r * 0.72).toFixed(1)})"><path d="M0 -6 L6 0 L0 6 L-6 0 Z"/></g>` : ''}
      ${n.planned ? `<g class="rd-badge" transform="translate(${(r * 0.72).toFixed(1)},${(-r * 0.72).toFixed(1)})"><circle r="5.5"/><path d="M-2.5 0 L-0.6 2 L2.8 -2"/></g>` : ''}
      <circle class="rd-hit" r="${Math.max(r + 3, 12).toFixed(1)}" data-tip="${esc(tip)}"/></g>`;
  }

  function legend(st, L) {
    const kinds = new Set(L.nodes.map(n => n.kind));
    mount($('#rd-legend', el), html`
      ${['insider', 'congress', 'cross'].filter(k => kinds.has(k)).map(k => html`<span><i class="lg-dot" data-k="${k}"></i>${KIND_LABEL[k] === 'Both' ? 'Insiders and Congress' : KIND_LABEL[k]}</span>`)}
      ${L.nodes.some(n => n.oversight) ? html`<span><i class="lg-gavel"></i>A buyer’s committee oversees the company</span>` : ''}
      <span><i class="lg-size"></i>Bubble area = dollars bought</span>
      <span><i class="lg-ring"></i>Closer to the centre = stronger</span>
      ${L.nodes.some(n => n.fresh) ? html`<span><i class="lg-halo"></i>Filed in the last 3 days</span>` : ''}
      ${L.nodes.some(n => n.owned) ? html`<span><i class="lg-own"></i>In your depot</span>` : ''}
      ${L.nodes.some(n => n.planned) ? html`<span><i class="lg-plan"></i>In your plan</span>` : ''}
      ${L.nodes.some(n => doubtful(n.buy)) ? html`<span><i class="lg-nobuy"></i>Faded: probably not buyable at your brokers</span>` : ''}`);
  }

  /* ---------- Story card ---------- */
  function card(st) {
    const host = $('#rd-card', el);
    const s = st.signals.find(x => x.ticker === focus);
    if (!s) {
      mount(host, html`<div class="panel-h"><h2><span class="step">2</span> Understand</h2></div><div class="empty"><h3>${st.signals.length ? 'Nothing left to review' : 'Waiting for signals'}</h3><span>${st.signals.length ? 'Every strong signal has been added or skipped. Tick “Show skipped” to see them again, or widen the source filter.' : 'The radar fills in as soon as the first pull from Quiver finishes.'}</span></div>`);
      return;
    }
    const q = quoteFor(st, s);
    const items = candidates(st);
    const node = items.find(n => n.t === s.ticker);
    const qList = queue(st);
    const pos = qList.findIndex(n => n.t === s.ticker);
    const planned = st.workspace.watch.some(w => w.ticker === s.ticker);
    const owned = node?.owned;
    const skipped = isSkipped(st, s);
    const pros = s.flags.filter(f => f.tone === 'pos');
    const cons = s.flags.filter(f => f.tone !== 'pos');
    const members = s.congress.members.filter(m => !m.washOnly);
    const whoMax = Math.max(1, ...s.insider.buyers.map(b => b.usd), ...members.map(m => m.usd));
    const suggestion = suggest(st, s);
    const av = buyOf(st)(s.ticker, s.company);

    mount(host, html`
      <div class="panel-h"><h2><span class="step">2</span> Understand</h2><span class="grow"></span>
        <span class="rd-nav"><button class="btn ghost sm" type="button" id="rd-prev" aria-label="Previous company" data-tip="Previous · ←">‹</button><span class="mono xs muted">${pos >= 0 ? `${pos + 1} of ${qList.length}` : `rank ${s.rank}`}</span><button class="btn ghost sm" type="button" id="rd-next" aria-label="Next company" data-tip="Next · →">›</button></span></div>
      <div class="panel-b rd-card-b">
        <div class="rd-id">${brandHead(s.ticker, { name: nameOf(s.ticker, s.company), size: 48 })}</div>
        <div class="rd-verdict" data-tier="${s.tier}">
          ${tierChip(s.tier, true)}
          <div><b>${VERDICT[s.tier]}</b><span>score ${s.score} · rank ${s.rank} of ${fmtInt(st.signals.length)} · ${PRESETS[st.model.preset] ? `${PRESETS[st.model.preset].label} model` : 'custom weights'}</span></div>
          <div class="rd-tags">${s.congress.overseers ? html`<span class="rd-tag ovs" data-tip="${overseerLine(s)}">◆ Oversight</span>` : ''}${owned ? html`<span class="rd-tag own">In your depot</span>` : ''}${planned ? html`<span class="rd-tag plan">In your plan</span>` : ''}${skipped ? html`<span class="rd-tag">Skipped</span>` : ''}</div>
        </div>
        <p class="rd-story">${storyText(st, s, q)}</p>
        ${q && q.sinceInsider != null ? html`<div class="rd-block"><span class="label">What insiders paid vs. today</span>${paidGauge(s, q)}</div>` : ''}
        <div class="rd-block" id="rd-px"></div>
        ${s.insider.buyers.length || members.length ? html`<div class="rd-block"><span class="label">Who bought</span><ul class="rd-who">
          ${members.slice(0, 4).map(m => html`<li${m.oversees ? html` class="ovs"` : ''}><span class="who-k">${partyChip(m.party)}</span><span class="nm">${m.name}<em>${m.oversees ? html`<b class="ovs-t" data-tip="${m.oversees.seats.map(x => x.committee + (x.role ? ` (${ROLE_WORD[x.role] || x.role})` : '')).join('\n')}">◆ ${m.oversees.committee}${m.oversees.role ? ` · ${ROLE_WORD[m.oversees.role] || m.oversees.role}` : ''}</b>` : `${m.chamber} · ${m.ranges.join(', ')}`}</em><span class="bar"><i data-k="congress" style="width:${Math.max(3, (100 * m.usd) / whoMax)}%"></i></span></span><span class="mono xs" data-tip="${m.ranges.join(', ')}">${m.ranges.length === 1 ? shortRange(m.ranges[0]) : `≈${fmtUSD(m.usd)}`}${m.track ? html`<br>${trackChip(m.track)}` : ''}</span></li>`)}
          ${s.insider.buyers.slice(0, 4).map(b => html`<li><span class="who-k">${roleChip(b.role)}</span><span class="nm" title="${b.name}">${titleCase(b.name)}<em>${b.title || ROLE_LABEL[b.role]}${b.stakePct != null ? ` · stake +${Math.round(Math.min(b.stakePct, 999))}%` : b.newPosition ? ' · new position' : ''}</em><span class="bar"><i data-k="insider" style="width:${Math.max(3, (100 * b.usd) / whoMax)}%"></i></span></span><span class="mono xs">${fmtUSD(b.usd)}</span></li>`)}
        </ul>${s.insider.buyers.length > 4 ? html`<span class="xs muted">+${s.insider.buyers.length - 4} more insiders</span>` : ''}</div>` : ''}
        ${ctx.policy && ctx.policy.for(s.ticker) ? html`<div class="rd-block"><span class="label">Washington</span>${policyLines(ctx.policy.for(s.ticker))}</div>` : ''}
        <div class="rd-block"><span class="label">Where you can buy it</span>${buyBlock(av, { name: nameOf(s.ticker, s.company) })}</div>
        ${pros.length || cons.length ? html`<div class="rd-block"><span class="label">Checks</span><ul class="rd-checks">
          ${pros.map(f => html`<li data-tone="pos"><span class="ic" aria-hidden="true">✓</span><span><b>${f.label}.</b> ${f.detail}</span></li>`)}
          ${cons.map(f => html`<li data-tone="warn"><span class="ic" aria-hidden="true">!</span><span><b>${f.label}.</b> ${f.detail}</span></li>`)}
        </ul></div>` : ''}
      </div>
      <div class="rd-decide">
        <div class="panel-h"><h2><span class="step">3</span> Decide</h2><span class="grow"></span><span class="xs muted">${planned ? 'Already in your plan' : suggestion ? `adds about ${fmtMoney(suggestion.amount)} of ${fmtMoney(suggestion.capital)}` : ''}</span></div>
        ${doubtful(av) ? html`<p class="rd-buywarn" data-s="${av.status}">${av.status === 'no' ? 'Not buyable at your brokers' : 'Probably not buyable at your brokers'}: check your app before adding it, then mark it above.</p>` : ''}
        <div class="rd-actions">
          <button class="btn ${planned ? 'on' : 'primary'}" type="button" id="rd-add" data-tip="${planned ? 'Remove from your plan' : 'Add to your plan · A'}">${planned ? html`${ICON.check} In plan` : html`${ICON.plus} Add to plan`}</button>
          <button class="btn" type="button" id="rd-skip" data-tip="${skipped ? 'Bring it back' : 'Hide until it files something new · X'}">${skipped ? 'Unskip' : 'Skip'}</button>
          <button class="btn ghost" type="button" data-open="${s.ticker}" data-tip="Full dossier · Enter">${ICON.dossier} Deep dive</button>
        </div>
        <p class="xs dim">Research aid, not investment advice. Filings show what people did, not why.</p>
      </div>`);
    loadPrice(s);
  }

  function storyText(st, s, q) {
    const out = [];
    const b = s.insider.buyers;
    const asOf = st.data?.asOf;
    const m = s.congress.members.filter(x => !x.washOnly);
    const over = m.filter(x => x.oversees);
    if (over.length) {
      const o = over[0];
      out.push(`${o.name} (${o.party || '?'}), ${o.oversees.role ? `${ROLE_WORD[o.oversees.role] || o.oversees.role} on` : 'who sits on'} ${o.oversees.committee}, disclosed a purchase of ${o.ranges.join(', ')}. That committee oversees ${o.oversees.themeLabel}.`);
      if (m.length > 1) out.push(`${m.length - 1} more member${m.length > 2 ? 's' : ''} of Congress bought too${over.length > 1 ? `, ${over.length - 1} of them also with oversight` : ''}.`);
    } else if (m.length) out.push(m.length === 1 ? `${m[0].name} (${m[0].party || '?'}) disclosed a purchase of ${m[0].ranges.join(', ')}.` : `${m.length} members of Congress disclosed purchases worth about ${fmtUSD(s.congress.usd)}.`);
    else if (s.congress.conv90) out.push(`Members of Congress bought it ${s.congress.conv90} time${s.congress.conv90 > 1 ? 's' : ''} in the last 90 days.`);
    const tracked = m.filter(x => x.track && x.track.n >= 8).sort((a, b) => b.track.score - a.track.score)[0];
    if (tracked) out.push(`${tracked.name}'s past purchases: ${trackLine(tracked.track)}.`);
    const freshest = m.map(x => x.lastTraded).filter(Boolean).sort().pop();
    if (freshest && asOf) { const age = dayDiff(freshest, asOf); if (age > 30) out.push(`The congressional trade itself is ${age} days old, so it counts for less.`); }
    if (b.length) {
      const top = b[0];
      const who = `${titleCase(top.name)} (${(top.title || ROLE_LABEL[top.role]).replace(/\s+/g, ' ')})`;
      out.push(b.length === 1
        ? `${who} bought ${fmtUSD(top.usd)} on the open market${top.tx > 1 ? ` in ${top.tx} purchases` : ''}, last on ${fmtDate(top.lastDate, { year: false })}.`
        : `${b.length} insiders bought ${fmtUSD(s.insider.usd)} on the open market, led by ${who} with ${fmtUSD(top.usd)}.`);
    }
    if (q && q.sinceInsider != null) out.push(q.sinceInsider >= 0 ? `The stock is now ${fmtSignedPct(q.sinceInsider)} above what insiders paid.` : `The stock is now ${Math.abs(q.sinceInsider).toFixed(1)}% below what insiders paid.`);
    if (asOf && s.lastActivity) { const d = dayDiff(s.lastActivity, asOf); out.push(d <= 0 ? 'The latest filing is from today.' : `The latest filing is ${d} day${d > 1 ? 's' : ''} old.`); }
    return out.join(' ');
  }

  /** Two markers on one line: what insiders paid and the last price, on the 52-week range when known. */
  function paidGauge(s, q) {
    const avg = s.insider.avgPrice, last = q.last;
    const doc = priceCache.get(s.ticker);
    let lo = Math.min(avg, last), hi = Math.max(avg, last);
    if (doc && doc.lo52 && doc.hi52) { lo = Math.min(lo, doc.lo52); hi = Math.max(hi, doc.hi52); }
    const pad = (hi - lo) * 0.18 || hi * 0.06;
    lo -= pad; hi += pad;
    const X = v => 8 + 284 * ((v - lo) / (hi - lo));
    const up = last >= avg;
    const fmt = v => `$${v < 10 ? v.toFixed(2) : v.toFixed(v < 100 ? 2 : 0)}`;
    const xa = X(avg), xl = X(last);
    const anchorAt = x => (x < 90 ? 'start' : x > 210 ? 'end' : 'middle');
    return raw(`<svg class="rd-gauge" viewBox="0 0 300 58" role="img" aria-label="Insiders paid ${fmt(avg)}, last price ${fmt(last)}">
      ${doc && doc.lo52 ? `<rect class="g-range" x="${X(doc.lo52).toFixed(1)}" y="25" width="${(X(doc.hi52) - X(doc.lo52)).toFixed(1)}" height="6" rx="3"><title>52-week range ${fmt(doc.lo52)} to ${fmt(doc.hi52)}</title></rect>` : `<line class="g-axis" x1="8" x2="292" y1="28" y2="28"/>`}
      <line class="g-span ${up ? 'up' : 'down'}" x1="${Math.min(xa, xl).toFixed(1)}" x2="${Math.max(xa, xl).toFixed(1)}" y1="28" y2="28"/>
      <circle class="g-ins" cx="${xa.toFixed(1)}" cy="28" r="6"/>
      <circle class="g-now ${up ? 'up' : 'down'}" cx="${xl.toFixed(1)}" cy="28" r="6"/>
      <text class="g-lab" x="${xa.toFixed(1)}" y="50" text-anchor="${anchorAt(xa)}">Insiders paid ${fmt(avg)}</text>
      <text class="g-lab b" x="${xl.toFixed(1)}" y="13" text-anchor="${anchorAt(xl)}">Now ${fmt(last)} · ${fmtSignedPct(q.sinceInsider)}</text>
    </svg>`);
  }

  const priceCache = new Map();
  function loadPrice(s) {
    const host = $('#rd-px', el);
    if (!host) return;
    const draw = doc => {
      if (!doc || !doc.c || doc.c.length < 5 || focus !== s.ticker) { mount(host, ''); host.hidden = true; return; }
      host.hidden = false;
      mount(host, html`<span class="label">One year · Yahoo Finance</span>${spark(doc, s.insider.avgPrice)}`);
    };
    if (priceCache.has(s.ticker)) { draw(priceCache.get(s.ticker)); return; }
    host.hidden = true;
    if (!ctx.cloud || !ctx.cloud.ready) return;
    ctx.cloud.prices(s.ticker).then(doc => { priceCache.set(s.ticker, doc); if (focus === s.ticker) card(store.get()); });
  }

  function spark(doc, avg) {
    const W = 300, H = 64, n = doc.c.length;
    let lo = Math.min(...doc.c), hi = Math.max(...doc.c);
    const ok = avg && avg / doc.c[n - 1] < 5 && avg / doc.c[n - 1] > 0.2;
    if (ok) { lo = Math.min(lo, avg); hi = Math.max(hi, avg); }
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    const X = i => (W * i) / (n - 1), Y = v => H - 4 - (H - 8) * ((v - lo) / (hi - lo));
    const pts = doc.c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L');
    const up = doc.c[n - 1] >= doc.c[0];
    const ret = (doc.c[n - 1] / doc.c[0] - 1) * 100;
    return raw(`<svg class="rd-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Price over one year, ${fmtSignedPct(ret)}">
      <path class="area" d="M${pts}L${W},${H}L0,${H}Z"/><path class="line" d="M${pts}"/>
      ${ok ? `<line class="ins" x1="0" x2="${W}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}"/>` : ''}
      <circle class="end" cx="${X(n - 1)}" cy="${Y(doc.c[n - 1]).toFixed(1)}" r="3"/>
      <text class="g-ax" x="0" y="${H + 12}">${esc(fmtDate(doc.t[0], { year: false }))}</text><text class="g-ax" x="${W}" y="${H + 12}" text-anchor="end">${esc(fmtSignedPct(ret))} in a year${ok ? ' · line = insiders’ price' : ''}</text></svg>`);
  }

  /* ---------- Plan tray ---------- */
  function planItems(st) {
    const live = new Map(st.signals.map(s => [s.ticker, s]));
    return st.workspace.watch.map(w => { const s = live.get(w.ticker); return { ...w, score: s ? s.score : w.scoreAtAdd, tier: s ? s.tier : w.tierAtAdd }; })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  function suggest(st, s) {
    if (st.workspace.watch.some(w => w.ticker === s.ticker)) return null;
    const p = st.workspace.portfolio;
    const list = [...planItems(st), { ticker: s.ticker, score: s.score, tier: s.tier }];
    const a = allocate(list, p);
    return { amount: a.amounts[list.length - 1], capital: p.capital };
  }
  function plan(st) {
    const host = $('#rd-plan', el);
    const p = st.workspace.portfolio;
    const list = planItems(st);
    $('#rd-plan-cap', el).textContent = fmtMoney(p.capital);
    $('#rd-plan-src', el).textContent = `${p.reserve}% reserve · max ${p.cap}% each`;
    if (!list.length) {
      mount(host, html`<div class="rd-plan-bar"><span class="seg cash" style="flex:1"><span class="t">Nothing allocated yet. Press <b>Add to plan</b> on a company; the money is split by conviction within your reserve and cap.</span></span></div>`);
      return;
    }
    const a = allocate(list, p);
    const buy = buyOf(st);
    const segs = list.map((it, i) => ({ it, amt: a.amounts[i], av: buy(it.ticker, it.company) })).filter(x => x.amt > 0);
    const cash = p.capital - a.invested;
    mount(host, html`<div class="rd-plan-bar" role="img" aria-label="${`Plan: ${segs.map(x => `${nameOf(x.it.ticker, x.it.company)} ${fmtMoney(x.amt)}`).join(', ')}, cash ${fmtMoney(cash)}`}">
        ${segs.map(x => { const pct = (100 * x.amt) / p.capital; return html`<button type="button" class="seg${x.it.ticker === focus ? ' on' : ''}${doubtful(x.av) ? ' nobuy' : ''}" data-focus="${x.it.ticker}" style="flex:${x.amt}" data-tip="${`${nameOf(x.it.ticker, x.it.company)} · ${fmtMoney(x.amt)} (${pct.toFixed(1)}%)${x.it.tier ? ` · tier ${x.it.tier}` : ''}
${buyText(x.av)}`}">${pct >= 7 ? html`${logo(x.it.ticker, nameOf(x.it.ticker, x.it.company), 18)}<span class="t">${short(nameOf(x.it.ticker, x.it.company), 16)}</span><span class="v">${fmtMoney(x.amt)}</span>` : pct >= 3.5 ? logo(x.it.ticker, nameOf(x.it.ticker, x.it.company), 16) : ''}</button>`; })}
        <span class="seg cash" style="flex:${Math.max(cash, 0.0001)}" data-tip="${`Cash ${fmtMoney(cash)}${a.idle > 1 ? ` · ${fmtMoney(a.idle)} idle because of the per-position cap` : ''}`}">${(100 * cash) / p.capital >= 7 ? html`<span class="t">Cash</span><span class="v">${fmtMoney(cash)}</span>` : ''}</span>
      </div>
      <div class="rd-plan-foot"><span><b>${segs.length}</b> position${segs.length === 1 ? '' : 's'} · <b>${fmtMoney(a.invested)}</b> invested · <b>${fmtMoney(cash)}</b> cash</span>${a.idle > 1 ? html`<span class="muted">Add ${Math.max(1, a.minPositionsForFullInvestment - segs.length)} more to put the idle ${fmtMoney(a.idle)} to work under the ${p.cap}% cap.</span>` : ''}</div>`);
  }

  /* ---------- Render and events ---------- */
  function today(st) {
    const b = st.cloud?.briefs?.[0];
    const host = $('#rd-today', el);
    if (b && b.headline) mount(host, html`<span class="rd-brief"><span class="label">Today</span> ${b.headline} <button class="linkish" type="button" data-nav="briefing">Read the brief</button></span>`);
  }
  function toolbar() {
    for (const b of el.querySelectorAll('#rd-src button')) b.setAttribute('aria-pressed', String(b.dataset.src === source));
    $('#rd-skipped', el).checked = showSkipped;
  }
  function render(st) {
    toolbar();
    today(st);
    drawRadar(st);
    card(st);
    plan(st);
  }
  function setFocus(t) {
    if (!t || t === focus) return;
    focus = t;
    const svg = $('#rd-svg', el);
    svg.querySelectorAll('.rn.sel').forEach(n => n.classList.remove('sel'));
    const st = store.get();
    drawRadar(st);
    card(st);
    plan(st);
  }
  function step(dir) {
    const st = store.get();
    const list = queue(st).length ? queue(st) : candidates(st);
    if (!list.length) return;
    const i = list.findIndex(n => n.t === focus);
    setFocus(list[(i + dir + list.length) % list.length].t);
  }
  /** After a decision, move on to the strongest undecided company. */
  function advance(after) {
    const st = store.get();
    const q = queue(st).filter(n => n.t !== after);
    focus = q.length ? q[0].t : after;
    render(st);
  }
  function decideAdd() {
    const t = focus;
    if (!t) return;
    const was = store.get().workspace.watch.some(w => w.ticker === t);
    ctx.toggleWatch(t);
    if (!was) advance(t); else render(store.get());
  }
  function decideSkip() {
    const st = store.get();
    const t = focus;
    if (!t) return;
    const map = { ...skippedMap(st) };
    const s = st.signals.find(x => x.ticker === t);
    if (s && isSkipped(st, s)) { delete map[t]; ctx.workspace.update({ skipped: map }); render(store.get()); return; }
    map[t] = st.data?.asOf || new Date().toISOString().slice(0, 10);
    ctx.workspace.update({ skipped: map });
    advance(t);
  }

  on(el, 'click', '.rn', (_, g) => setFocus(g.dataset.t));
  on(el, 'click', '[data-focus]', (_, b) => setFocus(b.dataset.focus));
  on(el, 'click', '[data-src]', (_, b) => { source = b.dataset.src; layout.key = null; render(store.get()); });
  on(el, 'change', '#rd-skipped', (_, c) => { showSkipped = c.checked; layout.key = null; render(store.get()); });
  on(el, 'click', '#rd-prev', () => step(-1));
  on(el, 'click', '#rd-next', () => step(1));
  on(el, 'click', '#rd-add', decideAdd);
  on(el, 'click', '#rd-skip', decideSkip);

  let lastSig = null;
  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      if (!changed) { render(st); return; }
      if (changed.some(k => ['signals', 'model', 'windowDays', 'caps'].includes(k)) && st.signals !== lastSig) { lastSig = st.signals; layout.key = null; render(st); return; }
      if (changed.some(k => ['workspace', 'cloud', 'portfolioLocalAt', 'enrichment', 'policy'].includes(k))) render(st);
    },
    key(ev) {
      if (ev.key === 'ArrowRight' || ev.key === 'j') { step(1); return true; }
      if (ev.key === 'ArrowLeft' || ev.key === 'k') { step(-1); return true; }
      if (ev.key === 'a') { decideAdd(); return true; }
      if (ev.key === 'x') { decideSkip(); return true; }
      if (ev.key === 'Enter' && focus) { ctx.openDossier(focus); return true; }
      return false;
    },
    onResize() { if (!el.hidden) { layout.key = null; render(store.get()); } }
  };
}

/** "$1,001 - $15,000" → "$1K–15K". */
function shortRange(r) {
  const nums = String(r).match(/\$[\d,]+/g);
  if (!nums) return String(r);
  const f = x => { const v = +x.replace(/[$,]/g, ''); return v >= 1e6 ? `${Math.round(v / 1e6)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v); };
  return nums.length > 1 ? `$${f(nums[0])}–${f(nums[1])}` : `$${f(nums[0])}+`;
}

function overseerLine(s) {
  const o = s.congress.members.find(m => m.oversees && !m.washOnly);
  return o ? `${o.name} sits on ${o.oversees.committee}, which oversees ${o.oversees.themeLabel}` : '';
}

function arcPath(cx, cy, R, a0, a1) {
  const x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R;
  const x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
  return `M${cx},${cy}L${x0.toFixed(1)},${y0.toFixed(1)}A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}Z`;
}
const SECTOR_SHORT = { 'Consumer Discretionary': 'Consumer', 'Consumer Staples': 'Staples', 'Health Care': 'Health care', 'Basic Materials': 'Materials', 'Telecommunications': 'Telecom', 'Real Estate': 'Real estate', 'Miscellaneous': 'Misc.' };
const shortSector = s => SECTOR_SHORT[s] || s;
const TINY_SECTOR = { Technology: 'Tech', 'Health Care': 'Health', 'Consumer Discretionary': 'Consumer', 'Consumer Staples': 'Staples', Industrials: 'Industry', 'Real Estate': 'Property', 'Basic Materials': 'Materials', Telecommunications: 'Telecom', Miscellaneous: 'Misc', Utilities: 'Utilities' };
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
