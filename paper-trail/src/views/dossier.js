import { html, mount, on, $, markdown } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip, flagsList, roleChip, partyChip, errorAlert } from '../ui/parts.js';
import { waterfall, timeline, columns, diverging, tri, priceChart } from '../ui/charts.js';
import { brandHead, nameOf } from '../ui/brand.js';
import { fmtUSD, fmtInt, fmtDate, fmtPct, isoDate, addDays, ts, groupBy, cleanCompany } from '../core/util.js';
import { cleanInsider, cleanCongress, ROLE_LABEL } from '../model/clean.js';
import { buildSignals } from '../model/score.js';
import { oversight, seatsOf } from '../core/committees.js';
import { trackLookup } from '../app/pipeline.js';
import { memoPrompt, sampleErrorCopy, streamInto } from '../ai/claude.js';
import { buyOf, buyChip, buyBlock, buyText } from '../ui/brokers.js';

const SECTIONS = ['congress', 'insider', 'contracts', 'lobbying', 'news', 'ownership'];
const TABS = [['overview', 'Overview'], ['insiders', 'Insider ledger'], ['congress', 'Congress ledger'], ['government', 'Government and owners'], ['news', 'News']];
const CODE_LABEL = { P: 'Open-market buy', S: 'Open-market sale', A: 'Award / grant', M: 'Option exercise', F: 'Tax withholding', D: 'Disposition to issuer', G: 'Gift', C: 'Conversion', X: 'Option exercise' };
const NEWS_CAT = { summary: 'Summary', press_release_summary: 'Press release', insiders_automated: 'Insider', lobbying_automated: 'Lobbying', congress_trades_automated: 'Congress trade', legislation_automated: 'Legislation', funds_automated: 'Funds', contracts_automated: 'Contract', earnings_automated: 'Earnings', prices_automated: 'Price move', strategies_update_automated: 'Strategy', forecasts_automated: 'Forecast', fundraising_automated: 'Fundraising', discussion_automated: 'Discussion' };

/**
 * Per-ticker dossier. Seven datasets load in parallel; each section renders
 * as its data lands and shows its own error. The score is recomputed from the
 * dossier's own two-year history with the same model as the Signals view, so
 * tickers outside the current screen still get a comparable score.
 */
export function createDossierView(ctx) {
  const { store, quiver } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-dossier';
  const cache = new Map();
  let cur = null;
  let tab = 'overview';
  let codeFilter = new Set(['P', 'S']);
  let memo = null;
  let seq = 0;
  let lastCloud = {};

  function emptyState() {
    const top = store.get().signals.slice(0, 8);
    mount(el, html`<div class="view-h"><div><h1>Dossier</h1><p>Everything Quiver has on one ticker: insider and congressional ledgers, federal awards, lobbying, off-exchange volume, ownership and news, with a memo from Claude.</p></div></div>
      <div class="panel"><div class="empty"><h3>Open a ticker</h3><span>Press <kbd>⌘K</kbd> and type a symbol, or open one from Signals.</span>
      ${top.length ? html`<div class="chips" style="margin-top:8px">${top.map(s => html`<button class="btn sm" type="button" data-open="${s.ticker}">${tierChip(s.tier)} ${nameOf(s.ticker, s.company)}</button>`)}</div>` : ''}</div></div>`);
  }

  async function load(ticker, { refresh = false } = {}) {
    const my = ++seq;
    const asOf = isoDate();
    const entry = { ticker, asOf, data: {}, err: {}, done: 0, loadedAt: Date.now() };
    cache.set(ticker, entry);
    cur = entry;
    memo = null;
    render();
    const y = new Date().getFullYear();
    const jobs = {
      congress: () => quiver.tickerCongress(ticker, { from: addDays(asOf, -730), refresh }).then(r => cleanCongress(r.rows).rows),
      insider: () => quiver.tickerInsider(ticker, { from: addDays(asOf, -730), to: asOf, refresh, maxPages: 4 }).then(r => ({ rows: cleanInsider(r.rows, { to: asOf }).rows, complete: r.complete })),
      contracts: () => quiver.contracts(ticker, { from: addDays(asOf, -365), to: asOf, refresh }).then(r => r.rows),
      lobbying: () => quiver.lobbying(ticker, { yearFrom: y - 2, refresh }).then(r => r.rows),
      news: () => quiver.news(ticker, { refresh }).then(r => r.rows),
      ownership: () => quiver.ownership(ticker, { refresh }).then(r => r.object || r.rows[0] || null)
    };
    if (ctx.cloud) ctx.cloud.prices(ticker).then(p => { entry.prices = p || null; entry.pricesDone = true; if (my === seq && cur === entry) render(); });
    await Promise.all(SECTIONS.map(async k => {
      try { entry.data[k] = await jobs[k](); } catch (e) { entry.err[k] = e || { code: 'upstream_error' }; }
      entry.done++;
      if (my === seq && cur === entry) render();
    }));
  }

  /* ---------- Derived ---------- */
  function derive(e) {
    const st = store.get();
    const W = st.windowDays;
    const from = addDays(e.asOf, -(W - 1));
    const ins = e.data.insider ? e.data.insider.rows : [];
    const cg = e.data.congress || [];
    const local = buildSignals({
      insiderBuys: ins.filter(r => r.transaction_type === 'P' && r.date >= from),
      congressRows: cg.filter(r => (r.filed || r.traded) >= from),
      convergence90: new Map([[e.ticker, cg.filter(r => r.kind === 'buy' && (r.filed || '') >= addDays(e.asOf, -89)).length]]),
      enrichment: st.enrichment,
      asOf: e.asOf, windowDays: W, model: st.model, oversight, track: trackLookup(st)
    })[0] || null;
    const screened = st.signals.find(s => s.ticker === e.ticker) || null;
    const contracts = (e.data.contracts || []).filter(c => +c.total_dollars_obligated > 0);
    const company = cleanCompany(screened?.company || cg.find(r => r.company)?.company || (contracts[0] && String(contracts[0].recipient || '').trim()) || '');
    const quarters = [...groupBy((e.data.lobbying || []).filter(r => r.year && /Q[1-4]/i.test(r.type || '')), r => `${r.year}-${String(r.type).match(/Q[1-4]/i)[0].toUpperCase()}`)]
      .map(([k, rows]) => ({ key: k, label: `${k.slice(5)} ’${k.slice(2, 4)}`, value: rows.reduce((s, r) => s + (+r.amount || 0), 0) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-8);
    const d90 = addDays(e.asOf, -89);
    const p90 = ins.filter(r => r.transaction_type === 'P' && r.date >= d90);
    const s90 = ins.filter(r => r.transaction_type === 'S' && r.date >= d90);
    return { local, screened, company, contracts, quarters, ins, cg, p90, s90, from };
  }

  /* ---------- Render ---------- */
  function render() {
    if (!cur) { emptyState(); return; }
    const e = cur;
    const x = derive(e);
    const s = x.screened || x.local;
    const st = store.get();
    const watched = st.workspace.watch.some(w => w.ticker === e.ticker);
    const counts = { insiders: x.ins.length, congress: x.cg.length, news: (e.data.news || []).length };
    const loading = e.done < SECTIONS.length;
    const awards = x.contracts.reduce((a, c) => a + +c.total_dollars_obligated, 0);
    const lob4 = x.quarters.slice(-4).reduce((a, q) => a + q.value, 0);

    mount(el, html`
      <div class="panel">
        <div class="dz-head">
          <div class="dz-id">${brandHead(e.ticker, { name: nameOf(e.ticker, x.company) })}${s ? tierChip(s.tier, true) : ''}${buyChip(buyOf(st)(e.ticker, x.company))}</div>
          <div class="dz-metrics">
            ${quoteMetric(e, st)}
            <div class="dz-metric"><span class="label">Score</span><b>${s ? s.score : '—'}</b><span class="xs muted">${x.screened ? `rank ${x.screened.rank} of ${fmtInt(st.signals.length)}` : 'not in current screen'}</span></div>
            <div class="dz-metric"><span class="label">Insider buys 90d</span><b>${fmtUSD(x.p90.reduce((a, r) => a + r.value, 0))}</b><span class="xs muted">sales ${fmtUSD(x.s90.reduce((a, r) => a + r.value, 0))}</span></div>
            <div class="dz-metric"><span class="label">Congress buys 2y</span><b>${fmtInt(x.cg.filter(r => r.kind === 'buy').length)}</b><span class="xs muted">${fmtInt(x.cg.filter(r => r.kind === 'sell').length)} sales</span></div>
            <div class="dz-metric"><span class="label">Federal awards 12m</span><b>${e.data.contracts ? fmtUSD(awards) : '—'}</b><span class="xs muted">${fmtInt(x.contracts.length)} actions</span></div>
            <div class="dz-metric"><span class="label">Lobbying 4Q</span><b>${e.data.lobbying ? fmtUSD(lob4) : '—'}</b><span class="xs muted">LDA filings</span></div>
          </div>
          <div class="dz-actions">
            <button class="btn ${watched ? 'on' : 'primary'}" type="button" data-watch="${e.ticker}">${watched ? html`${ICON.check} In plan` : html`${ICON.plus} Add to plan`}</button>
            <button class="btn ghost" type="button" id="dz-refresh">${ICON.refresh} Refresh</button>
          </div>
        </div>
        ${s && s.flags.length ? html`<div style="padding:0 16px 12px">${flagsList(s.flags)}</div>` : ''}
        <details class="dz-buy"><summary><span class="label">Where you can buy it</span> ${buyText(buyOf(st)(e.ticker, x.company))}</summary>${buyBlock(buyOf(st)(e.ticker, x.company), { name: nameOf(e.ticker, x.company) })}</details>
        <div class="subtabs" role="tablist">${TABS.map(([k, label]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${label}${counts[k] != null ? html`<span class="n">${fmtInt(counts[k])}</span>` : ''}</button>`)}</div>
      </div>
      <div class="dz-grid" id="dz-body">${body(e, x, s)}</div>`);
    drawCharts(e, x);
  }

  function section(span, title, src, inner, id = '') {
    return html`<section class="panel span-${span}" ${id ? html`id="${id}"` : ''}><div class="panel-h"><h2>${title}</h2><span class="src">${src}</span></div><div class="panel-b">${inner}</div></section>`;
  }
  const pending = k => !(k in cur.data) && !(k in cur.err);
  const sk = (n = 3) => html`${Array.from({ length: n }, (_, i) => html`<div class="skel" style="width:${[90, 70, 80][i % 3]}%"></div>`)}`;
  const guard = (k, fn) => (cur.err[k] ? errorAlert(cur.err[k]) : pending(k) ? sk() : fn());

  function body(e, x, s) {
    if (tab === 'overview') {
      return html`
        ${section(12, 'Price, 1 year', e.prices ? `Yahoo Finance · closes to ${fmtDate(e.prices.t.at(-1))}` : 'Yahoo Finance', priceBlock(e, x))}
        ${section(12, 'Activity, last 12 months', 'trades · Form 4 · USAspending', html`<div class="legend"><span>${tri('buy')} Buy</span><span>${tri('sell')} Sell</span><span><span class="sw" data-g="cross" style="width:3px;height:12px"></span> Federal award (taller = larger)</span><span class="dim">Congress on trade date · hover for detail</span></div><div class="chart" id="dz-tl">${pending('insider') && pending('congress') ? sk(4) : ''}</div>`)}
        ${section(5, 'Score breakdown', `model ${store.get().model.preset}`, s ? html`${waterfall(s)}<p class="xs muted">${x.screened ? 'From the Signals screen' : `Computed from this dossier for the last ${store.get().windowDays} days`}.</p>` : (pending('insider') ? sk(6) : html`<p class="small muted">No insider or congressional buying in the window, so there is nothing to score.</p>`))}
        ${section(7, 'Analyst memo', 'Claude · from this dossier', memoBlock(), 'dz-memo')}
        ${section(6, 'Insider flow, 12 months', 'Form 4 P and S, net by month', guard('insider', () => x.ins.length ? html`<div class="chart" id="dz-flow"></div>` : html`<p class="small muted">No Form 4 filings in two years.</p>`))}
        ${section(6, 'Who is buying', `last ${store.get().windowDays} days`, guard('insider', () => whoBlock(s)))}`;
    }
    if (tab === 'insiders') return section(12, 'Insider ledger', 'SEC Form 4, last 2 years', guard('insider', () => insiderLedger(x)));
    if (tab === 'congress') return section(12, 'Congress ledger', 'House and Senate PTRs, last 2 years', guard('congress', () => congressLedger(x)));
    if (tab === 'government') {
      return html`${section(7, 'Federal contracts, 12 months', 'USAspending', guard('contracts', () => contractsBlock(x)))}
        ${section(5, 'Lobbying by quarter', 'LDA filings', guard('lobbying', () => x.quarters.length ? html`<div class="chart" id="dz-lob"></div>${lobbyIssues()}` : html`<p class="small muted">No lobbying reported since ${new Date().getFullYear() - 2}.</p>`))}
        ${section(12, 'Ownership', 'Form 4 sentiment · 13F', guard('ownership', () => ownershipBlock()))}`;
    }
    return section(12, 'Quiver newsfeed', 'latest', guard('news', () => newsBlock()));
  }

  function quoteMetric(e, st) {
    const q = st.cloud?.quotes?.q?.[e.ticker];
    const p = e.prices;
    const last = p?.last ?? q?.[0];
    if (!last) return '';
    const chg = p && p.c.length > 1 ? (p.c.at(-1) / p.c.at(-2) - 1) * 100 : q?.[1];
    return html`<div class="dz-metric"><span class="label">Last price</span><b>$${last < 10 ? last.toFixed(3) : last.toFixed(2)}</b><span class="xs ${chg >= 0 ? 'chg-up' : 'chg-down'}">${chg == null ? '' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% day`}${p && p.hi52 ? html` <span class="muted">· 52w ${p.lo52.toFixed(2)}–${p.hi52.toFixed(2)}</span>` : ''}</span></div>`;
  }
  function priceBlock(e, x) {
    if (!ctx.cloud || !ctx.cloud.ready) return html`<p class="small muted">Price history comes from the daily job and needs the claude.ai viewer.</p>`;
    if (!e.pricesDone) return sk(3);
    if (!e.prices) return html`<p class="small muted">No Yahoo price history stored for ${e.ticker} yet. The daily job fetches prices for every signal in the top 150, your holdings and your watchlist; press <b>Run now</b> on the Briefing to fetch it sooner.</p>`;
    const p = e.prices;
    const from = p.t[0];
    const buys = x.ins.filter(r => r.transaction_type === 'P' && r.date >= from);
    const usd = buys.reduce((a, r) => a + r.value, 0);
    const sh = buys.reduce((a, r) => a + r.shares, 0);
    const raw = sh ? usd / sh : null;
    const avg = raw && p.c.at(-1) / raw < 5 && p.c.at(-1) / raw > 0.2 ? raw : null;
    const vs = avg ? (p.c.at(-1) / avg - 1) * 100 : null;
    const ret = (p.c.at(-1) / p.c[0] - 1) * 100;
    return html`<div class="legend"><span>${tri('buy')} Insider or member buy</span><span>${tri('sell')} Sale</span>${avg ? html`<span><span class="sw" data-g="insider" style="height:2px"></span> Insiders' average buy price</span>` : ''}<span class="grow"></span><span class="mono xs">1y <b class="${ret >= 0 ? 'chg-up' : 'chg-down'}">${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%</b>${vs != null ? html` · vs insiders <b class="${vs >= 0 ? 'chg-up' : 'chg-down'}">${vs >= 0 ? '+' : ''}${vs.toFixed(1)}%</b>` : ''}</span></div><div class="chart" id="dz-px"></div>`;
  }

  function whoBlock(s) {
    if (!s) return html`<p class="small muted">No buying in the window.</p>`;
    return html`${s.insider.buyers.length ? html`<ul class="rows">${s.insider.buyers.slice(0, 8).map(b => html`<li>${roleChip(b.role)}<div class="grow"><div class="t1">${b.name}</div><div class="t2">${b.title || ROLE_LABEL[b.role]} · ${b.tx} buy${b.tx > 1 ? 's' : ''} · avg $${b.avgPrice.toFixed(2)}${b.stakePct != null ? ` · stake +${fmtPct(Math.min(b.stakePct, 999))}` : b.newPosition ? ' · new position' : ''}</div></div><span class="mono">${fmtUSD(b.usd)}</span></li>`)}</ul>` : ''}
      ${s.congress.members.length ? html`<ul class="rows">${s.congress.members.map(m => html`<li>${partyChip(m.party)}<div class="grow"><button class="linkish t1" type="button" data-member="${m.name}">${m.name}</button><div class="t2">${m.oversees ? html`<span class="ovs-sub" data-tip="${`Oversees ${m.oversees.themeLabel}`}">◆ ${m.oversees.committee}</span> · ` : ''}${m.chamber} · ${m.ranges.join(', ')}</div></div><span class="mono">${m.washOnly ? '0' : fmtUSD(m.usd)}</span></li>`)}</ul>` : ''}
      ${!s.insider.buyers.length && !s.congress.members.length ? html`<p class="small muted">No buyers in the window.</p>` : ''}`;
  }

  function insiderLedger(x) {
    const codes = [...groupBy(x.ins, r => r.transaction_type)].map(([c, rows]) => [c, rows.length]).sort((a, b) => b[1] - a[1]);
    const rows = x.ins.filter(r => codeFilter.has(r.transaction_type)).slice(0, 400);
    const partial = cur.data.insider && cur.data.insider.complete === false;
    return html`<div class="chips">${codes.map(([c, n]) => html`<button class="btn sm ${codeFilter.has(c) ? 'on' : ''}" type="button" data-code="${c}" data-tip="${CODE_LABEL[c] || 'Other'}">${c} · ${fmtInt(n)}</button>`)}</div>
      ${partial ? html`<div class="alert" data-tone="warn"><div>This ticker has more Form 4 lines than one dossier pull reads; the oldest are not shown.</div></div>` : ''}
      <div class="table-wrap" style="max-height:620px"><table class="grid"><thead><tr><th>Date</th><th>Insider</th><th>Role</th><th>Code</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th class="num">Owned after</th><th class="num">Filed after</th></tr></thead><tbody>
      ${rows.map(r => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td><div class="two"><span>${r.owner}</span><span class="sub">${r.officer_title || ''}</span></div></td><td>${roleChip(r.role)}</td><td><span class="side" data-tip="${CODE_LABEL[r.transaction_type] || r.transaction_type}">${r.transaction_type === 'P' ? tri('buy', 4) : r.transaction_type === 'S' ? tri('sell', 4) : ''}${r.transaction_type}</span></td><td class="num">${fmtInt(r.shares)}</td><td class="num">$${r.price.toFixed(2)}</td><td class="num">${fmtUSD(r.value)}</td><td class="num">${Number.isFinite(+r.shares_owned_after) ? fmtInt(r.shares_owned_after) : '—'}</td><td class="num ${r.lateDays > 4 ? 'status-err' : ''}">${r.lateDays == null ? '—' : r.lateDays + 'd'}</td></tr>`)}
      </tbody></table></div>${!rows.length ? html`<p class="small muted">No filings with the selected codes.</p>` : ''}`;
  }

  function congressLedger(x) {
    if (!x.cg.length) return html`<p class="small muted">No congressional trades in two years.</p>`;
    return html`<div class="table-wrap" style="max-height:620px"><table class="grid"><thead><tr><th>Member</th><th>Trade</th><th>Amount</th><th>Traded</th><th>Filed</th><th class="num">Days to file</th><th>Owner</th></tr></thead><tbody>
      ${x.cg.map(r => { const o = oversight(cur.ticker, r.bioguide_id); return html`<tr><td><span class="cell-row">${partyChip(r.party)}<div class="two"><button class="linkish" type="button" data-member="${r.representative}">${r.representative}</button>${o ? html`<span class="sub ovs-sub" data-tip="${`${o.committee} oversees ${o.themeLabel}`}">◆ ${o.committee}${o.role ? ` · ${o.role === 'chair' ? 'chair' : 'ranking member'}` : ''}</span>` : ''}</div></span></td><td><span class="side">${r.kind === 'buy' ? tri('buy', 4) : r.kind === 'sell' ? tri('sell', 4) : ''}${r.transaction}${r.wash ? html` <span class="flag" data-tone="warn" data-tip="Bought and sold the same day; nets to zero">offset</span>` : ''}</span></td><td class="mono small nowrap">${r.amount}</td><td class="nowrap">${fmtDate(r.traded)}</td><td class="nowrap">${fmtDate(r.filed)}</td><td class="num ${r.lagDays > 45 ? 'status-err' : ''}" ${r.lagDays > 45 ? html`data-tip="Past the 45-day STOCK Act deadline"` : ''}>${r.lagDays ?? '—'}</td><td class="small muted">${r.owner || '—'}</td></tr>`; })}
      </tbody></table></div>`;
  }

  function contractsBlock(x) {
    if (!x.contracts.length) return html`<p class="small muted">No federal awards tagged to this ticker in 12 months.</p>`;
    const byAgency = [...groupBy(x.contracts, c => c.funding_agency_name || 'Unknown agency')].map(([a, rows]) => [a, rows.reduce((s, c) => s + +c.total_dollars_obligated, 0), rows.length]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const top = [...x.contracts].sort((a, b) => b.total_dollars_obligated - a.total_dollars_obligated).slice(0, 8);
    return html`<dl class="kv">${byAgency.map(([a, v, n]) => html`<dt>${a} <span class="dim">· ${n}</span></dt><dd>${fmtUSD(v)}</dd>`)}</dl>
      <ul class="rows">${top.map(c => html`<li><div class="grow"><div class="t1">${c.award_description || 'Award'}</div><div class="t2">${c.funding_agency_name || ''} · ${fmtDate(c.action_date)}${c.usaspending_permalink ? html` · <a href="${c.usaspending_permalink}" target="_blank" rel="noopener">USAspending</a>` : ''}</div></div><span class="mono">${fmtUSD(+c.total_dollars_obligated)}</span></li>`)}</ul>`;
  }
  function lobbyIssues() {
    const latest = (cur.data.lobbying || [])[0];
    const issues = latest && latest.issue ? String(latest.issue).split(/\s*\n\s*/).filter(Boolean).slice(0, 8) : [];
    return issues.length ? html`<p class="small"><span class="muted">Latest filing covers:</span> ${issues.join(', ')}</p>` : '';
  }
  function ownershipBlock() {
    const o = cur.data.ownership || {};
    const sent = (o.insider_sentiment_by_quarter || []).filter(q => q && q.quarter).slice(-8);
    const inst = o.institutional_summary;
    const owners = (o.top_owners || []).slice(0, 6);
    return html`${sent.length ? html`<span class="label">Insider sentiment by quarter</span><div class="chart" id="dz-sent"></div>` : ''}
      ${inst ? html`<dl class="kv"><dt>13F filers</dt><dd>${fmtInt(inst.total)}</dd><dt>New positions</dt><dd>${fmtInt(inst.new)}</dd><dt>Added</dt><dd>${fmtInt(inst.increased)}</dd><dt>Held</dt><dd>${fmtInt(inst.held)}</dd><dt>Cut</dt><dd>${fmtInt(inst.decreased)}</dd><dt>Exited</dt><dd>${fmtInt(inst.closed)}</dd></dl>` : ''}
      ${owners.length ? html`<ul class="rows">${owners.map(w => html`<li><div class="grow"><div class="t1">${w.owner_name}</div><div class="t2">as of ${fmtDate(w.date)}</div></div><span class="mono small">${fmtInt(w.shares)} sh</span></li>`)}</ul>` : ''}
      ${!sent.length && !inst && !owners.length ? html`<p class="small muted">No ownership data.</p>` : ''}`;
  }
  function newsBlock() {
    const rows = (cur.data.news || []).slice(0, 10);
    if (!rows.length) return html`<p class="small muted">No recent Quiver news for this ticker.</p>`;
    return html`<ul class="rows">${rows.map(n => html`<li><div class="grow"><div class="t1">${n.url ? html`<a href="${n.url}" target="_blank" rel="noopener">${n.headline}</a>` : n.headline}</div><div class="t2"><span class="label">${NEWS_CAT[n.category] || n.category || 'News'}</span> · ${fmtDate(n.datetime)}</div></div></li>`)}</ul>`;
  }

  /* ---------- Memo ---------- */
  function memoBlock() {
    const ready = !pending('insider') && !pending('congress');
    const can = !!ctx.caps.sample;
    const m = memo && memo.ticker === cur.ticker ? memo : null;
    return html`<div class="ins-actions"><button class="btn ${m && m.text ? '' : 'primary'} sm" type="button" id="memo-go" ${!ready || !can || (m && m.busy) ? 'disabled' : ''}>${ICON.spark} ${m && m.text ? 'Rewrite memo' : 'Write memo'}</button>${m && m.busy ? html`<button class="btn sm" type="button" id="memo-stop">Stop</button>` : ''}<span class="xs muted">${!can ? 'Needs permission to use Claude on claude.ai.' : m && m.note ? m.note : 'Claude reads this dossier and writes a short memo. Uses your Claude usage.'}</span></div>
      <div class="md" id="memo-out">${m && m.text ? markdown(m.text) : m && m.busy ? html`<p class="thinking">Thinking… usually 20–60 seconds.</p>` : ''}</div>`;
  }
  function memoContext() {
    const x = derive(cur);
    const s = x.screened || x.local;
    const o = cur.data.ownership || {};
    const avg = a => (a.length ? +(a.reduce((t, r) => t + +r.dpi, 0) / a.length).toFixed(3) : null);
    return {
      ticker: cur.ticker, company: x.company, as_of: cur.asOf, window_days: store.get().windowDays,
      score: s ? s.score : null, tier: s ? s.tier : null,
      factor_points: s ? Object.fromEntries(s.factors.map(f => [f.key, Math.round(f.contrib * 10) / 10])) : null,
      adjustments: s ? s.notes.map(n => `${n.label} ×${n.mult.toFixed(2)}`) : [],
      flags: s ? s.flags.map(f => f.label) : [],
      insider_trades_recent: x.ins.filter(r => r.transaction_type === 'P' || r.transaction_type === 'S').slice(0, 25).map(r => ({ name: r.owner, role: ROLE_LABEL[r.role], title: r.officer_title || undefined, code: r.transaction_type, shares: r.shares, price: r.price, usd: Math.round(r.value), date: r.date, filed_days_later: r.lateDays, owned_after: r.shares_owned_after })),
      insider_90d: { buy_usd: Math.round(x.p90.reduce((a, r) => a + r.value, 0)), sell_usd: Math.round(x.s90.reduce((a, r) => a + r.value, 0)) },
      congress_trades_recent: x.cg.slice(0, 20).map(r => { const o = oversight(cur.ticker, r.bioguide_id); return { member: r.representative, party: r.party, chamber: r.chamber, type: r.transaction, amount: r.amount, traded: r.traded, filed: r.filed, same_day_offset: r.wash || undefined, committee_oversight: o ? `${o.committee}${o.role ? ` (${o.role})` : ''} oversees ${o.themeLabel}` : undefined }; }),
      buyable_for_investor: buyText(buyOf(store.get())(cur.ticker, x.company)),
      federal_awards_12mo: cur.err.contracts ? 'unavailable' : { total_usd: Math.round(x.contracts.reduce((a, c) => a + +c.total_dollars_obligated, 0)), count: x.contracts.length, largest: [...x.contracts].sort((a, b) => b.total_dollars_obligated - a.total_dollars_obligated).slice(0, 4).map(c => ({ usd: Math.round(c.total_dollars_obligated), agency: c.funding_agency_name, what: c.award_description, date: String(c.action_date).slice(0, 10) })) },
      lobbying_by_quarter: x.quarters.map(q => ({ quarter: q.key, usd: q.value })),
      insider_sentiment_by_quarter: (o.insider_sentiment_by_quarter || []).map(q => ({ quarter: q.quarter, value: q.sentiment })),
      institutional_13f: o.institutional_summary || 'unavailable',
      news: (cur.data.news || []).slice(0, 6).map(n => ({ date: String(n.datetime || '').slice(0, 10), type: NEWS_CAT[n.category] || n.category, headline: n.headline }))
    };
  }
  function startMemo() {
    if (!ctx.caps.sample || !cur) return;
    const ticker = cur.ticker;
    const rewrite = !!(memo && memo.ticker === ticker && memo.text);
    memo = { ticker, busy: true, text: '', note: 'Claude is reading the dossier…' };
    renderMemo();
    memo.ctl = streamInto(ctx.caps.sample, memoPrompt(memoContext()), {
      cache: rewrite ? { gcTime: 3600000, refresh: true } : { gcTime: 3600000 },
      render: text => { if (memo && memo.ticker === ticker) { memo.text = text; paintMemoText(); } },
      onDone: r => { if (memo && memo.ticker === ticker) { memo.busy = false; memo.note = r.truncated ? 'Cut short by the length limit.' : `Written ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} from this dossier.`; renderMemo(); } },
      onError: e => { if (memo && memo.ticker === ticker) { memo.busy = false; if (e && e.code === 'refused') memo.text = ''; else memo.text = (e && e.text) || memo.text; memo.note = sampleErrorCopy(e); renderMemo(); } }
    });
  }
  function paintMemoText() { const out = $('#memo-out', el); if (out) mount(out, markdown(memo.text)); }
  function renderMemo() { const host = $('#dz-memo .panel-b', el); if (host) mount(host, memoBlock()); }

  /* ---------- Charts ---------- */
  function drawCharts(e, x) {
    const px = $('#dz-px', el);
    if (px && e.prices) {
      const p = e.prices;
      const markers = [];
      for (const r of x.ins) {
        if (r.transaction_type !== 'P' && r.transaction_type !== 'S') continue;
        markers.push({ date: r.date, kind: r.transaction_type === 'P' ? 'buy' : 'sell', tip: `${r.owner} · ${r.officer_title || ROLE_LABEL[r.role]}\n${r.transaction_type === 'P' ? 'Bought' : 'Sold'} ${fmtInt(r.shares)} sh at $${r.price.toFixed(2)} = ${fmtUSD(r.value)}\n${fmtDate(r.date)}` });
      }
      for (const r of x.cg) {
        if (r.kind !== 'buy' && r.kind !== 'sell') continue;
        markers.push({ date: r.traded, kind: r.kind, tip: `${r.representative} (${[r.party, r.chamber].filter(Boolean).join(', ')})\n${r.transaction} · ${r.amount}\nTraded ${fmtDate(r.traded)}` });
      }
      const buys = x.ins.filter(r => r.transaction_type === 'P' && r.date >= p.t[0]);
      const sh = buys.reduce((a, r) => a + r.shares, 0);
      const raw = sh ? buys.reduce((a, r) => a + r.value, 0) / sh : null;
      const avg = raw && p.c.at(-1) / raw < 5 && p.c.at(-1) / raw > 0.2 ? raw : null;
      priceChart(px, { t: p.t, c: p.c, markers, ref: avg ? { value: avg, label: `ins $${avg.toFixed(2)}` } : null });
    }
    const tl = $('#dz-tl', el);
    if (tl && !(pending('insider') && pending('congress'))) {
      const from = addDays(e.asOf, -364);
      const events = [];
      for (const r of x.cg) {
        if (r.kind === 'other' || (r.traded || '') < from) continue;
        events.push({ lane: 0, date: r.traded, kind: r.kind, usd: r.mid, tip: `${r.representative} (${[r.party, r.chamber].filter(Boolean).join(', ')})\n${r.transaction} · ${r.amount}\nTraded ${fmtDate(r.traded)}${r.lagDays != null ? ` · filed ${r.lagDays} days later` : ''}` });
      }
      for (const r of x.ins) {
        if ((r.transaction_type !== 'P' && r.transaction_type !== 'S') || r.date < from) continue;
        events.push({ lane: 1, date: r.date, kind: r.transaction_type === 'P' ? 'buy' : 'sell', usd: r.value, tip: `${r.owner} · ${r.officer_title || ROLE_LABEL[r.role]}\n${r.transaction_type === 'P' ? 'Bought' : 'Sold'} ${fmtInt(r.shares)} sh at $${r.price.toFixed(2)} = ${fmtUSD(r.value)}\n${fmtDate(r.date)}` });
      }
      for (const c of [...x.contracts].sort((a, b) => b.total_dollars_obligated - a.total_dollars_obligated).slice(0, 160)) {
        events.push({ lane: 2, date: String(c.action_date).slice(0, 10), kind: 'award', usd: +c.total_dollars_obligated, tip: `${fmtUSD(+c.total_dollars_obligated)} · ${c.funding_agency_name || 'Federal award'}\n${c.award_description || ''}\n${fmtDate(c.action_date)}` });
      }
      timeline(tl, { events, from, to: e.asOf, lanes: ['Congress', 'Insiders', 'Awards'] });
    }
    const flow = $('#dz-flow', el);
    if (flow) {
      const months = [];
      const d = new Date(ts(e.asOf));
      for (let i = 11; i >= 0; i--) { const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(m.toISOString().slice(0, 7)); }
      const net = new Map(months.map(m => [m, 0]));
      for (const r of x.ins) { const m = r.date.slice(0, 7); if (net.has(m) && (r.transaction_type === 'P' || r.transaction_type === 'S')) net.set(m, net.get(m) + (r.transaction_type === 'P' ? r.value : -r.value)); }
      diverging(flow, months.map(m => ({ label: new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), value: net.get(m) })), { format: v => fmtUSD(Math.abs(v)), label: 'Net insider dollars by month' });
    }
    const lob = $('#dz-lob', el);
    if (lob) columns(lob, x.quarters, { label: 'Lobbying spend by quarter' });
    const sent = $('#dz-sent', el);
    if (sent) diverging(sent, (cur.data.ownership.insider_sentiment_by_quarter || []).filter(q => q && q.quarter).slice(-8).map(q => ({ label: String(q.quarter).replace(/^(\d{2})(\d{2})/, '’$2 '), value: +q.sentiment || 0 })), { label: 'Insider sentiment' });
  }

  /* ---------- Events ---------- */
  on(el, 'click', '[data-tab]', (_, b) => { tab = b.dataset.tab; render(); });
  on(el, 'click', '[data-code]', (_, b) => { const c = b.dataset.code; codeFilter.has(c) ? codeFilter.delete(c) : codeFilter.add(c); render(); });
  on(el, 'click', '#dz-refresh', () => cur && load(cur.ticker, { refresh: true }));
  on(el, 'click', '#memo-go', () => startMemo());
  on(el, 'click', '#memo-stop', () => memo && memo.ctl && memo.ctl.stop());

  return {
    el,
    open(ticker) {
      if (!ticker) { if (!cur) emptyState(); return; }
      tab = 'overview';
      codeFilter = new Set(['P', 'S']);
      const hit = cache.get(ticker);
      if (hit && Date.now() - hit.loadedAt < 10 * 60e3 && hit.asOf === isoDate()) { cur = hit; memo = null; render(); }
      else load(ticker);
    },
    current: () => cur && cur.ticker,
    render(st, changed) {
      if (!cur || el.hidden) { if (!cur && !el.hidden && changed && changed.includes('signals')) emptyState(); return; }
      if (changed && changed.some(k => ['signals', 'workspace', 'model', 'windowDays'].includes(k)) && !(memo && memo.busy)) render();
      else if (changed && changed.includes('cloud') && !(memo && memo.busy)) {
        const c = st.cloud || {};
        if (c.logoCount !== lastCloud.logos || c.quotes !== lastCloud.quotes) { lastCloud = { logos: c.logoCount, quotes: c.quotes }; render(); }
      }
    },
    onResize() { if (cur && !el.hidden) drawCharts(cur, derive(cur)); }
  };
}
