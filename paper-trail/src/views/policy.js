import { html, mount, on, $, $$ } from '../ui/html.js';
import { brand, nameOf } from '../ui/brand.js';
import { tierChip, errorAlert } from '../ui/parts.js';
import { ICON } from '../ui/icons.js';
import { toast } from '../ui/overlay.js';
import { stageTrack, policyLines } from '../ui/policy.js';
import { fmtUSD, fmtDate, fmtInt, fmtClock } from '../core/util.js';
import { crossReference, contractLeaders, isNewSince } from '../model/policy.js';
import { DEFAULT_TOPICS, CONTRACT_DAYS } from '../app/policy.js';
import { analyzeEvent, STATUS, CHANNEL } from '../ai/policy.js';
import { sampleErrorCopy } from '../ai/claude.js';

const EXAMPLES = ['US–Russia diesel deal', 'Ban on Chinese drones', 'Medicare drug price negotiation', 'Ukraine reconstruction fund', 'Stablecoin rules'];
const FEED_FILTERS = { named: 'Naming companies', mine: 'Your names', all: 'All bills', releases: 'Press releases' };
const STATUS_TONE = { law: 'pos', passed: 'pos', bill: 'acc', executive: 'acc', negotiation: 'warn', proposal: 'warn', rumour: 'mute', hypothetical: 'mute' };
const CONF_N = { high: 3, medium: 2, low: 1 };
const REASON = {
  sponsor: ['Sponsor traded it', 'The member who introduced a bill naming this company traded its stock in the screen window'],
  congress: ['Congress buying', 'Members of Congress bought it in the screen window'],
  insider: ['Insider buying', 'Officers or directors bought on the open market'],
  held: ['In your depot', 'You hold it'],
  plan: ['In your plan', 'It is on your plan']
};
const AGENCY_COLORS = ['#4C8DFF', '#C98420', '#1F9E90', '#8C6CF0', '#D9667A', '#7FA650', '#8593A2'];

/**
 * Policy monitor: who profits from an event (Claude with page tools), where
 * new bills and federal awards meet the trading screen, the newest bills
 * that name companies, and topic watches that follow bills through stages.
 */
export function createPolicyView(ctx) {
  const { store, quiver, portfolio, workspace, policy } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-policy';
  let run = null;
  let shown = null;
  let feedFilter = 'named';
  let feedMore = false;
  let topicSel = null;
  let prevSeen = null;
  let built = false;

  const pws = () => ({ topics: DEFAULT_TOPICS, analyses: [], seenAt: null, ...(store.get().workspace.policy || {}) });
  const savePws = patch => workspace.update({ policy: { ...pws(), ...patch } });
  const heldSet = () => new Set(portfolio.derived()?.usTickers || []);
  const planSet = st => new Set(st.workspace.watch.map(w => w.ticker));

  function build() {
    built = true;
    mount(el, html`
      <div class="view-h"><div><h1>Policy</h1><p>Bills before Congress and federal contract awards, matched against the trading you follow. Ask who gains from an event; watch topics as bills move.</p></div>
        <div class="tools"><span class="xs muted" id="pl-stamp"></span><button class="btn sm" type="button" id="pl-refresh">${ICON.refresh} Refresh</button></div></div>
      <section class="panel pl-ask">
        <div class="panel-h"><h2>${ICON.spark} Who profits?</h2><span class="src">Claude · Quiver bills, awards, lobbying and your screen</span></div>
        <div class="panel-b">
          <form id="pl-form" class="pl-form" autocomplete="off">
            <input id="pl-q" type="text" maxlength="200" placeholder="An event or policy, e.g. US–Russia diesel deal" aria-label="Event or policy to trace">
            <button class="btn primary" type="submit">Trace it</button>
          </form>
          <div class="pl-examples"><span class="xs muted">Try</span>${EXAMPLES.map(x => html`<button type="button" class="pl-pill" data-ex="${x}">${x}</button>`)}</div>
          <div id="pl-recent"></div>
          <div id="pl-out"></div>
        </div>
      </section>
      <div class="dz-grid">
        <section class="panel span-7"><div class="panel-h"><h2>Where policy meets trading</h2><span class="src">bills and awards × buying, depot, plan</span></div><div class="panel-b" id="pl-cross"></div></section>
        <section class="panel span-5"><div class="panel-h"><h2>Federal contracts</h2><span class="src">${CONTRACT_DAYS} days · $10M+ · USAspending</span></div><div class="panel-b" id="pl-awards"></div></section>
        <section class="panel span-12"><div class="panel-h"><h2>New bills</h2><span class="grow"></span><div class="seg" role="group" aria-label="Filter bills">${Object.entries(FEED_FILTERS).map(([k, v]) => html`<button type="button" data-ff="${k}" aria-pressed="${k === feedFilter}">${v}</button>`)}</div></div><div class="panel-b" id="pl-feed"></div></section>
        <section class="panel span-12"><div class="panel-h"><h2>Topic watch</h2><span class="src">bills whose title matches · latest stage</span></div><div class="panel-b" id="pl-topics"></div></section>
      </div>`);

    $('#pl-form', el).addEventListener('submit', ev => { ev.preventDefault(); ask($('#pl-q', el).value); });
    on(el, 'click', '[data-ex]', (_, b) => { $('#pl-q', el).value = b.dataset.ex; ask(b.dataset.ex); });
    on(el, 'click', '[data-saved]', (_, b) => { shown = b.dataset.saved; if (run && run.status !== 'running') run = null; renderOut(); renderRecent(); });
    on(el, 'click', '[data-unsave]', (ev, b) => { ev.stopPropagation(); savePws({ analyses: pws().analyses.filter(a => a.id !== b.dataset.unsave) }); if (shown === b.dataset.unsave) shown = null; renderRecent(); renderOut(); });
    on(el, 'click', '#pl-stop', () => run && run.ctl && run.ctl.abort());
    on(el, 'click', '#pl-retry', () => run && ask(run.question));
    on(el, 'click', '#pl-refresh', () => { policy.load({ refresh: true }); const t = currentTopic(); if (t) policy.topic(t, { refresh: true }); });
    on(el, 'click', '[data-ff]', (_, b) => { feedFilter = b.dataset.ff; feedMore = false; for (const x of $$('[data-ff]', el)) x.setAttribute('aria-pressed', String(x === b)); renderFeed(store.get()); });
    on(el, 'click', '#pl-more', () => { feedMore = true; renderFeed(store.get()); });
    on(el, 'click', '[data-topic]', (_, b) => { topicSel = b.dataset.topic; renderTopics(store.get()); });
    on(el, 'click', '[data-untopic]', (ev, b) => { ev.stopPropagation(); const rest = pws().topics.filter(t => t !== b.dataset.untopic); savePws({ topics: rest }); if (topicSel === b.dataset.untopic) topicSel = rest[0] || null; renderTopics(store.get()); });
    on(el, 'submit', '#pl-topic-form', ev => {
      ev.preventDefault();
      const v = $('#pl-topic-in', el).value.trim().slice(0, 40);
      if (!v) return;
      if (!pws().topics.some(t => t.toLowerCase() === v.toLowerCase())) savePws({ topics: [...pws().topics, v] });
      topicSel = v;
      renderTopics(store.get());
    });
    on(el, 'click', '[data-sponsor]', (_, b) => ctx.openMember(b.dataset.sponsor, b.dataset.bio || undefined));
    on(el, 'mouseover', '.pl-co', (_, c) => hiLink(c.dataset.t));
    on(el, 'mouseout', '.pl-co', () => hiLink(null));
  }

  /* ---------- Who profits? ---------- */

  async function ask(q) {
    q = String(q || '').trim();
    if (!q) { $('#pl-q', el).focus(); return; }
    if (!ctx.caps.sample) { toast('Tracing an event needs permission to use Claude on claude.ai.', 'error'); return; }
    if (!store.get().caps || store.get().caps.mcp !== 'on') { toast('Tracing an event needs the Quiver Quant connector.', 'error'); return; }
    if (run && run.status === 'running') run.ctl.abort();
    const st = store.get();
    const ctl = new AbortController();
    const mine = { question: q, status: 'running', steps: [], ctl, started: Date.now() };
    run = mine;
    shown = null;
    renderOut();
    const step = t => { if (run === mine) { mine.steps.push(t); renderOut(); } };
    try {
      const r = await analyzeEvent({ sample: ctx.caps.sample, quiver, question: q, signals: st.signals, held: heldSet(), planned: planSet(st), onStep: step, signal: ctl.signal });
      if (run !== mine) return;
      const saved = { id: `a${Date.now().toString(36)}`, q, at: Date.now(), asOf: r.asOf, result: r.result, exposure: liteExposure(r.exposure), tools: r.usedTools };
      savePws({ analyses: [saved, ...pws().analyses.filter(a => a.q.toLowerCase() !== q.toLowerCase())].slice(0, 8) });
      run = null;
      shown = saved.id;
    } catch (e) {
      if (run !== mine) return;
      mine.status = 'error';
      mine.error = e;
    }
    renderOut();
    renderRecent();
  }

  function liteExposure(ex) {
    const out = {};
    for (const [t, x] of Object.entries(ex || {})) {
      const f = x.federal_awards_12m, l = x.lobbying;
      out[t] = { awards: f && typeof f === 'object' ? f.total_usd : 0, awardsN: f && typeof f === 'object' ? f.actions : 0, lobby: l && typeof l === 'object' ? l.usd_since_last_year : 0 };
    }
    return out;
  }

  function renderRecent() {
    const host = $('#pl-recent', el);
    if (!host) return;
    const list = pws().analyses;
    mount(host, list.length ? html`<div class="pl-recent"><span class="xs muted">Saved</span>${list.map(a => html`<span class="pl-pill saved${a.id === shown ? ' on' : ''}"><button type="button" data-saved="${a.id}" data-tip="${`${a.result.headline}\n${fmtDate(a.asOf)}`}">${a.q}</button><button type="button" class="x" data-unsave="${a.id}" aria-label="${`Delete ${a.q}`}">×</button></span>`)}</div>` : '');
  }

  function renderOut() {
    const host = $('#pl-out', el);
    if (!host) return;
    if (run && run.status === 'running') {
      mount(host, html`<div class="pl-run" aria-live="polite">
        <div class="pl-run-h"><span class="spin" aria-hidden="true"></span><b>Tracing “${run.question}”</b><span class="grow"></span><button class="btn sm" type="button" id="pl-stop">Stop</button></div>
        <ol class="pl-steps">${run.steps.map((s, i) => html`<li${i === run.steps.length - 1 ? html` class="cur"` : ''}>${s}</li>`)}</ol>
        <p class="xs muted">Claude searches bills, checks the candidate companies against federal awards, lobbying and your screen, then writes. Usually 30–90 seconds.</p></div>`);
      return;
    }
    if (run && run.status === 'error') {
      const e = run.error;
      const msg = e && e.code === 'invalid_json' ? 'Claude’s answer could not be read as a result. Try again, or phrase the event more specifically.' : e && e.code && e.code !== 'upstream_error' ? sampleErrorCopy(e) : `Something failed: ${(e && e.message) || 'unknown error'}`;
      mount(host, html`<div class="alert" data-tone="${e && e.code === 'cancelled' ? 'info' : 'error'}" role="alert"><div><b>${e && e.code === 'cancelled' ? 'Stopped' : 'No analysis'}</b> ${msg}</div><button class="btn sm" type="button" id="pl-retry">Try again</button></div>`);
      return;
    }
    const a = shown && pws().analyses.find(x => x.id === shown);
    if (!a) { mount(host, ''); return; }
    mount(host, analysisView(a, store.get()));
    requestAnimationFrame(drawLinks);
  }

  function analysisView(a, st) {
    const r = a.result;
    const sig = new Map(st.signals.map(s => [s.ticker, s]));
    const held = heldSet(), plan = planSet(st);
    const card = (x, side, i) => {
      const s = sig.get(x.ticker);
      const ex = a.exposure && a.exposure[x.ticker];
      const p = policy.for(x.ticker);
      const cg = s ? s.congress.members.filter(m => !m.washOnly) : [];
      const over = cg.filter(m => m.oversees);
      const chips = [];
      if (over.length) chips.push(html`<span class="pl-chip ovs" data-tip="${over.map(m => `${m.name}: ${m.oversees.committee} oversees ${m.oversees.themeLabel}`).join('\n')}">◆ ${over.length > 1 ? `${over.length} overseeing members bought` : `${over[0].name} bought · oversees`}</span>`);
      else if (cg.length) chips.push(html`<span class="pl-chip cg" data-tip="${cg.map(m => m.name).join('\n')}">${cg.length} in Congress bought</span>`);
      if (s && s.insider.buyers.length) chips.push(html`<span class="pl-chip ins">Insiders bought ${fmtUSD(s.insider.usd)}</span>`);
      if (ex && ex.awards) chips.push(html`<span class="pl-chip fed" data-tip="${`${fmtInt(ex.awardsN)} federal award actions in 12 months`}">${fmtUSD(ex.awards)} federal awards · 12m</span>`);
      else if (p && p.contracts) chips.push(html`<span class="pl-chip fed">${fmtUSD(p.contracts.usd)} federal awards · ${CONTRACT_DAYS}d</span>`);
      if (ex && ex.lobby) chips.push(html`<span class="pl-chip lob">Lobbying ${fmtUSD(ex.lobby)}</span>`);
      if (p && p.bills.length) chips.push(html`<span class="pl-chip bill" data-tip="${p.bills.map(b => `${b.billId || b.id}: ${b.title}`).join('\n')}">Named in ${p.bills.length} new bill${p.bills.length > 1 ? 's' : ''}</span>`);
      if (held.has(x.ticker)) chips.push(html`<span class="pl-chip own">In your depot</span>`);
      return html`<article class="pl-co" data-side="${side}" data-conf="${x.confidence}" data-t="${x.ticker}" style="--i:${i}">
        <div class="pl-co-h">${brand(x.ticker, { name: nameOf(x.ticker, x.company), size: 30 })}<span class="grow"></span>${s ? html`<span class="pl-tier" data-tip="${`In the screen: tier ${s.tier}, score ${s.score}, rank ${s.rank}`}">${tierChip(s.tier)}<span class="mono xs">${s.score}</span></span>` : ''}<button class="btn ghost sm icon" type="button" data-watch="${x.ticker}" data-tip="${plan.has(x.ticker) ? 'Remove from your plan' : 'Add to your plan'}" aria-label="${plan.has(x.ticker) ? 'Remove from plan' : 'Add to plan'}">${plan.has(x.ticker) ? ICON.check : ICON.plus}</button></div>
        <p class="pl-why">${x.why}</p>
        <div class="pl-co-m"><span class="pl-ch">${CHANNEL[x.channel]}</span><span class="pl-conf" data-c="${x.confidence}" data-tip="${`${x.confidence} confidence`}">${[1, 2, 3].map(k => html`<i${k <= CONF_N[x.confidence] ? html` class="on"` : ''}></i>`)}</span><span class="pl-evd" title="${x.evidence}">${x.evidence}</span></div>
        ${chips.length ? html`<div class="pl-chips">${chips}</div>` : ''}
      </article>`;
    };
    const tone = STATUS_TONE[r.status];
    return html`<div class="pl-result">
      <div class="pl-flow" id="pl-flow">
        <svg class="pl-links" aria-hidden="true"></svg>
        <div class="pl-src" id="pl-src">
          <span class="pl-status" data-tone="${tone}">${STATUS[r.status]}</span>
          <h3>${r.headline}</h3>
          ${r.statusNote ? html`<p class="pl-note">${r.statusNote}</p>` : ''}
          <p class="pl-mech">${r.mechanism}</p>
          ${r.bills.length ? html`<div class="pl-bills"><span class="label">Bills relied on</span>${r.bills.map(b => html`<span class="pl-bid">${b}</span>`)}</div>` : ''}
          ${r.watch.length ? html`<div class="pl-watch"><span class="label">What would confirm or kill it</span><ul>${r.watch.map(w => html`<li>${w}</li>`)}</ul></div>` : ''}
          <p class="xs dim pl-asked">“${a.q}” · ${fmtDate(a.asOf)} ${fmtClock(a.at)}${a.tools ? ' · Claude searched bills and checked companies' : ''}</p>
        </div>
        <div class="pl-cols">
          <div class="pl-col" data-side="win"><h4><span class="pl-arrow">▲</span> Likely to gain <em>${r.winners.length}</em></h4>${r.winners.map((x, i) => card(x, 'win', i))}</div>
          ${r.losers.length ? html`<div class="pl-col" data-side="lose"><h4><span class="pl-arrow">▼</span> Likely to lose <em>${r.losers.length}</em></h4>${r.losers.map((x, i) => card(x, 'lose', i + r.winners.length))}</div>` : ''}
        </div>
      </div>
      <p class="xs dim pl-caveat">${r.caveat ? `${r.caveat} ` : ''}Claude’s reading of public data and industry structure: a research aid, not investment advice.</p>
    </div>`;
  }

  function drawLinks() {
    const flow = $('#pl-flow', el);
    if (!flow || el.hidden) return;
    const svg = $('.pl-links', flow), src = $('#pl-src', flow);
    const fr = flow.getBoundingClientRect();
    const sr = src.getBoundingClientRect();
    const wide = sr.right + 40 < $('.pl-cols', flow).getBoundingClientRect().left + 1;
    if (!wide) { svg.innerHTML = ''; return; }
    svg.setAttribute('width', fr.width);
    svg.setAttribute('height', fr.height);
    svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
    const x0 = sr.right - fr.left, y0 = sr.top - fr.top + Math.min(sr.height / 2, 90);
    const W = { high: 4.5, medium: 2.8, low: 1.5 };
    const paths = $$('.pl-co', flow).map((c, i) => {
      const r = c.getBoundingClientRect();
      const x1 = r.left - fr.left, y1 = r.top - fr.top + 26;
      const dx = Math.max(24, (x1 - x0) * 0.55);
      return `<path data-t="${c.dataset.t}" class="${c.dataset.side}" pathLength="1" style="--i:${i}" stroke-width="${W[c.dataset.conf] || 2}" d="M${x0.toFixed(1)},${y0.toFixed(1)} C${(x0 + dx).toFixed(1)},${y0.toFixed(1)} ${(x1 - dx).toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}"/>`;
    });
    svg.innerHTML = paths.join('') + `<circle class="hub" cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="5"/>`;
  }

  function hiLink(t) {
    const svg = $('.pl-links', el);
    if (!svg) return;
    svg.classList.toggle('focus', !!t);
    for (const p of svg.querySelectorAll('path')) p.classList.toggle('hi', p.dataset.t === t);
  }

  /* ---------- Where policy meets trading ---------- */

  function renderCross(st) {
    const host = $('#pl-cross', el);
    const p = st.policy;
    if (p.status === 'loading' && !p.feed.length) { mount(host, html`<div class="skel"></div><div class="skel"></div><div class="skel"></div>`); return; }
    if (p.status === 'error' && !p.feed.length) { mount(host, errorAlert(p.error)); return; }
    if (p.status === 'idle') { mount(host, html`<p class="small muted">${st.caps.mcp === 'off' ? 'Needs the Quiver Quant connector in the claude.ai viewer.' : 'Loads after the trading screen.'}</p>`); return; }
    const rows = crossReference({ feed: p.feed, awards: p.awards, signals: st.signals, congressRows: st.data?.congressRows || [], held: heldSet(), planned: planSet(st) }).slice(0, 12);
    if (!rows.length) { mount(host, html`<div class="empty"><h3>No overlap right now</h3><span>None of the ${fmtInt(p.feed.filter(x => x.tickers.length).length)} recent bills that name companies, or the ${fmtInt(contractLeaders(p.awards).length)} companies with large awards, show buying in your screen, depot or plan.</span></div>`); return; }
    mount(host, html`<ul class="pl-xs">${rows.map(x => html`<li class="pl-x">
      <div class="pl-x-id">${brand(x.ticker, { name: nameOf(x.ticker, x.signal?.company || x.contracts?.recipient), size: 28 })}</div>
      <div class="pl-x-b">
        <div class="pl-why-tags">${x.why.map(k => html`<span class="pl-chip ${k}" data-tip="${REASON[k][1]}">${k === 'congress' && x.signal?.congress.overseers ? '◆ Oversight buying' : REASON[k][0]}</span>`)}</div>
        ${policyLines({ bills: x.bills, contracts: x.contracts })}
        ${x.sponsorTrades.slice(0, 2).map(({ bill, trade }) => html`<p class="pl-spon"><b>${bill.sponsor}</b> introduced ${bill.billId} and ${trade.kind === 'buy' ? 'bought' : trade.kind === 'sell' ? 'sold' : 'traded'} ${x.ticker} (${trade.amount || 'amount n/a'}) on ${fmtDate(trade.traded, { year: false })}.</p>`)}
      </div>
      <div class="pl-x-s">${x.signal ? html`${tierChip(x.signal.tier)}<span class="mono small">${x.signal.score}</span>` : html`<span class="xs muted">no buying</span>`}</div>
    </li>`)}</ul>`);
  }

  /* ---------- Federal contracts ---------- */

  function renderAwards(st) {
    const host = $('#pl-awards', el);
    const p = st.policy;
    if (p.status === 'loading' && !p.awards.length) { mount(host, html`<div class="skel"></div><div class="skel"></div>`); return; }
    if (!p.awards.length) { mount(host, html`<p class="small muted">${p.status === 'done' ? `No awards of $10M or more in ${CONTRACT_DAYS} days.` : ''}</p>`); return; }
    const leaders = contractLeaders(p.awards).slice(0, 10);
    const max = leaders[0].usd;
    const agencies = [...new Set(leaders.map(l => l.agency))];
    const color = a => AGENCY_COLORS[Math.min(agencies.indexOf(a), AGENCY_COLORS.length - 1)];
    const sig = new Map(st.signals.map(s => [s.ticker, s]));
    const latest = p.awards.reduce((m, a) => (a.date > m ? a.date : m), '');
    const big = [...p.awards].filter(a => a.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 5);
    mount(host, html`
      <ul class="pl-bars">${leaders.map(l => { const s = sig.get(l.ticker); return html`<li>
        <span class="pl-bar-id">${brand(l.ticker, { name: nameOf(l.ticker, l.recipient), size: 20, sub: null })}</span>
        <span class="pl-bar"><i style="width:${Math.max(3, (100 * l.usd) / max).toFixed(1)}%;background:${color(l.agency)}" data-tip="${`${fmtUSD(l.usd)} · ${l.n} award${l.n > 1 ? 's' : ''}\n${[...l.agencies].map(([k, v]) => `${k}: ${fmtUSD(v)}`).join('\n')}\nLargest: ${l.top.desc.slice(0, 120)}`}"></i></span>
        <span class="pl-bar-v mono">${fmtUSD(l.usd)}</span>
        <span class="pl-bar-s">${s ? tierChip(s.tier) : ''}</span>
      </li>`; })}</ul>
      <div class="pl-legend">${agencies.slice(0, AGENCY_COLORS.length).map(a => html`<span><i style="background:${color(a)}"></i>${a}</span>`)}</div>
      <span class="label" style="margin-top:12px;display:block">Largest awards</span>
      <ul class="rows pl-big">${big.map(a => html`<li><div class="grow"><div class="t1">${nameOf(a.ticker, a.recipient)} <span class="mono xs muted">${a.ticker}</span></div><div class="t2" title="${a.desc}">${a.agency} · ${fmtDate(a.date, { year: false })} · ${a.desc.length > 90 ? a.desc.slice(0, 89) + '…' : a.desc}</div></div><span class="mono">${fmtUSD(a.usd)}</span>${a.url ? html`<a class="btn ghost sm icon" href="${a.url}" target="_blank" rel="noopener noreferrer" aria-label="Open on USAspending" data-tip="Open on USAspending">${ICON.open}</a>` : ''}</li>`)}</ul>
      <p class="xs dim" style="margin-top:8px">Latest award in the data: ${fmtDate(latest)}. USAspending posts awards with a lag of about two weeks; obligated dollars, not contract ceilings.</p>`);
  }

  /* ---------- New bills ---------- */

  function renderFeed(st) {
    const host = $('#pl-feed', el);
    const p = st.policy;
    if (p.status === 'loading' && !p.feed.length) { mount(host, html`<div class="skel"></div><div class="skel"></div><div class="skel"></div>`); return; }
    if (p.status === 'error' && !p.feed.length) { mount(host, errorAlert(p.error)); return; }
    const sig = new Map(st.signals.map(s => [s.ticker, s]));
    const held = heldSet(), plan = planSet(st);
    const mineT = t => sig.has(t) || held.has(t) || plan.has(t);
    const items = p.feed.filter(x => feedFilter === 'releases' ? x.kind === 'release'
      : x.kind === 'bill' && (feedFilter === 'all' || (feedFilter === 'named' ? x.tickers.length : x.tickers.some(mineT))));
    if (!items.length) { mount(host, html`<p class="small muted">${p.status === 'done' ? (feedFilter === 'mine' ? 'None of the newest bills name a company in your screen, depot or plan.' : 'Nothing in the latest feed.') : ''}</p>`); return; }
    const shownItems = feedMore ? items : items.slice(0, 12);
    const tk = t => { const s = sig.get(t); return html`<button type="button" class="pl-tk${held.has(t) ? ' own' : ''}${plan.has(t) ? ' plan' : ''}" data-open="${t}" data-tip="${`${nameOf(t)}${s ? `\nTier ${s.tier} · score ${s.score}` : '\nNo recent buying in the screen'}${held.has(t) ? '\nIn your depot' : ''}${plan.has(t) ? '\nIn your plan' : ''}`}">${s ? html`<i class="dot" data-t="${s.tier}"></i>` : ''}${t}</button>`; };
    mount(host, html`<div class="pl-feed">${shownItems.map(x => html`<article class="pl-bill${isNewSince(x, prevSeen) ? ' new' : ''}">
      <div class="pl-bill-h">${x.billId ? html`<span class="pl-bid">${x.billId}</span>` : html`<span class="pl-bid rel">Release</span>`}<b>${x.title}</b>${isNewSince(x, prevSeen) ? html`<span class="pl-new">New</span>` : ''}</div>
      <div class="pl-bill-m">${x.sponsor ? html`<button type="button" class="linkish" data-sponsor="${x.sponsor}" data-bio="${x.bioguide || ''}">${x.role === 'Senator' ? 'Sen.' : x.role ? 'Rep.' : ''} ${x.sponsor}</button>` : ''}<span>${x.received ? `introduced ${fmtDate(x.received, { year: false })}` : fmtDate(x.date, { year: false })}</span>${x.cosponsors != null ? html`<span>${x.cosponsors} cosponsor${x.cosponsors === 1 ? '' : 's'}</span>` : ''}${x.kind === 'bill' ? stageTrack({ step: 1, raw: 'Introduced' }) : ''}</div>
      <p class="pl-sum">${x.summary.length > 280 ? x.summary.slice(0, 279) + '…' : x.summary}</p>
      ${x.tickers.length ? html`<div class="pl-tks">${x.tickers.map(tk)}</div>` : ''}
      ${x.url ? html`<a class="xs pl-src-link" href="${x.url}" target="_blank" rel="noopener noreferrer">Quiver ↗</a>` : ''}
    </article>`)}</div>
    ${!feedMore && items.length > shownItems.length ? html`<button class="btn sm" type="button" id="pl-more" style="margin-top:10px">Show ${items.length - shownItems.length} more</button>` : ''}
    <p class="xs dim" style="margin-top:8px">Newest ${fmtInt(p.feed.length)} items from Quiver’s legislation feed. Tickers are Quiver’s AI tagging of companies a bill would affect; most bills never leave committee.</p>`);
  }

  /* ---------- Topic watch ---------- */

  const currentTopic = () => { const ts = pws().topics; return topicSel && ts.includes(topicSel) ? topicSel : ts[0] || null; };

  function renderTopics(st) {
    const host = $('#pl-topics', el);
    const topics = pws().topics;
    const cur = currentTopic();
    const data = cur ? st.policy.topics[cur.toLowerCase()] : null;
    if (cur && !data && st.caps.mcp === 'on') setTimeout(() => policy.topic(cur), 0);
    const sig = new Map(st.signals.map(s => [s.ticker, s]));
    const bills = data && data.bills ? data.bills.slice(0, 25) : [];
    mount(host, html`
      <div class="pl-topics-h">
        <div class="pl-topic-list" role="tablist" aria-label="Topics">${topics.map(t => html`<span class="pl-pill topic${t === cur ? ' on' : ''}"><button type="button" role="tab" aria-selected="${t === cur}" data-topic="${t}">${t}</button><button type="button" class="x" data-untopic="${t}" aria-label="${`Stop watching ${t}`}">×</button></span>`)}</div>
        <form id="pl-topic-form" class="pl-topic-form"><input id="pl-topic-in" type="text" maxlength="40" placeholder="Add a topic, e.g. diesel" aria-label="Add a topic"><button class="btn sm" type="submit">${ICON.plus} Watch</button></form>
      </div>
      ${!cur ? html`<p class="small muted">Add a word to follow bills whose title contains it.</p>`
        : !data || data.status === 'loading' ? html`<div class="skel"></div><div class="skel"></div>`
        : data.status === 'error' ? errorAlert(data.error)
        : !bills.length ? html`<p class="small muted">No bills with “${cur}” in the title.</p>`
        : html`<div class="table-wrap"><table class="grid pl-topic-t"><thead><tr><th>Bill</th><th>Stage</th><th>Latest</th><th>Companies</th></tr></thead><tbody>${bills.map(b => html`<tr>
            <td><span class="pl-bid">${b.id}</span> <span class="pl-tt" title="${b.summary}">${b.title.length > 110 ? b.title.slice(0, 109) + '…' : b.title}</span></td>
            <td>${stageTrack(b.stage)}</td>
            <td class="nowrap small">${b.date ? fmtDate(b.date) : '—'}</td>
            <td><span class="pl-tks">${b.tickers.length ? b.tickers.slice(0, 5).map(t => { const s = sig.get(t); return html`<button type="button" class="pl-tk" data-open="${t}" data-tip="${nameOf(t)}">${s ? html`<i class="dot" data-t="${s.tier}"></i>` : ''}${t}</button>`; }) : html`<span class="dim">—</span>`}</span></td>
          </tr>`)}</tbody></table></div>
          <p class="xs dim" style="margin-top:8px">${data.bills.length > bills.length ? `Newest ${bills.length} of ${data.bills.length} bills read. ` : ''}${data.complete === false ? 'Broad topic: Quiver returned more bills than one search reads, so a narrower word finds older or rarer ones. ' : ''}Sorted by latest action. Stage is the bill’s latest published text version.</p>`}`);
  }

  function renderAll(st) {
    if (!built) build();
    const p = st.policy;
    mount($('#pl-stamp', el), p.loadedAt ? html`Updated ${fmtClock(p.loadedAt)}` : p.status === 'loading' ? 'Loading…' : '');
    renderRecent();
    renderOut();
    renderCross(st);
    renderAwards(st);
    renderFeed(st);
    renderTopics(st);
  }

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || !built) { renderAll(st); return; }
      if (changed.some(k => ['policy', 'signals', 'workspace', 'portfolioLocalAt', 'caps', 'cloud'].includes(k))) {
        const p = st.policy;
        mount($('#pl-stamp', el), p.loadedAt ? html`Updated ${fmtClock(p.loadedAt)}` : p.status === 'loading' ? 'Loading…' : '');
        renderCross(st); renderAwards(st); renderFeed(st); renderTopics(st);
        if (changed.includes('workspace') && !(run && run.status === 'running')) { renderRecent(); renderOut(); }
      }
    },
    show() {
      const st = store.get();
      if (prevSeen == null) prevSeen = pws().seenAt || 0;
      if (st.policy.status === 'idle' && st.caps.mcp === 'on') policy.load();
      savePws({ seenAt: Date.now() });
      requestAnimationFrame(drawLinks);
    },
    onResize: drawLinks,
    /** Prefill and run from elsewhere (command palette). */
    trace(q) { if (!built) build(); $('#pl-q', el).value = q || ''; if (q) ask(q); else $('#pl-q', el).focus(); }
  };
}
