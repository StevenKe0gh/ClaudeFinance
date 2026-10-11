import { html, mount, on, $ } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip, flagsList, roleChip, partyChip, errorAlert, kpi, scoreCell, skeletonRows } from '../ui/parts.js';
import { sparkline, stackbar, waterfall, activityChart } from '../ui/charts.js';
import { fmtUSD, fmtInt, fmtAge, fmtDate, fmtPct, dayRange } from '../core/util.js';
import { brand, brandHead, nameOf } from '../ui/brand.js';
import { WINDOWS } from '../core/config.js';
import { PRESETS } from '../model/score.js';

export const DEFAULT_FILTERS = Object.freeze({
  source: 'all',
  tiers: { A: true, B: true, C: true, D: false },
  csuite: false,
  hideMechanical: false,
  hideEntity: false,
  newOnly: false,
  party: 'any',
  q: '',
  range: null
});

const MECHANICAL = new Set(['placement', 'fixedPrice', 'programmatic', 'stakeJump']);

export function applyFilters(signals, f, days) {
  const rangeIdx = f.range && days ? [days.indexOf(f.range[0]), days.indexOf(f.range[1])] : null;
  const q = f.q.trim().toLowerCase();
  return signals.filter(s => {
    if (!f.tiers[s.tier]) return false;
    const hasI = s.insider.buyers.length > 0;
    const hasC = s.congress.members.some(m => !m.washOnly) || s.congress.buys > 0;
    if (f.source === 'insider' && !hasI) return false;
    if (f.source === 'congress' && !hasC) return false;
    if (f.source === 'both' && !s.flags.some(x => x.id === 'convergence')) return false;
    if (f.source === 'oversight' && !s.congress.overseers) return false;
    if (f.csuite && !s.insider.buyers.some(b => b.role === 'csuite')) return false;
    if (f.hideMechanical && s.notes.some(n => MECHANICAL.has(n.key))) return false;
    if (f.hideEntity && s.flags.some(x => x.id === 'entity')) return false;
    if (f.newOnly && !s.isNew) return false;
    if (f.party !== 'any') {
      const ps = new Set(s.congress.members.filter(m => !m.washOnly).map(m => m.party));
      if (f.party === 'bi' ? !(ps.has('D') && ps.has('R')) : !ps.has(f.party)) return false;
    }
    if (rangeIdx && rangeIdx[0] >= 0) {
      let hit = false;
      for (let i = rangeIdx[0]; i <= rangeIdx[1]; i++) if (s.daily[i]) { hit = true; break; }
      if (!hit) return false;
    }
    if (q && !(s.ticker.toLowerCase().includes(q) || s.company.toLowerCase().includes(q) || nameOf(s.ticker).toLowerCase().includes(q) ||
      s.insider.buyers.some(b => b.name.toLowerCase().includes(q)) || s.congress.members.some(m => m.name.toLowerCase().includes(q)))) return false;
    return true;
  });
}

const SORTS = {
  score: s => s.score,
  ticker: s => nameOf(s.ticker, s.company).toLowerCase(),
  move: s => s._move ?? -1e9,
  insiders: s => s.insider.buyers.length,
  insiderUsd: s => s.insider.usd,
  stake: s => s.insider.stakeMedian ?? -1,
  members: s => s.congress.members.filter(m => !m.washOnly).length,
  congressUsd: s => s.congress.usd,
  last: s => s.lastActivity || ''
};

/** Score and rank from the most recent earlier daily snapshot for this window. */
export function previousSnapshot(st) {
  const snaps = st.cloud?.snapshots || [];
  const asOf = st.data?.asOf;
  if (!asOf) return null;
  const prev = snaps.filter(x => x.w === st.windowDays && x.date < asOf).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!prev) return null;
  const map = new Map(prev.top.map(([t, score, tier], i) => [t, { score, tier, rank: i + 1 }]));
  return { date: prev.date, map };
}

/** Last price, day change and move since the insiders' average buy price. */
export function quoteFor(st, s) {
  const q = st.cloud?.quotes?.q?.[s.ticker];
  if (!q) return null;
  const [last, pct] = q;
  const avg = s.insider.avgPrice;
  // A ratio beyond 5× either way is a unit mismatch (ADS vs ordinary shares), not a move.
  const ratio = avg && last ? last / avg : null;
  return { last, pct, sinceInsider: ratio && ratio < 5 && ratio > 0.2 ? (ratio - 1) * 100 : null };
}

export function createSignalsView(ctx) {
  const { store } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-signals';
  let limit = 150;
  let visible = [];

  mount(el, html`
    <div class="view-h">
      <div><h1>Signals</h1><p>Open-market insider purchases and congressional buying, scored by the conviction model. Select a row to see why it scored what it did.</p></div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Look-back window" id="sig-win">${WINDOWS.map(d => html`<button type="button" data-d="${d}">${d}D</button>`)}</div>
        <select class="input" id="sig-preset" aria-label="Model preset">${Object.entries(PRESETS).map(([k, p]) => html`<option value="${k}">${p.label}</option>`)}<option value="custom" disabled>Custom</option></select>
        <button class="btn" type="button" id="sig-brief">${ICON.spark} Desk brief</button>
        <button class="btn" type="button" id="sig-refresh" data-tip="Re-pull from Quiver, bypassing the 5-minute cache">${ICON.refresh} Refresh</button>
      </div>
    </div>
    <div class="kpis" id="sig-kpis"></div>
    <div id="sig-alert"></div>
    <div class="sig-grid">
      <aside class="panel sig-facets" aria-label="Filters">
        <div class="panel-h"><h2>Filters</h2><span class="grow"></span><button class="btn ghost sm" type="button" id="f-reset">Reset</button></div>
        <div class="panel-b flush" id="facets"></div>
      </aside>
      <section class="panel sig-table">
        <div class="panel-h"><h2>Ranked signals</h2><span class="src" id="sig-count"></span><span class="grow"></span><span class="legend"><span><i class="sw" data-g="insider"></i>Insider</span><span><i class="sw" data-g="congress"></i>Congress</span><span><i class="sw" data-g="cross"></i>Cross</span></span></div>
        <div class="table-wrap" id="sig-wrap" tabindex="0" aria-label="Signals table. Use J and K to move, Enter to open."></div>
        <div class="table-foot" id="sig-foot"></div>
      </section>
      <aside class="panel sig-inspector" id="sig-ins" aria-label="Inspector"></aside>
      <section class="panel sig-activity">
        <div class="panel-h"><h2>Daily activity</h2><span class="src">drag to filter by date</span><span class="grow"></span><span id="act-range"></span></div>
        <div class="panel-b"><div class="legend"><span><i class="sw" data-g="insider"></i>Insider purchases</span><span><i class="sw" data-g="congress"></i>Congressional filings</span></div><div class="chart" id="act-chart"></div></div>
      </section>
    </div>`);

  /* ---------- Facets ---------- */
  function renderFacets(st) {
    const f = st.filters;
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const s of st.signals) counts[s.tier]++;
    const opt = (name, value, label) => html`<label class="check"><input type="radio" name="${name}" value="${value}" ${f[name] === value ? 'checked' : ''}> ${label}</label>`;
    mount($('#facets', el), html`
      <div class="facet"><span class="label">Search</span><input class="input" id="f-q" type="search" placeholder="Company, ticker, insider, member" value="${f.q}" aria-label="Search signals"></div>
      <div class="facet"><span class="label">Tier</span><div class="tiers">${['A', 'B', 'C', 'D'].map(t => html`<button type="button" data-tier="${t}" aria-pressed="${!!f.tiers[t]}" data-tip="${`Tier ${t}: ${counts[t]} tickers`}">${tierChip(t)}</button>`)}<span class="count">${fmtInt(counts.A + counts.B + counts.C + counts.D)}</span></div></div>
      <div class="facet"><span class="label">Source</span>${opt('source', 'all', 'Any')}${opt('source', 'oversight', 'Congress with committee oversight')}${opt('source', 'congress', 'Congress buying')}${opt('source', 'insider', 'Insider buying')}${opt('source', 'both', 'Both (convergence)')}</div>
      <div class="facet"><span class="label">Quality</span>
        <label class="check"><input type="checkbox" data-f="csuite" ${f.csuite ? 'checked' : ''}> C-suite bought</label>
        <label class="check"><input type="checkbox" data-f="hideMechanical" ${f.hideMechanical ? 'checked' : ''}> Hide offerings and programs</label>
        <label class="check"><input type="checkbox" data-f="hideEntity" ${f.hideEntity ? 'checked' : ''}> Hide fund-only buying</label>
        <label class="check"><input type="checkbox" data-f="newOnly" ${f.newOnly ? 'checked' : ''}> New since last visit</label></div>
      <div class="facet"><span class="label">Congress party</span>${opt('party', 'any', 'Any')}${opt('party', 'D', 'Democrat')}${opt('party', 'R', 'Republican')}${opt('party', 'bi', 'Bipartisan')}</div>`);
  }
  const setFilters = patch => { store.set({ filters: { ...store.get().filters, ...patch } }); limit = 150; };
  on(el, 'input', '#f-q', (_, t) => setFilters({ q: t.value }));
  on(el, 'click', '[data-tier]', (_, t) => { const f = store.get().filters; setFilters({ tiers: { ...f.tiers, [t.dataset.tier]: !f.tiers[t.dataset.tier] } }); });
  on(el, 'change', 'input[type=radio]', (_, t) => setFilters({ [t.name]: t.value }));
  on(el, 'change', 'input[data-f]', (_, t) => setFilters({ [t.dataset.f]: t.checked }));
  on(el, 'click', '#f-reset', () => setFilters({ ...DEFAULT_FILTERS }));

  /* ---------- Toolbar ---------- */
  on(el, 'click', '#sig-win button', (_, b) => { store.set({ windowDays: +b.dataset.d, filters: { ...store.get().filters, range: null } }); ctx.runPipeline(); });
  on(el, 'change', '#sig-preset', (_, s) => ctx.applyPreset(s.value));
  on(el, 'click', '#sig-brief', () => ctx.openBrief());
  on(el, 'click', '#sig-refresh', () => ctx.runPipeline({ refresh: true }));
  on(el, 'click', '[data-retry]', () => ctx.runPipeline({ refresh: true }));

  /* ---------- Table ---------- */
  function renderTable(st) {
    const wrap = $('#sig-wrap', el);
    const loading = st.pipeline.status === 'running' && !st.signals.length;
    const head = html`<thead><tr>
      ${th('ticker', 'Company', st)}${th('score', 'Score · mix', st)}${th('move', 'Price · vs insiders', st, 'num')}${th('insiders', 'Insiders · stake', st)}${th('members', 'Congress', st)}${th('last', 'Activity', st, 'col-act')}<th>Flags</th><th><span class="sr-only">Watch</span></th></tr></thead>`;
    if (loading) { mount(wrap, html`<table class="grid">${head}<tbody>${skeletonRows(8, 12)}</tbody></table>`); $('#sig-foot', el).textContent = ''; return; }
    const days = st.data ? dayRange(st.data.from, st.data.asOf) : null;
    const filtered = applyFilters(st.signals, st.filters, days);
    for (const s of filtered) s._move = quoteFor(st, s)?.sinceInsider ?? null;
    const key = SORTS[st.sort.key] || SORTS.score;
    const dir = st.sort.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dir || a.rank - b.rank; });
    visible = filtered.slice(0, limit);
    $('#sig-count', el).textContent = `${fmtInt(filtered.length)} of ${fmtInt(st.signals.length)}`;
    if (!filtered.length) {
      mount(wrap, st.signals.length
        ? html`<div class="empty"><h3>No signals match these filters</h3><span>Loosen a filter or press Reset.</span></div>`
        : html`<div class="empty"><h3>No signals yet</h3><span>${st.pipeline.status === 'error' ? 'The last pull failed. See the message above.' : 'Signals appear here once the first pull from Quiver finishes.'}</span></div>`);
      $('#sig-foot', el).textContent = '';
      return;
    }
    const watch = new Set(st.workspace.watch.map(w => w.ticker));
    const prev = previousSnapshot(st);
    mount(wrap, html`<table class="grid" id="sig-grid">${head}<tbody>${visible.map(s => row(s, st, watch, prev))}</tbody></table>`);
    const shown = visible.length;
    mount($('#sig-foot', el), html`<span>Showing ${fmtInt(shown)} of ${fmtInt(filtered.length)}</span>${filtered.length > shown ? html`<button class="btn sm" type="button" id="sig-more">Show ${Math.min(150, filtered.length - shown)} more</button>` : ''}<span class="grow" style="flex:1"></span><span><kbd>J</kbd> <kbd>K</kbd> move · <kbd>Enter</kbd> dossier · <kbd>W</kbd> watch</span>`);
  }
  function th(key, label, st, cls = '') {
    const active = st.sort.key === key;
    return html`<th class="sortable ${cls}" data-sort="${key}" ${active ? html`aria-sort="${st.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${label}${active ? (st.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
  }
  function deltaChip(s, prev) {
    if (!prev) return '';
    const p = prev.map.get(s.ticker);
    if (!p) return html`<span class="delta new" data-tip="${`Not in the top 120 on ${fmtDate(prev.date, { year: false })}`}">new</span>`;
    const d = s.score - p.score;
    if (Math.abs(d) < 1) return '';
    return html`<span class="delta ${d > 0 ? 'up' : 'down'}" data-tip="${`Score ${p.score} on ${fmtDate(prev.date, { year: false })} · rank ${p.rank}`}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}</span>`;
  }
  function quoteCell(st, s) {
    const q = quoteFor(st, s);
    if (!q) return html`<span class="dim">—</span>`;
    const cls = v => (v >= 0 ? 'chg-up' : 'chg-down');
    return html`<div class="two" style="align-items:flex-end"><span class="mono">$${q.last < 10 ? q.last.toFixed(3) : q.last.toFixed(2)} <span class="xs ${cls(q.pct)}">${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(1)}%</span></span>${q.sinceInsider == null ? html`<span class="sub dim">—</span>` : html`<span class="sub ${cls(q.sinceInsider)}" data-tip="${`Insiders paid $${s.insider.avgPrice.toFixed(2)} on average`}">${q.sinceInsider >= 0 ? '+' : ''}${q.sinceInsider.toFixed(1)}% vs insiders</span>`}</div>`;
  }
  function row(s, st, watch, prev) {
    const top = s.insider.buyers[0];
    const realMembers = s.congress.members.filter(m => !m.washOnly);
    const parties = [...new Set(realMembers.map(m => m.party))].join('·');
    const watched = watch.has(s.ticker);
    return html`<tr data-t="${s.ticker}" aria-selected="${st.selected === s.ticker}">
      <td><span class="cell-row">${tierChip(s.tier)}${brand(s.ticker, { name: nameOf(s.ticker, s.company), size: 26 })}${s.isNew ? html`<span class="new-badge" data-tip="New activity since your last visit">NEW</span>` : ''}</span></td>
      <td><div class="score-mix"><span class="cell-row">${scoreCell(s)}${deltaChip(s, prev)}</span>${stackbar(s.factors, 88)}</div></td>
      <td class="num">${quoteCell(st, s)}</td>
      <td>${s.insider.buyers.length ? html`<div class="two"><span class="mono">${s.insider.buyers.length} · ${fmtUSD(s.insider.usd)}</span><span class="sub" data-tip="${top ? `${top.name} · ${top.title || ''}${s.insider.stakeMedian != null ? ` · median stake increase ${fmtPct(Math.min(s.insider.stakeMedian, 999))}` : ''}` : ''}">${top ? (top.role === 'csuite' ? (top.title || 'C-suite') : { officer: 'Officer', director: 'Director', fund: 'Fund', holder: '10% owner' }[top.role]) : ''}${s.insider.stakeMedian != null ? ` · +${fmtPct(Math.min(s.insider.stakeMedian, 999))}` : ''}</span></div>` : html`<span class="dim">—</span>`}</td>
      <td>${realMembers.length || s.congress.buys ? html`<div class="two"><span class="mono">${realMembers.length || '·'} · ${s.congress.usd ? fmtUSD(s.congress.usd) : '—'}</span><span class="sub">${s.congress.overseers ? html`<span class="ovs-sub" data-tip="${s.flags.find(x => x.id === 'oversight')?.detail || ''}">◆ oversight</span> ` : ''}${parties || (s.congress.conv90 ? `${s.congress.conv90} buys / 90d` : '')}</span></div>` : s.congress.conv90 ? html`<span class="sub dim" data-tip="Congressional purchases in the last 90 days">${s.congress.conv90} / 90d</span>` : html`<span class="dim">—</span>`}</td>
      <td class="col-act"><span class="act" data-tip="${`Last activity ${fmtDate(s.lastActivity)} · bars are daily filings in the window`}">${sparkline(s.daily, { w: 64, h: 16 })}<span class="mono xs muted">${fmtAge(s.lastActivity, st.data.asOf)}</span></span></td>
      <td>${flagsList(s.flags, 1)}</td>
      <td><button class="btn ghost sm" type="button" data-watch="${s.ticker}" aria-pressed="${watched}" data-tip="${watched ? 'Remove from plan' : 'Add to plan'}">${watched ? '★' : '☆'}</button></td>
    </tr>`;
  }
  on(el, 'click', 'th[data-sort]', (_, t) => {
    const s = store.get().sort;
    const k = t.dataset.sort;
    store.set({ sort: { key: k, dir: s.key === k ? (s.dir === 'desc' ? 'asc' : 'desc') : k === 'ticker' ? 'asc' : 'desc' } });
  });
  on(el, 'click', '#sig-grid tbody tr', (ev, tr) => {
    if (ev.target.closest('button')) return;
    store.set({ selected: tr.dataset.t });
  });
  on(el, 'dblclick', '#sig-grid tbody tr', (_, tr) => ctx.openDossier(tr.dataset.t));
  on(el, 'click', '#sig-more', () => { limit += 150; renderTable(store.get()); });

  /* ---------- Inspector ---------- */
  function renderInspector(st) {
    const ins = $('#sig-ins', el);
    const s = st.signals.find(x => x.ticker === st.selected) || null;
    if (!s) {
      mount(ins, html`<div class="panel-h"><h2>Inspector</h2></div><div class="empty"><h3>Select a signal</h3><span>Pick a row to see the score breakdown, who bought, and what to be careful about. Press <kbd>J</kbd> to start.</span></div>`);
      return;
    }
    const watched = st.workspace.watch.some(w => w.ticker === s.ticker);
    const enr = st.enrichment.get(s.ticker);
    mount(ins, html`
      <div class="panel-h"><h2>Inspector</h2><span class="src">rank ${s.rank} of ${fmtInt(st.signals.length)}</span></div>
      <div class="panel-b">
        <div class="ins-h">${brandHead(s.ticker, { name: nameOf(s.ticker, s.company), size: 40 })}${tierChip(s.tier, true)}</div>
        ${(() => { const q = quoteFor(st, s); return q ? html`<div class="small mono">Last $${q.last.toFixed(2)} <span class="${q.pct >= 0 ? 'chg-up' : 'chg-down'}">${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}% today</span>${q.sinceInsider != null ? html` · <span class="${q.sinceInsider >= 0 ? 'chg-up' : 'chg-down'}">${q.sinceInsider >= 0 ? '+' : ''}${q.sinceInsider.toFixed(1)}%</span> vs insiders' $${s.insider.avgPrice.toFixed(2)}` : ''}</div>` : ''; })()}
        <div class="ins-score"><b>${s.score}</b><span class="muted small">conviction score · tier ${s.tier}</span></div>
        <div class="ins-actions">
          <button class="btn primary sm" type="button" data-open="${s.ticker}">${ICON.open} Open dossier</button>
          <button class="btn sm ${watched ? 'on' : ''}" type="button" data-watch="${s.ticker}">${watched ? html`${ICON.check} In plan` : html`${ICON.plus} Add to plan`}</button>
          <button class="btn sm ghost" type="button" data-graph="${s.ticker}">${ICON.focus} Show in graph</button>
        </div>
        <div><div class="label" style="margin-bottom:6px">Score breakdown</div>${waterfall(s)}</div>
        ${s.flags.length ? html`<div><div class="label" style="margin-bottom:6px">Flags</div><ul class="rows">${s.flags.map(f => html`<li><span class="flag" data-tone="${f.tone}">${f.label}</span><span class="grow small muted">${f.detail}</span></li>`)}</ul></div>` : ''}
        ${s.insider.buyers.length ? html`<div><div class="label" style="margin-bottom:2px">Insider buyers · ${fmtUSD(s.insider.usd)}</div><ul class="rows">${s.insider.buyers.slice(0, 6).map(b => html`<li>${roleChip(b.role)}<div class="grow"><div class="t1">${b.name}</div><div class="t2">${b.title || ''}${b.title ? ' · ' : ''}${b.tx} buy${b.tx > 1 ? 's' : ''} · last ${fmtDate(b.lastDate, { year: false })}${b.stakePct != null ? ` · stake +${fmtPct(Math.min(b.stakePct, 999))}` : b.newPosition ? ' · new position' : ''}</div></div><span class="mono">${fmtUSD(b.usd)}</span></li>`)}</ul>${s.insider.buyers.length > 6 ? html`<span class="xs muted">+${s.insider.buyers.length - 6} more in the dossier</span>` : ''}</div>` : ''}
        ${s.congress.members.length ? html`<div><div class="label" style="margin-bottom:2px">Members of Congress</div><ul class="rows">${s.congress.members.slice(0, 6).map(m => html`<li>${partyChip(m.party)}<div class="grow"><button class="linkish t1" type="button" data-member="${m.name}">${m.name}</button><div class="t2">${m.oversees ? html`<span class="ovs-sub" data-tip="${`Oversees ${m.oversees.themeLabel}`}">◆ ${m.oversees.committee}</span> · ` : ''}${m.chamber} · filed ${fmtDate(m.lastFiled, { year: false })} · ${m.ranges.join(', ')}${m.washOnly ? ' · offset by a same-day sale' : ''}</div></div><span class="mono">${m.washOnly ? '0' : fmtUSD(m.usd)}</span></li>`)}</ul></div>` : s.congress.conv90 ? html`<p class="small muted">No congressional buying in this window; ${s.congress.conv90} purchase${s.congress.conv90 > 1 ? 's' : ''} in the last 90 days.</p>` : ''}
        <p class="xs dim">${enr ? `Insider-selling check done: ${fmtInt(enr.sells)} sales worth ${fmtUSD(enr.sellUsd)} in 90 days.` : s.insider.buyers.length ? (s.rank <= 15 ? 'Insider-selling check running…' : 'Insider-selling check runs for the top 15; open the dossier for the full Form 4 history.') : ''}</p>
      </div>`);
  }

  /* ---------- KPIs and activity ---------- */
  function renderKpis(st) {
    const d = st.data;
    const sigs = st.signals;
    if (!d) {
      mount($('#sig-kpis', el), html`${['Tickers screened', 'Tier A', 'Tier B', 'Insider dollars', 'Congress purchases', 'Convergence'].map(l => kpi(l, html`<span class="skel" style="display:block;width:60%;height:18px"></span>`, ''))}`);
      return;
    }
    const insiders = new Set(d.insiderBuys.map(r => r.owner)).size;
    const cBuys = d.congressRows.filter(r => r.kind === 'buy');
    const members = new Set(cBuys.map(r => r.representative)).size;
    const tiers = sigs.reduce((m, s) => (m[s.tier]++, m), { A: 0, B: 0, C: 0, D: 0 });
    const conv = sigs.filter(s => s.flags.some(f => f.id === 'convergence')).length;
    const fresh = sigs.filter(s => s.isNew).length;
    mount($('#sig-kpis', el), html`
      ${kpi('Tickers screened', fmtInt(sigs.length), `${d.windowDays} days to ${fmtDate(d.asOf, { year: false })}`)}
      ${kpi('Tier A', fmtInt(tiers.A), `score ≥ ${st.model.tiers.A} · Tier B ${fmtInt(tiers.B)}`)}
      ${kpi('Insider dollars', fmtUSD(d.insiderBuys.reduce((s, r) => s + r.value, 0)), `${fmtInt(d.insiderBuys.length)} buys by ${fmtInt(insiders)} insiders`)}
      ${kpi('Congress purchases', fmtInt(cBuys.length), `by ${fmtInt(members)} members`)}
      ${kpi('Convergence', fmtInt(conv), 'insiders and Congress both bought')}
      ${kpi('New since last visit', st.session.lastSeenPrev ? fmtInt(fresh) : '—', st.session.lastSeenPrev ? `since ${fmtDate(st.session.lastSeenPrev, { year: false })}` : 'first visit')}`);
  }
  function renderAlert(st) {
    const p = st.pipeline;
    const host = $('#sig-alert', el);
    if (st.caps.mcp === 'off') {
      mount(host, html`<div class="alert" data-tone="info"><div><b>Live data needs the claude.ai viewer</b>Open this page on claude.ai, signed in to the account that has the Quiver Quant connector. Everything here is computed from that connector; nothing is stored on a server.</div></div>`);
      return;
    }
    if (p.status === 'error') {
      mount(host, html`<div style="display:flex;flex-direction:column;gap:8px">${errorAlert(p.error)}<div><button class="btn" type="button" data-retry>${ICON.refresh} Retry</button></div></div>`);
      return;
    }
    if (p.status === 'running') {
      const parts = p.stages.filter(s => s.key !== 'enrich').map(s => `${s.label}: ${s.status === 'done' || s.status === 'partial' ? fmtInt(s.rows) + ' rows' : s.status}`);
      mount(host, html`<div class="alert" data-tone="info"><div><b>Pulling filings from Quiver</b><span class="mono xs">${parts.join(' · ')}</span></div></div>`);
      return;
    }
    const warn = [];
    if (st.data && !st.data.coverage.insider) warn.push('Form 4 purchases hit the page limit; the oldest days of the window may be missing.');
    if (st.data && !st.data.coverage.congress) warn.push('Congressional trades hit the page limit.');
    if (st.data && st.data.failures.length) warn.push(`${st.data.failures.length} dataset${st.data.failures.length > 1 ? 's' : ''} failed to load; scores use what arrived.`);
    mount(host, warn.length ? html`<div class="alert" data-tone="warn"><div>${warn.join(' ')}</div></div>` : '');
  }
  function renderActivity(st) {
    const chartEl = $('#act-chart', el);
    const d = st.data;
    if (!d) { mount(chartEl, html`<div class="skel" style="height:120px"></div>`); return; }
    const days = dayRange(d.from, d.asOf);
    const idx = new Map(days.map((x, i) => [x, i]));
    const ins = new Array(days.length).fill(0);
    const cg = new Array(days.length).fill(0);
    for (const r of d.insiderBuys) { const i = idx.get(r.date); if (i != null) ins[i]++; }
    for (const r of d.congressRows) if (r.kind === 'buy') { const i = idx.get(r.filed); if (i != null) cg[i]++; }
    activityChart(chartEl, { days, insider: ins, congress: cg, range: st.filters.range, onRange: range => setFilters({ range }) });
    const r = st.filters.range;
    mount($('#act-range', el), r ? html`<button class="btn sm" type="button" id="act-clear">${r[0] === r[1] ? fmtDate(r[0], { year: false }) : `${fmtDate(r[0], { year: false })} – ${fmtDate(r[1], { year: false })}`} ✕</button>` : '');
  }
  on(el, 'click', '#act-clear', () => setFilters({ range: null }));

  function renderToolbar(st) {
    for (const b of el.querySelectorAll('#sig-win button')) b.setAttribute('aria-pressed', String(+b.dataset.d === st.windowDays));
    $('#sig-preset', el).value = st.model.preset in PRESETS ? st.model.preset : 'custom';
    $('#sig-brief', el).disabled = !st.signals.length || !ctx.caps.sample;
    $('#sig-brief', el).setAttribute('data-tip', ctx.caps.sample ? 'Claude weighs the top signals against each other' : 'Needs permission to use Claude on claude.ai');
    $('#sig-refresh', el).disabled = st.pipeline.status === 'running';
  }

  function render(st, changed) {
    const all = !changed;
    const has = k => all || changed.includes(k);
    if (all || has('windowDays') || has('model') || has('signals') || has('pipeline')) renderToolbar(st);
    if (all || has('data') || has('signals') || has('model') || has('session')) renderKpis(st);
    if (all || has('pipeline') || has('data') || has('caps')) renderAlert(st);
    if (all || has('signals') || has('filters')) renderFacets(st);
    if (all || has('signals') || has('filters') || has('sort') || has('selected') || has('workspace') || has('pipeline') || has('cloud')) renderTable(st);
    if (all || has('signals') || has('selected') || has('workspace') || has('enrichment') || has('cloud')) renderInspector(st);
    if (all || has('data') || has('filters')) renderActivity(st);
  }

  /** Keyboard: J/K move selection, Enter opens, W toggles watch. */
  function key(ev) {
    const st = store.get();
    if (!visible.length) return false;
    const i = visible.findIndex(s => s.ticker === st.selected);
    if (ev.key === 'j' || ev.key === 'ArrowDown') { store.set({ selected: visible[Math.min(visible.length - 1, i + 1)].ticker }); scrollSel(); return true; }
    if (ev.key === 'k' || ev.key === 'ArrowUp') { store.set({ selected: visible[Math.max(0, i - 1)].ticker }); scrollSel(); return true; }
    if (ev.key === 'Enter' && st.selected) { ctx.openDossier(st.selected); return true; }
    if (ev.key === 'w' && st.selected) { ctx.toggleWatch(st.selected); return true; }
    return false;
  }
  const scrollSel = () => { const r = el.querySelector('#sig-grid tr[aria-selected="true"]'); r && r.scrollIntoView({ block: 'nearest' }); };

  return { el, render, key, onResize: () => renderActivity(store.get()) };
}
