import { html, mount, on, $ } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip, roleChip, partyChip } from '../ui/parts.js';
import { buildGraph } from '../model/graph.js';
import { applyFilters } from './signals.js';
import { fmtUSD, fmtInt, dayRange, cleanCompany } from '../core/util.js';
import { brandHead, nameOf, logo } from '../ui/brand.js';

const tickerName = t => { const n = nameOf(t); return n.length > 18 ? n.slice(0, 17).trimEnd() + '…' : n; };

const TYPE_LABEL = { ticker: 'Ticker', member: 'Member of Congress', insider: 'Insider', fund: 'Fund / large holder' };

/**
 * Link analysis. Force-directed layout via d3-force (cdnjs); rendering,
 * selection and highlighting are ours. Bridges (people linked to more than
 * one ticker) are listed beside the canvas because they are the point.
 */
export function createGraphView(ctx) {
  const { store } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-graph';
  const opt = { top: 40, members: true, insiders: true, funds: true };
  let sim = null;
  let graph = { nodes: [], links: [] };
  let selected = null;
  let builtFor = null;

  mount(el, html`
    <div class="view-h">
      <div><h1>Link analysis</h1><p>Tickers in the current signal set and the people who bought them. Thicker lines carry more money. People tied to several tickers are bridges worth a closer look.</p></div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Number of tickers" id="g-top">${[20, 40, 60].map(n => html`<button type="button" data-n="${n}">Top ${n}</button>`)}</div>
        <label class="check"><input type="checkbox" id="g-members" checked> Congress</label>
        <label class="check"><input type="checkbox" id="g-insiders" checked> Insiders</label>
        <label class="check"><input type="checkbox" id="g-funds" checked> Funds</label>
        <button class="btn" type="button" id="g-reheat">${ICON.refresh} Re-run layout</button>
      </div>
    </div>
    <div class="graph-grid">
      <section class="panel">
        <div class="panel-h"><h2>Network</h2><span class="src" id="g-count"></span></div>
        <div class="graph-stage" id="g-stage">
          <svg id="g-svg" role="img" aria-label="Network of tickers and buyers"></svg>
          <div class="graph-legend">
            <span><i style="background:var(--bg-3);border:1.5px solid var(--ent-ticker);border-radius:2px"></i>Ticker</span>
            <span><i style="background:var(--ent-member);transform:rotate(45deg) scale(.8)"></i>Congress</span>
            <span><i style="background:var(--ent-insider);border-radius:50%"></i>Insider</span>
            <span><i style="background:var(--ent-fund);clip-path:polygon(50% 0,100% 100%,0 100%)"></i>Fund / holder</span>
          </div>
          <div class="graph-hint">Scroll to zoom · drag to pan · click a node</div>
        </div>
      </section>
      <aside style="display:flex;flex-direction:column;gap:var(--gap)">
        <section class="panel" id="g-ins"></section>
        <section class="panel"><div class="panel-h"><h2>Bridges</h2><span class="src">linked to 2+ tickers</span></div><div class="panel-b" id="g-bridges"></div></section>
      </aside>
    </div>`);

  on(el, 'click', '#g-top button', (_, b) => { opt.top = +b.dataset.n; build(true); });
  on(el, 'change', '#g-members', (_, i) => { opt.members = i.checked; build(true); });
  on(el, 'change', '#g-insiders', (_, i) => { opt.insiders = i.checked; build(true); });
  on(el, 'change', '#g-funds', (_, i) => { opt.funds = i.checked; build(true); });
  on(el, 'click', '#g-reheat', () => build(true));
  on(el, 'click', '[data-node]', (_, b) => select(b.dataset.node));

  const radius = n => n.type === 'ticker' ? 9 + (n.score || 0) / 9 : 5 + Math.min(7, Math.log10(Math.max(n.weight, 1e3) / 1e3) * 2.2);

  function shape(n) {
    const r = radius(n);
    if (n.type === 'ticker') return `<rect class="shape" x="${-r}" y="${-r * 0.72}" width="${2 * r}" height="${1.44 * r}" rx="3"/>`;
    if (n.type === 'member') return `<path class="shape" d="M0,${-r}L${r},0L0,${r}L${-r},0Z"/>`;
    if (n.type === 'fund') return `<path class="shape" d="M0,${-r}L${r * 0.95},${r * 0.75}L${-r * 0.95},${r * 0.75}Z"/>`;
    return `<circle class="shape" r="${r}"/>`;
  }
  const shortName = s => { const t = String(s); return t.length > 18 ? t.slice(0, 17) + '…' : t; };

  function build(force) {
    const st = store.get();
    for (const b of el.querySelectorAll('#g-top button')) b.setAttribute('aria-pressed', String(+b.dataset.n === opt.top));
    const key = `${st.signals.length}|${st.signals[0]?.ticker}|${JSON.stringify(st.filters)}|${opt.top}|${opt.members}|${opt.insiders}|${opt.funds}|${st.model.preset}`;
    if (!force && key === builtFor) return;
    builtFor = key;
    const days = st.data ? dayRange(st.data.from, st.data.asOf) : null;
    const sigs = applyFilters(st.signals, st.filters, days);
    graph = buildGraph(sigs, { maxTickers: opt.top, includeMembers: opt.members, includeInsiders: opt.insiders, includeFunds: opt.funds });
    $('#g-count', el).textContent = `${fmtInt(graph.nodes.length)} nodes · ${fmtInt(graph.links.length)} links`;
    draw();
    renderBridges();
    renderInspector();
  }

  function draw() {
    const svgEl = $('#g-svg', el);
    const d3 = window.d3;
    if (!d3) {
      mount($('#g-stage', el), html`<div class="empty"><h3>Graph library did not load</h3><span>The network view needs d3 from cdnjs.cloudflare.com. Check your connection and reload.</span></div>`);
      return;
    }
    if (sim) sim.stop();
    const box = svgEl.getBoundingClientRect();
    const W = Math.max(320, box.width || 800), H = Math.max(320, box.height || 600);
    if (!graph.nodes.length) {
      svgEl.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="ax">${store.get().signals.length ? 'No links for the current filters.' : 'Waiting for signals…'}</text>`;
      return;
    }
    const nodes = graph.nodes.map(n => ({ ...n }));
    const links = graph.links.map(l => ({ ...l }));
    const width = l => 0.8 + Math.min(4, Math.log10(Math.max(l.usd, 1e3) / 1e3) * 1.1);

    svgEl.innerHTML = '';
    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${W} ${H}`);
    const layer = svg.append('g');
    const linkSel = layer.append('g').selectAll('line').data(links).join('line')
      .attr('class', 'g-link').attr('data-k', d => d.kind).attr('stroke-width', width);
    const nodeSel = layer.append('g').selectAll('g').data(nodes, d => d.id).join('g')
      .attr('class', 'g-node').attr('data-type', d => d.type).attr('data-tier', d => d.tier || null).attr('data-id', d => d.id)
      .attr('data-tip', d => d.type === 'ticker'
        ? `${nameOf(d.ticker)} (${d.ticker}) · tier ${d.tier} · score ${d.score}`
        : `${d.label}\n${TYPE_LABEL[d.type]}${d.party ? ` (${d.party})` : ''} · ${d.degree} ticker${d.degree > 1 ? 's' : ''} · ${fmtUSD(d.weight)}`)
      .html(d => shape(d) + (d.type === 'ticker' || d.degree > 1 ? `<text x="${radius(d) + 4}" y="4">${(d.type === 'ticker' ? tickerName(d.ticker) : shortName(d.label)).replace(/[<&>]/g, '')}</text>` : ''))
      .on('click', (ev, d) => { ev.stopPropagation(); select(d.id); });

    nodeSel.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', ev => layer.attr('transform', ev.transform));
    svg.call(zoom);
    const fit = instant => {
      const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
      const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 90, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30;
      const k = Math.min(1.6, 0.94 * Math.min(W / (x1 - x0), H / (y1 - y0)));
      const t = d3.zoomIdentity.translate(W / 2 - (k * (x0 + x1)) / 2, H / 2 - (k * (y0 + y1)) / 2).scale(k);
      if (instant) svg.call(zoom.transform, t); else svg.transition().duration(450).call(zoom.transform, t);
    };
    svg.on('click', () => select(null));

    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(l => (l.kind === 'congress' ? 70 : 55)).strength(0.5))
      .force('charge', d3.forceManyBody().strength(d => (d.type === 'ticker' ? -260 : -120)))
      .force('collide', d3.forceCollide(d => radius(d) + 6))
      .force('x', d3.forceX(W / 2).strength(0.05))
      .force('y', d3.forceY(H / 2).strength(0.07));
    const tick = () => {
      linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    };
    // Settle most of the layout up front so the first frame is readable and fitted.
    sim.stop();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < (reduced ? 300 : 160); i++) sim.tick();
    tick();
    fit(true);
    if (!reduced) sim.on('tick', tick).on('end', () => fit(false)).restart();
    graph.sim = { nodes, links };
    applySelection();
  }

  function neighbors(id) {
    const s = new Set([id]);
    for (const l of graph.links) {
      if (l.source === id || l.source.id === id) s.add(typeof l.target === 'object' ? l.target.id : l.target);
      if (l.target === id || l.target.id === id) s.add(typeof l.source === 'object' ? l.source.id : l.source);
    }
    return s;
  }
  function applySelection() {
    const near = selected ? neighbors(selected) : null;
    for (const g of el.querySelectorAll('.g-node')) {
      g.classList.toggle('dim', !!near && !near.has(g.dataset.id));
      g.classList.toggle('sel', g.dataset.id === selected);
    }
    for (const ln of el.querySelectorAll('.g-link')) {
      const d = ln.__data__;
      const on = selected && d && (d.source.id === selected || d.target.id === selected);
      ln.classList.toggle('hl', !!on);
    }
  }
  function select(id) {
    selected = id;
    applySelection();
    renderInspector();
  }

  function renderInspector() {
    const host = $('#g-ins', el);
    const n = graph.nodes.find(x => x.id === selected);
    if (!n) {
      mount(host, html`<div class="panel-h"><h2>Selection</h2></div><div class="empty"><h3>Click a node</h3><span>Select a ticker or a person to see their links. Click empty space to clear.</span></div>`);
      return;
    }
    const linked = graph.links.filter(l => (l.source.id || l.source) === n.id || (l.target.id || l.target) === n.id);
    if (n.type === 'ticker') {
      const s = store.get().signals.find(x => x.ticker === n.ticker);
      mount(host, html`<div class="panel-h"><h2>Ticker</h2></div><div class="panel-b">
        <div class="ins-h">${brandHead(n.ticker, { name: nameOf(n.ticker, s?.company), size: 36 })}${tierChip(n.tier, true)}</div>
        <ul class="rows">${linked.map(l => { const other = graph.nodes.find(x => x.id === (l.source.id || l.source)); return html`<li>${other.type === 'member' ? partyChip(other.party) : roleChip(other.role)}<button class="linkish grow t1" type="button" data-node="${other.id}">${other.label}</button><span class="mono">${fmtUSD(l.usd)}</span></li>`; })}</ul>
        <div class="ins-actions"><button class="btn primary sm" type="button" data-open="${n.ticker}">${ICON.open} Open dossier</button></div></div>`);
      return;
    }
    mount(host, html`<div class="panel-h"><h2>${TYPE_LABEL[n.type]}</h2></div><div class="panel-b">
      <div><div style="font-weight:600;font-size:15px">${n.label}</div><div class="small muted">${n.type === 'member' ? `${{ D: 'Democrat', R: 'Republican', I: 'Independent' }[n.party] || ''} · ${n.chamber}` : ''}${n.role ? roleChip(n.role) : ''}</div></div>
      <dl class="kv"><dt>Tickers in view</dt><dd>${n.degree}</dd><dt>Dollars in view</dt><dd>${fmtUSD(n.weight)}</dd></dl>
      <ul class="rows">${linked.map(l => { const t = graph.nodes.find(x => x.id === (l.target.id || l.target)); return html`<li>${tierChip(t.tier)}${logo(t.ticker, nameOf(t.ticker), 18)}<button class="linkish grow t1" type="button" data-node="${t.id}">${nameOf(t.ticker)}</button><span class="mono">${fmtUSD(l.usd)}</span></li>`; })}</ul>
      ${n.type === 'member' ? html`<div class="ins-actions"><button class="btn sm" type="button" data-member="${n.label}">${ICON.member} Member profile</button></div>` : ''}</div>`);
  }

  function renderBridges() {
    const host = $('#g-bridges', el);
    const bridges = graph.nodes.filter(n => n.type !== 'ticker' && n.degree >= 2).sort((a, b) => b.degree - a.degree || b.weight - a.weight).slice(0, 12);
    mount(host, bridges.length
      ? html`<ul class="rows">${bridges.map(b => html`<li>${b.type === 'member' ? partyChip(b.party) : roleChip(b.role)}<button class="linkish grow t1" type="button" data-node="${b.id}">${b.label}</button><span class="mono xs">${b.degree} tickers</span></li>`)}</ul>`
      : html`<p class="small muted">Nobody in this set bought more than one ticker.</p>`);
  }

  return {
    el,
    render(st, changed) {
      if (!el.isConnected || el.hidden) return;
      if (!changed || changed.some(k => ['signals', 'filters', 'model'].includes(k))) build(false);
    },
    show() { builtFor = null; requestAnimationFrame(() => build(true)); },
    hide() { if (sim) sim.stop(); },
    focus(ticker) { selected = `t:${ticker}`; requestAnimationFrame(() => { applySelection(); renderInspector(); }); },
    onResize() { if (!el.hidden) build(true); }
  };
}
