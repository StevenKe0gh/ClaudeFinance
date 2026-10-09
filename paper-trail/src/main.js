import { APP, WINDOWS } from './core/config.js';
import { createStore } from './core/store.js';
import { fmtInt, fmtClock, debounce, isoDate } from './core/util.js';
import { createConnector } from './data/connector.js';
import { createQuiver } from './data/quiver.js';
import { createPipeline } from './app/pipeline.js';
import { createWorkspace } from './app/persist.js';
import { DEFAULT_MODEL, PRESETS, FACTORS } from './model/score.js';
import { html, mount, on, $, markdown } from './ui/html.js';
import { ICON } from './ui/icons.js';
import { installTooltips, toast, openPalette, openDrawer, openModal, closeTop, overlayOpen } from './ui/overlay.js';
import { createSignalsView, DEFAULT_FILTERS } from './views/signals.js';
import { createGraphView } from './views/graph.js';
import { createDossierView } from './views/dossier.js';
import { createMemberView } from './views/member.js';
import { createModelView } from './views/model.js';
import { createPortfolioView } from './views/portfolio.js';
import { createLineageView } from './views/lineage.js';
import { deskBriefPrompt, sampleErrorCopy, streamInto } from './ai/claude.js';

const NAV = [
  { key: 'signals', label: 'Signals', icon: ICON.signals, go: 's' },
  { key: 'graph', label: 'Link analysis', icon: ICON.graph, go: 'g' },
  { key: 'dossier', label: 'Dossier', icon: ICON.dossier, go: 'd' },
  { key: 'member', label: 'Member', icon: ICON.member, go: 'c' },
  { key: 'model', label: 'Model', icon: ICON.model, go: 'm' },
  { key: 'portfolio', label: 'Portfolio', icon: ICON.portfolio, go: 'p' },
  { key: 'lineage', label: 'Lineage', icon: ICON.lineage, go: 'l', bottom: true }
];

function validModel(m) {
  return m && m.weights && FACTORS.every(f => Number.isFinite(m.weights[f.key])) && m.tiers && Number.isFinite(m.halfLife);
}

/* ---------- State ---------- */
const store = createStore({
  view: 'signals',
  caps: { mcp: 'pending', sample: 'pending', db: 'pending', downloads: 'pending' },
  windowDays: 30,
  model: { ...DEFAULT_MODEL, weights: { ...DEFAULT_MODEL.weights }, tiers: { ...DEFAULT_MODEL.tiers } },
  pipeline: { status: 'idle', stages: [], startedAt: null, finishedAt: null, error: null },
  data: null,
  enrichment: new Map(),
  signals: [],
  selected: null,
  filters: { ...DEFAULT_FILTERS, tiers: { ...DEFAULT_FILTERS.tiers } },
  sort: { key: 'score', dir: 'desc' },
  workspace: null,
  session: { lastSeenPrev: null }
});

let mcp = null;
const conn = createConnector({ getMcp: () => mcp });
const quiver = createQuiver(conn);
const pipeline = createPipeline({ store, quiver });
const workspace = createWorkspace({
  store,
  onRemote: ws => { if (validModel(ws.model)) { store.set({ model: ws.model }); pipeline.recompute(); } }
});
{
  const ws = store.get().workspace;
  if (validModel(ws.model)) store.set({ model: ws.model });
  store.set({ session: { lastSeenPrev: ws.lastSeen || null } });
}

/* ---------- Context shared with views ---------- */
let firstRunDone = false;
const ctx = {
  store, conn, quiver, pipeline, workspace,
  caps: { sample: null, downloads: null },
  async runPipeline(opts = {}) {
    if (!mcp) { toast('Live data needs the claude.ai viewer with the Quiver Quant connector.', 'error'); return; }
    await pipeline.run(opts);
    const p = store.get().pipeline;
    if (p.status === 'done') {
      if (!firstRunDone) { firstRunDone = true; workspace.update({ lastSeen: new Date().toISOString() }); }
      if (opts.refresh) toast(`Refreshed · ${fmtInt(store.get().signals.length)} tickers scored`, 'ok');
    }
  },
  openDossier(ticker) { nav('dossier', { ticker }); },
  openMember(name, bioguide) { nav('member', { name, bioguide }); },
  showGraph(ticker) { nav('graph'); if (ticker) views.graph.focus(ticker); },
  toggleWatch(ticker) {
    const st = store.get();
    const has = st.workspace.watch.some(w => w.ticker === ticker);
    if (has) {
      workspace.update({ watch: st.workspace.watch.filter(w => w.ticker !== ticker) });
      toast(`Removed ${ticker} from the portfolio`);
    } else {
      const s = st.signals.find(x => x.ticker === ticker);
      workspace.update({ watch: [...st.workspace.watch, { ticker, company: s?.company || '', scoreAtAdd: s?.score ?? null, tierAtAdd: s?.tier ?? null, addedAt: isoDate(), note: '' }] });
      toast(`Added ${ticker} to the portfolio`, 'ok');
    }
  },
  applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    ctx.setModel({ ...store.get().model, preset: key, weights: { ...p.weights } });
  },
  setModel(model) {
    store.set({ model });
    pipeline.recompute();
    saveModel(model);
  },
  openBrief
};
const saveModel = debounce(model => workspace.update({ model }), 600);

/* ---------- Views and navigation ---------- */
const main = $('#main');
const views = {
  signals: createSignalsView(ctx),
  graph: createGraphView(ctx),
  dossier: createDossierView(ctx),
  member: createMemberView(ctx),
  model: createModelView(ctx),
  portfolio: createPortfolioView(ctx),
  lineage: createLineageView(ctx)
};
for (const v of Object.values(views)) { v.el.hidden = true; main.appendChild(v.el); }

mount($('#rail'), html`${NAV.filter(n => !n.bottom).map(railButton)}<span class="spacer"></span>${NAV.filter(n => n.bottom).map(railButton)}`);
function railButton(n) {
  return html`<button type="button" data-nav="${n.key}" data-tip="${`${n.label}  ·  G then ${n.go.toUpperCase()}`}" aria-label="${n.label}">${n.icon}<span class="rail-label">${n.label}</span></button>`;
}

function nav(view, params = {}) {
  const prev = store.get().view;
  if (prev !== view && views[prev]?.hide) views[prev].hide();
  for (const [k, v] of Object.entries(views)) v.el.hidden = k !== view;
  store.set({ view });
  for (const b of document.querySelectorAll('[data-nav]')) {
    if (b.dataset.nav === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const v = views[view];
  if (view === 'dossier') v.open(params.ticker || v.current());
  if (view === 'member') v.open(params);
  v.render(store.get(), null);
  if (v.show) v.show();
  crumbs();
  main.scrollTop = 0;
  const hash = view === 'dossier' && (params.ticker || v.current()) ? `dossier-${params.ticker || v.current()}` : view;
  try { if (location.hash.slice(1) !== hash) history.replaceState(null, '', '#' + hash); } catch { /* sandboxed history */ }
}

function crumbs() {
  const st = store.get();
  const label = NAV.find(n => n.key === st.view)?.label || '';
  const sub = st.view === 'dossier' ? views.dossier.current() : st.view === 'member' ? views.member.current() : null;
  mount($('#crumbs'), html`<span>Workspace</span><span>›</span>${sub ? html`<span>${label}</span><span>›</span><b>${sub}</b>` : html`<b>${label}</b>`}`);
}

/* ---------- Store → UI ---------- */
store.subscribe((st, changed) => {
  views[st.view].render(st, changed);
  if (changed.some(k => ['pipeline', 'data', 'caps', 'model', 'signals', 'workspace'].includes(k))) chrome(st);
});

function chrome(st) {
  const feed = $('#feed');
  const p = st.pipeline;
  const s = st.caps.mcp === 'off' ? 'error' : p.status === 'running' ? 'running' : p.status === 'error' ? 'error' : p.status === 'done' ? 'live' : 'wait';
  feed.dataset.s = s;
  $('#feed-t').textContent = st.caps.mcp === 'off' ? 'Offline' : p.status === 'running' ? 'Syncing' : p.status === 'error' ? 'Sync failed' : p.status === 'done' ? `Live · ${fmtClock(p.finishedAt)}` : 'Connecting';
  mount($('#sb-conn'), html`Quiver: <b>${st.caps.mcp === 'on' ? 'connected' : st.caps.mcp}</b>`);
  mount($('#sb-model'), html`Model: <b>${APP.model}/${st.model.preset}</b> · window <b>${st.windowDays}d</b>`);
  mount($('#sb-rows'), st.data ? html`Rows: <b>${fmtInt(st.data.insiderBuys.length + st.data.congressRows.length)}</b> · tickers <b>${fmtInt(st.signals.length)}</b> · requests <b>${fmtInt(conn.log.length)}</b>` : '');
  const enr = p.stages.find(x => x.key === 'enrich');
  mount($('#sb-sync'), p.status === 'running' ? html`Pipeline: <b>running</b>` : enr && enr.status === 'running' ? html`Selling check <b>${enr.detail || ''}</b>` : p.finishedAt ? html`Synced <b>${fmtClock(p.finishedAt)}</b> · workspace <b>${workspace.mode}</b>` : '');
}

/* ---------- Global interactions ---------- */
installTooltips();
on(document, 'click', '[data-nav]', (_, b) => nav(b.dataset.nav));
on(document, 'click', '[data-open]', (ev, b) => { ev.preventDefault(); closeTop(); ctx.openDossier(b.dataset.open); });
on(document, 'click', '[data-member]', (ev, b) => { ev.preventDefault(); ctx.openMember(b.dataset.member); });
on(document, 'click', '[data-watch]', (ev, b) => { ev.stopPropagation(); ctx.toggleWatch(b.dataset.watch); });
on(document, 'click', '[data-graph]', (_, b) => ctx.showGraph(b.dataset.graph));
$('#omni').addEventListener('click', () => openPalette(paletteItems));
$('#sb-keys').addEventListener('click', showShortcuts);

let pendingG = 0;
document.addEventListener('keydown', ev => {
  const t = ev.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (!overlayOpen()) openPalette(paletteItems); return; }
  if (ev.key === 'Escape') { if (closeTop()) ev.preventDefault(); return; }
  if (typing || overlayOpen() || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (pendingG && Date.now() - pendingG < 1200) {
    pendingG = 0;
    const n = NAV.find(x => x.go === ev.key.toLowerCase());
    if (n) { nav(n.key); ev.preventDefault(); }
    return;
  }
  if (ev.key === 'g') { pendingG = Date.now(); return; }
  if (ev.key === '/') { ev.preventDefault(); openPalette(paletteItems); return; }
  if (ev.key === '?') { showShortcuts(); return; }
  if (ev.key === 'b') { openBrief(); return; }
  if (ev.key === 'r') { ctx.runPipeline({ refresh: true }); return; }
  if (store.get().view === 'signals' && views.signals.key(ev)) ev.preventDefault();
});

window.addEventListener('resize', debounce(() => { const v = views[store.get().view]; v.onResize && v.onResize(); }, 150));

function showShortcuts() {
  const k = (...keys) => html`<dt>${keys.map(x => html`<kbd>${x}</kbd>`)}</dt>`;
  openModal({
    title: 'Keyboard shortcuts',
    content: html`<dl class="shortcuts">
      ${k('⌘', 'K')}<dd>Command palette (also <kbd>/</kbd>)</dd>
      ${k('G', 'S')}<dd>Signals</dd>${k('G', 'G')}<dd>Link analysis</dd>${k('G', 'D')}<dd>Dossier</dd>${k('G', 'C')}<dd>Member profile</dd>${k('G', 'M')}<dd>Model</dd>${k('G', 'P')}<dd>Portfolio</dd>${k('G', 'L')}<dd>Lineage</dd>
      ${k('J')}<dd>Next signal</dd>${k('K')}<dd>Previous signal</dd>${k('Enter')}<dd>Open dossier for the selected signal</dd>${k('W')}<dd>Add or remove the selected signal from the portfolio</dd>
      ${k('B')}<dd>Desk brief from Claude</dd>${k('R')}<dd>Refresh from Quiver</dd>${k('Esc')}<dd>Close the top panel</dd></dl>`
  });
}

function paletteItems() {
  const st = store.get();
  const items = [];
  for (const n of NAV) items.push({ kind: 'Go to', label: n.label, hint: `G ${n.go.toUpperCase()}`, rank: 3, run: () => nav(n.key) });
  items.push({ kind: 'Action', label: 'Refresh from Quiver', hint: 'R', rank: 2, run: () => ctx.runPipeline({ refresh: true }) });
  items.push({ kind: 'Action', label: 'Desk brief from Claude', hint: 'B', rank: 2, run: openBrief });
  for (const d of WINDOWS) items.push({ kind: 'Window', label: `Look back ${d} days`, hint: st.windowDays === d ? 'current' : '', rank: 1, run: () => { store.set({ windowDays: d }); ctx.runPipeline(); } });
  for (const [k, p] of Object.entries(PRESETS)) items.push({ kind: 'Model', label: `${p.label} weights`, hint: st.model.preset === k ? 'current' : '', rank: 1, run: () => ctx.applyPreset(k) });
  for (const s of st.signals.slice(0, 400)) items.push({ kind: 'Ticker', label: s.ticker, hint: `${s.company ? s.company.slice(0, 40) + ' · ' : ''}tier ${s.tier} · ${s.score}`, rank: 2 - s.rank / 1000, run: () => ctx.openDossier(s.ticker) });
  const members = new Map();
  for (const r of st.data?.congressRows || []) if (!members.has(r.representative)) members.set(r.representative, r);
  for (const [name, r] of members) items.push({ kind: 'Member', label: name, hint: [r.party, r.chamber].filter(Boolean).join(' · '), rank: 0.5, run: () => ctx.openMember(name) });
  const insiders = new Map();
  for (const s of st.signals.slice(0, 300)) for (const b of s.insider.buyers) if (!insiders.has(b.name)) insiders.set(b.name, s.ticker);
  for (const [name, t] of insiders) items.push({ kind: 'Insider', label: name, hint: t, rank: 0.4, run: () => ctx.openDossier(t) });
  return items;
}

/* ---------- Desk brief (Claude) ---------- */
function openBrief() {
  const st = store.get();
  if (!ctx.caps.sample) { toast('The desk brief needs permission to use Claude on claude.ai.', 'error'); return; }
  if (!st.signals.length) { toast('Wait for the signals to load first.'); return; }
  let ctl = null;
  openDrawer({
    title: 'Desk brief',
    src: `Claude · top ${Math.min(14, st.signals.length)} of ${fmtInt(st.signals.length)}`,
    onClose: () => ctl && ctl.stop(),
    render(body) {
      const run = refresh => {
        const s = store.get();
        mount(body, html`<div class="ins-actions" style="margin-bottom:12px"><button class="btn sm" type="button" id="br-stop">Stop</button><span class="xs muted" id="br-note">Claude is weighing the signals. Usually 30–90 seconds.</span></div><div class="md" id="br-out"><p class="thinking">Thinking…</p></div>`);
        const out = $('#br-out', body), note = $('#br-note', body);
        ctl = streamInto(ctx.caps.sample, deskBriefPrompt({ signals: s.signals, asOf: s.data.asOf, windowDays: s.windowDays, capital: s.workspace.portfolio.capital }), {
          cache: refresh ? { gcTime: 3600000, refresh: true } : { gcTime: 3600000 },
          render: text => mount(out, markdown(text)),
          onDone: r => { note.textContent = r.truncated ? 'Cut short by the length limit.' : `Written ${fmtClock(Date.now())} from the ${s.windowDays}-day screen, ${s.model.preset} weights.`; done(); },
          onError: e => { if (e && e.code === 'refused') mount(out, ''); note.textContent = sampleErrorCopy(e); done(); }
        });
        $('#br-stop', body).addEventListener('click', () => ctl.stop());
        function done() {
          const stop = $('#br-stop', body);
          if (stop) { stop.textContent = 'Rewrite'; stop.replaceWith(stop.cloneNode(true)); $('#br-stop', body).addEventListener('click', () => run(true)); }
        }
      };
      run(false);
    }
  });
}

/* ---------- Boot ---------- */
function boot() {
  const hash = (location.hash || '').slice(1);
  const m = /^dossier-([A-Z0-9.\-]{1,8})$/.exec(hash);
  if (m) nav('dossier', { ticker: m[1] });
  else nav(NAV.some(n => n.key === hash) ? hash : 'signals');
  chrome(store.get());

  const C = window.claude;
  const setCap = (k, v) => store.set({ caps: { ...store.get().caps, [k]: v } });
  if (!C || typeof C.use !== 'function') {
    store.set({ caps: { mcp: 'off', sample: 'off', db: 'off', downloads: 'off' } });
    return;
  }
  C.use('mcp').then(m2 => {
    mcp = m2;
    setCap('mcp', m2 ? 'on' : 'off');
    if (m2) ctx.runPipeline();
  }).catch(() => setCap('mcp', 'off'));
  C.use('sample').then(s => { ctx.caps.sample = s; setCap('sample', s ? 'on' : 'off'); }).catch(() => setCap('sample', 'off'));
  C.use('downloads').then(d => { ctx.caps.downloads = d; setCap('downloads', d ? 'on' : 'off'); }).catch(() => setCap('downloads', 'off'));
  Promise.all([C.use('db').catch(() => null), C.use('user').catch(() => null)]).then(([db, user]) => {
    setCap('db', db ? 'on' : 'off');
    workspace.attach(db, user);
  });
}
boot();
