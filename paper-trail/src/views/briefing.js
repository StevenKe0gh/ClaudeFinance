import { html, mount, on, $, markdown } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip, scoreCell } from '../ui/parts.js';
import { brand, nameOf } from '../ui/brand.js';
import { fmtDate, fmtInt, fmtUSD, fmtClock, fmtSignedPct, isoDate } from '../core/util.js';
import { holdingAlerts } from '../app/portfolio.js';
import { previousSnapshot, quoteFor } from './signals.js';

const STEP_LABEL = { quiver: 'Quiver filings', analysis: 'Analysis', holdings: 'Holdings check', quotes: 'Quotes', prices: 'Yahoo prices', logos: 'Logos', brief: 'Brief' };

/**
 * Briefing: the morning page. The daily job writes a brief, quotes, prices
 * and logos to the database before the market opens; this view combines that
 * with the live screen and the imported depot, and can start the job on demand.
 */
export function createBriefingView(ctx) {
  const { store, portfolio } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-briefing';
  let shown = null;

  mount(el, html`
    <div class="view-h">
      <div><h1>Briefing</h1><p id="b-sub">The daily read: new insider and congressional buying, what changed since yesterday, and what it means for your holdings.</p></div>
      <div class="tools">
        <button class="btn" type="button" id="b-desk">${ICON.spark} Desk brief</button>
        <button class="btn primary" type="button" id="b-run">${ICON.play} Run now</button>
      </div>
    </div>
    <div class="brief-grid">
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel" id="b-hero"></section>
        <section class="panel"><div class="panel-h"><h2>Strongest signals today</h2><span class="src" id="b-sig-src"></span><span class="grow"></span><button class="btn ghost sm" type="button" data-nav="signals">All signals ${ICON.open}</button></div><div class="panel-b" id="b-picks"></div></section>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel"><div class="panel-h"><h2>Daily job</h2><span class="src" id="b-job-src"></span></div><div class="panel-b" id="b-job"></div></section>
        <section class="panel"><div class="panel-h"><h2>Your holdings</h2><span class="grow"></span><button class="btn ghost sm" type="button" data-nav="holdings">Holdings ${ICON.open}</button></div><div class="panel-b" id="b-hold"></div></section>
        <section class="panel"><div class="panel-h"><h2>Since yesterday</h2><span class="src" id="b-chg-src"></span></div><div class="panel-b" id="b-chg"></div></section>
        <section class="panel"><div class="panel-h"><h2>Archive</h2><span class="src">previous briefs</span></div><div class="panel-b" id="b-arch"></div></section>
      </div>
    </div>`);

  function hero(st) {
    const briefs = st.cloud?.briefs || [];
    const b = shown ? briefs.find(x => x.id === shown) || briefs[0] : briefs[0];
    const host = $('#b-hero', el);
    if (!b) {
      const top = st.signals.filter(s => s.tier === 'A').slice(0, 3);
      mount(host, html`<div class="brief-hero"><span class="date">${fmtDate(isoDate())} · live</span>
        <h2>${st.signals.length ? `${fmtInt(st.signals.filter(s => s.tier === 'A').length)} tier-A signals in the ${st.windowDays}-day screen${top.length ? `, led by ${top.map(s => nameOf(s.ticker, s.company)).join(', ')}` : ''}.` : st.caps.mcp === 'off' ? 'Open on claude.ai to load live filings.' : 'Loading today’s filings…'}</h2>
        <p class="small muted">The written brief arrives with the first daily run. Until then this page summarises the live screen. Press <b>Run now</b> to start the job, or <b>Desk brief</b> for an instant read from Claude.</p></div>`);
      return;
    }
    const stale = b.date && b.date < isoDate() && !shown;
    mount(host, html`<div class="brief-hero"><span class="date">${fmtDate(b.date)}${b.generatedAt ? ` · ${fmtClock(Date.parse(b.generatedAt))}` : ''}${shown && shown !== briefs[0]?.id ? html` · archive <button class="linkish" type="button" id="b-latest">back to latest</button>` : ''}${stale ? ' · today’s run has not finished yet' : ''}</span>
      <h2>${b.headline || 'Daily brief'}</h2>
      <div class="md">${markdown(b.markdown || '')}</div>
      ${b.sources ? html`<p class="xs dim">${b.sources}</p>` : ''}</div>`);
  }

  function picks(st) {
    const live = st.signals.filter(s => s.tier === 'A' || s.tier === 'B').slice(0, 6);
    const brief = st.cloud?.briefs?.[0];
    const prev = previousSnapshot(st);
    $('#b-sig-src', el).textContent = live.length ? `live · ${st.windowDays}d · ${st.model.preset}` : brief?.picks?.length ? `from the ${fmtDate(brief.date, { year: false })} brief` : '';
    if (live.length) {
      const why = new Map((brief?.picks || []).map(p => [p.ticker, p.why]));
      mount($('#b-picks', el), html`${live.map(s => {
        const q = quoteFor(st, s);
        const p = prev && prev.map.get(s.ticker);
        const top = s.insider.buyers[0];
        const reason = why.get(s.ticker) || [top ? `${top.name} (${top.title || top.role}) bought ${fmtUSD(top.usd)}` : null, s.congress.members.filter(m => !m.washOnly).length ? `${s.congress.members.filter(m => !m.washOnly).length} member(s) of Congress bought` : null, s.flags[0]?.label].filter(Boolean).join(' · ');
        return html`<div class="pick"><span class="cell-row">${tierChip(s.tier)}${brand(s.ticker, { name: nameOf(s.ticker, s.company), size: 30 })}</span>
          <span class="cell-row">${q ? html`<span class="mono small">$${q.last.toFixed(2)} ${q.sinceInsider != null ? html`<span class="${q.sinceInsider >= 0 ? 'chg-up' : 'chg-down'}" data-tip="vs insiders' average buy price">${fmtSignedPct(q.sinceInsider)}</span>` : ''}</span>` : ''}${prev ? (p ? (Math.abs(s.score - p.score) >= 1 ? html`<span class="delta ${s.score > p.score ? 'up' : 'down'}">${s.score > p.score ? '▲' : '▼'}${Math.abs(Math.round(s.score - p.score))}</span>` : '') : html`<span class="delta new">new</span>`) : ''}${scoreCell(s)}</span>
          <p>${reason}</p></div>`;
      })}`);
      return;
    }
    if (brief?.picks?.length) {
      mount($('#b-picks', el), html`${brief.picks.map(p => html`<div class="pick"><span class="cell-row">${tierChip(p.tier || 'B')}${brand(p.ticker, { name: p.name || nameOf(p.ticker), size: 30 })}</span><span class="mono">${p.score ?? ''}</span><p>${p.why || ''}</p></div>`)}`);
      return;
    }
    mount($('#b-picks', el), st.pipeline.status === 'running' ? html`<div class="skel"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div>` : html`<p class="small muted">No tier A or B signals in this window.</p>`);
  }

  function job(st) {
    const j = st.cloud?.job;
    const cfg = st.cloud?.config;
    const host = $('#b-job', el);
    const run = $('#b-run', el);
    const canRun = !!(cfg && cfg.triggerId && ctx.canFireJob());
    run.disabled = !canRun || (j && j.state === 'running' && Date.now() - (j.startedAt || 0) < 45 * 60e3);
    run.setAttribute('data-tip', !cfg?.triggerId ? 'The daily job is not set up for this page yet' : !ctx.canFireJob() ? 'Needs permission to use the Claude Code Remote connector on claude.ai' : 'Start the daily job now (takes 5–15 minutes)');
    $('#b-job-src', el).textContent = cfg?.schedule || 'daily';
    if (st.cloud?.status !== 'on') { mount(host, html`<p class="small muted">Job status, briefs and prices are stored in this page’s database, which needs the claude.ai viewer.</p>`); return; }
    if (!j) { mount(host, html`<p class="small muted">No run recorded yet. ${cfg?.triggerId ? 'The first scheduled run writes here.' : 'Set up the routine to start daily runs.'}</p>`); return; }
    const label = { running: 'Running', ok: 'Finished', partial: 'Finished with gaps', error: 'Failed' }[j.state] || j.state;
    const requested = j.requestedAt && (!j.startedAt || j.requestedAt > j.startedAt) && Date.now() - j.requestedAt < 30 * 60e3;
    mount(host, html`<div style="display:flex;flex-direction:column;gap:10px">
      <div class="cell-row"><span class="status-dot" data-s="${j.state === 'ok' ? 'live' : j.state === 'running' ? 'running' : j.state === 'error' ? 'error' : 'wait'}"></span><b>${requested ? 'Requested, waiting to start' : label}</b><span class="grow"></span><span class="xs muted">${j.finishedAt ? `${fmtDate(new Date(j.finishedAt).toISOString().slice(0, 10), { year: false })} ${fmtClock(j.finishedAt)}` : j.startedAt ? `started ${fmtClock(j.startedAt)}` : ''}</span></div>
      ${j.steps?.length ? html`<div class="job-steps">${j.steps.map(s => html`<span class="job-step" data-s="${s.status}" data-tip="${s.detail || s.status}"><i></i>${STEP_LABEL[s.key] || s.label || s.key}</span>`)}</div>` : ''}
      ${j.message ? html`<p class="small muted">${j.message}</p>` : ''}
      ${cfg?.nextRun ? html`<p class="xs dim">Next scheduled run ${cfg.nextRun}</p>` : ''}</div>`);
  }

  function holdings(st) {
    const d = portfolio.derived();
    const host = $('#b-hold', el);
    if (!d) { mount(host, html`<p class="small muted">Import your Finanzfluss depot to get daily insider and Congress checks on what you own.</p><div style="margin-top:8px"><button class="btn sm" type="button" id="b-import">${ICON.plus} Import depot</button></div>`); return; }
    const list = holdingAlerts(d, st.holdingChecks?.map, st.signals);
    const brief = (st.cloud?.briefs?.[0]?.alerts || []).filter(a => !list.some(b => b.ticker === a.ticker));
    const all = [...list, ...brief].slice(0, 6);
    const best = [...d.positions].sort((a, b) => (b.dayPct ?? 0) - (a.dayPct ?? 0));
    mount(host, html`${all.length ? all.map(a => html`<div class="alert-row" data-tone="${a.tone}"><span class="dot"></span><div><b>${a.ticker ? html`<button class="linkish" type="button" data-open="${a.ticker}">${a.name || nameOf(a.ticker)}</button>` : a.name}</b> ${a.text}</div></div>`) : html`<p class="small muted">${st.holdingChecks?.status === 'running' ? 'Checking your US holdings…' : 'No insider or congressional activity worth flagging in your US holdings.'}</p>`}
      ${best.length ? html`<p class="xs muted" style="margin-top:8px">At import: best day ${best[0].short} ${fmtSignedPct(best[0].dayPct, 2)}, worst ${best.at(-1).short} ${fmtSignedPct(best.at(-1).dayPct, 2)}.</p>` : ''}`);
  }

  function changes(st) {
    const prev = previousSnapshot(st);
    const host = $('#b-chg', el);
    if (!prev || !st.signals.length) { $('#b-chg-src', el).textContent = ''; mount(host, html`<p class="small muted">${st.cloud?.status === 'on' ? 'Comparisons start after the second day of snapshots.' : 'Day-over-day changes need the claude.ai viewer.'}</p>`); return; }
    $('#b-chg-src', el).textContent = `vs ${fmtDate(prev.date, { year: false })}`;
    const newA = st.signals.filter(s => s.tier === 'A' && prev.map.get(s.ticker)?.tier !== 'A').slice(0, 5);
    const movers = st.signals.slice(0, 120).map(s => ({ s, d: prev.map.has(s.ticker) ? s.score - prev.map.get(s.ticker).score : null })).filter(x => x.d != null && Math.abs(x.d) >= 3).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
    const gone = [...prev.map].filter(([t, v]) => v.tier === 'A' && !st.signals.some(s => s.ticker === t && s.tier === 'A')).slice(0, 4);
    mount(host, html`${newA.length ? html`<div class="label" style="margin-bottom:4px">New in tier A</div><ul class="rows">${newA.map(s => html`<li>${brand(s.ticker, { name: nameOf(s.ticker, s.company), size: 20, sub: s.ticker })}<span class="grow"></span><span class="mono">${s.score}</span></li>`)}</ul>` : ''}
      ${movers.length ? html`<div class="label" style="margin:8px 0 4px">Biggest score moves</div><ul class="rows">${movers.map(({ s, d }) => html`<li>${brand(s.ticker, { name: nameOf(s.ticker, s.company), size: 20, sub: s.ticker })}<span class="grow"></span><span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}</span></li>`)}</ul>` : ''}
      ${gone.length ? html`<div class="label" style="margin:8px 0 4px">Dropped out of tier A</div><p class="small">${gone.map(([t]) => nameOf(t)).join(', ')}</p>` : ''}
      ${!newA.length && !movers.length && !gone.length ? html`<p class="small muted">No material changes.</p>` : ''}`);
  }

  function archive(st) {
    const briefs = st.cloud?.briefs || [];
    mount($('#b-arch', el), briefs.length > 1 || (briefs.length && shown)
      ? html`<ul class="rows">${briefs.slice(0, 14).map(b => html`<li><button class="linkish grow t1" type="button" data-brief="${b.id}" style="text-align:left">${b.headline || 'Daily brief'}</button><span class="xs muted nowrap">${fmtDate(b.date, { year: false })}</span></li>`)}</ul>`
      : html`<p class="small muted">Briefs collect here day by day.</p>`);
  }

  function render(st) {
    const cfg = st.cloud?.config;
    $('#b-sub', el).textContent = `${fmtDate(isoDate())} · ${cfg?.schedule ? `runs ${cfg.schedule}` : 'runs once a day'} · combines Quiver filings, your holdings and Yahoo Finance prices.`;
    $('#b-desk', el).disabled = !ctx.caps.sample || !st.signals.length;
    hero(st); picks(st); job(st); holdings(st); changes(st); archive(st);
  }

  on(el, 'click', '#b-run', async () => {
    const b = $('#b-run', el);
    b.disabled = true;
    await ctx.fireJob();
  });
  on(el, 'click', '#b-desk', () => ctx.openBrief());
  on(el, 'click', '#b-import', () => ctx.openImport());
  on(el, 'click', '[data-brief]', (_, b) => { shown = b.dataset.brief; hero(store.get()); el.scrollIntoView?.({ block: 'start' }); });
  on(el, 'click', '#b-latest', () => { shown = null; hero(store.get()); });

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || changed.some(k => ['cloud', 'signals', 'holdingChecks', 'pipeline', 'caps', 'portfolioLocalAt', 'model', 'windowDays'].includes(k))) render(st);
    },
    show() { const st = store.get(); if (st.caps.mcp === 'on' && portfolio.derived() && !st.holdingChecks) portfolio.check(); }
  };
}

