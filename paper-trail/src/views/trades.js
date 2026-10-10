import { html, mount, on, $, markdown } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { kpi } from '../ui/parts.js';
import { logo } from '../ui/brand.js';
import { fmtEUR, fmtSignedPct, fmtDate, fmtInt } from '../core/util.js';
import { shortInstrument } from '../model/instruments.js';
import { coachPrompt, sampleErrorCopy, streamInto } from '../ai/claude.js';

const TONES = [
  ['good', 'What you did well'],
  ['bad', 'What cost you'],
  ['watch', 'Keep an eye on']
];

/**
 * Trade review: behavioural findings measured from the imported
 * transactions, each with its evidence, plus an optional coaching note from
 * Claude that prioritises them.
 */
export function createTradesView(ctx) {
  const { store, portfolio } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-trades';
  let coach = null;
  let tab = 'trips';
  let lastKey = null;

  mount(el, html`
    <div class="view-h">
      <div><h1>Trade review</h1><p>What your own transactions say about how you invest. Every point is measured from the trades behind it; open a card to see them.</p></div>
      <div class="tools">
        <button class="btn" type="button" id="t-import">${ICON.plus} Add transactions</button>
        <button class="btn primary" type="button" id="t-coach">${ICON.spark} Coach me</button>
      </div>
    </div>
    <div class="kpis" id="t-kpis"></div>
    <div id="t-cov"></div>
    <section class="panel" id="t-coach-panel" hidden><div class="panel-h"><h2>Coach</h2><span class="src">Claude · from the findings below</span><span class="grow"></span><span class="xs muted" id="t-coach-note"></span></div><div class="panel-b"><div class="md" id="t-coach-out"></div></div></section>
    <div class="find-grid" id="t-find"></div>
    <section class="panel">
      <div class="panel-h"><h2>Ledger analysis</h2><span class="grow"></span></div>
      <div class="subtabs" role="tablist" id="t-tabs"></div>
      <div class="table-wrap" id="t-table" style="max-height:560px"></div>
    </section>`);

  const instName = n => shortInstrument(n);
  const instLogo = (d, name, size = 18) => {
    const r = d.resolve(name);
    const fund = r.kind === 'etf' || r.kind === 'etc';
    return logo(fund ? '' : r.logo || r.ticker || '', instName(name), size);
  };

  function render() {
    const d = portfolio.derived();
    if (!d || !(d.transactions || []).length) {
      mount($('#t-kpis', el), '');
      mount($('#t-cov', el), '');
      mount($('#t-find', el), html`<div class="panel" style="grid-column:1/-1"><div class="empty"><h3>No transactions yet</h3><span>Import your Finanzfluss Buchungen pages from <b>Holdings → Import</b> or <b>Add transactions</b> above. The more history you paste, the sharper the review.</span></div></div>`);
      mount($('#t-table', el), '');
      mount($('#t-tabs', el), '');
      $('#t-coach', el).disabled = true;
      return;
    }
    const r = d.review;
    const st = r.stats;
    const s = d.summary || {};
    $('#t-coach', el).disabled = !ctx.caps.sample;
    $('#t-coach', el).setAttribute('data-tip', ctx.caps.sample ? 'Claude prioritises the findings into a short coaching note' : 'Needs permission to use Claude on claude.ai');
    const monthly = r.plans.reduce((a, p) => a + p.amount, 0);
    mount($('#t-kpis', el), html`
      ${kpi('Period reviewed', `${Math.round(st.months * 10) / 10} months`, `${fmtDate(st.from, { year: false })} – ${fmtDate(st.to)}`)}
      ${kpi('Trades', fmtInt(st.buys + st.sells), `${fmtInt(st.buys)} buys · ${fmtInt(st.sells)} sells · ${fmtInt(st.dividends)} dividends`)}
      ${kpi('Savings plans', fmtEUR(monthly), `${r.plans.length} plans · ${fmtInt(st.planBuys)} plan buys`)}
      ${kpi('Discretionary', `${st.discretionaryPerMonth.toFixed(0)} / month`, `${fmtInt(st.discretionaryBuys)} buys and ${fmtInt(st.sells)} sells by hand`)}
      ${kpi('Tax withheld', fmtEUR(st.taxes), `≈ ${fmtEUR(st.estRealizedGain)} realised gains`)}
      ${kpi('Realised, all time', s.realizedNet != null ? fmtEUR(s.realizedNet, { sign: true }) : '—', s.realized != null ? `${fmtEUR(s.realized)} gross` : 'paste the dashboard for this')}`);
    const total = s.txTotal || (s.counts ? (s.counts.buys || 0) + (s.counts.sells || 0) + (s.counts.dividends || 0) : null);
    const have = d.transactions.length;
    mount($('#t-cov', el), total && have < total * 0.9
      ? html`<div class="alert" data-tone="info"><div><b>Reviewing ${fmtInt(have)} of ${fmtInt(total)} transactions</b><span>Finanzfluss shows 100 per page. Paste more Buchungen pages, older ones too, with “Add transactions” to extend the review; duplicates are skipped.</span></div></div>`
      : '');
    mount($('#t-find', el), html`${TONES.map(([tone, label]) => {
      const list = r.findings.filter(f => f.tone === tone);
      return html`<div class="find-col"><span class="label">${label} · ${list.length}</span>${list.length ? list.map(f => card(d, f)) : html`<div class="panel"><div class="panel-b"><p class="small muted">Nothing here for this period.</p></div></div>`}</div>`;
    })}`);
    tabs(d);
  }

  function card(d, f) {
    const imp = f.impact == null ? '' : html`<span class="impact ${f.impact >= 0 ? 'pos' : 'neg'}">${fmtEUR(f.impact, { sign: true })}</span>`;
    return html`<section class="panel finding" data-tone="${f.tone}"><div class="panel-b" style="gap:8px">
      <div style="display:flex;gap:10px;align-items:flex-start"><h3>${f.title}</h3>${imp}</div>
      <p>${f.detail}</p>
      ${f.items.length ? html`<details><summary>${f.items.length} trade${f.items.length > 1 ? 's' : ''} behind this</summary><ul class="rows">${f.items.slice(0, 30).map(i => html`<li>${instLogo(d, i.label)}<div class="grow" style="min-width:0"><div class="t1">${instName(i.label)}</div><div class="t2">${i.sub}</div></div><span class="mono small">${i.value}</span></li>`)}</ul></details>` : ''}
    </div></section>`;
  }

  const TABS = [
    ['trips', 'Round trips', d => d.review.roundTrips.length],
    ['whips', 'Sold and re-bought', d => d.review.whipsaws.length],
    ['after', 'After the sale', d => d.review.afterSale.length],
    ['plans', 'Savings plans', d => d.review.plans.length],
    ['all', 'All transactions', d => d.transactions.length]
  ];
  function tabs(d) {
    mount($('#t-tabs', el), html`${TABS.map(([k, label, n]) => html`<button type="button" role="tab" data-ttab="${k}" aria-selected="${tab === k}">${label}<span class="n">${fmtInt(n(d))}</span></button>`)}`);
    const r = d.review;
    const nameCell = n => html`<td><span class="cell-row">${instLogo(d, n)}<span class="small">${instName(n)}</span></span></td>`;
    const pc = v => html`<span class="mono ${v >= 0 ? 'chg-up' : 'chg-down'}">${fmtSignedPct(v)}</span>`;
    let body;
    if (tab === 'trips') {
      const rows = [...r.roundTrips].sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1));
      body = rows.length ? html`<table class="grid"><thead><tr><th>Instrument</th><th>Bought</th><th>Sold</th><th class="num">Days</th><th class="num">Qty</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Return</th><th class="num">P&amp;L</th></tr></thead><tbody>${rows.map(t => html`<tr>${nameCell(t.name)}<td class="nowrap">${fmtDate(t.buyDate, { year: false })}</td><td class="nowrap">${fmtDate(t.sellDate, { year: false })}</td><td class="num">${t.days}</td><td class="num">${+t.qty.toFixed(4)}</td><td class="num">€${t.buyPrice.toFixed(2)}</td><td class="num">€${t.sellPrice.toFixed(2)}</td><td class="num">${pc(t.pnlPct)}</td><td class="num mono">${fmtEUR(t.pnl, { sign: true })}</td></tr>`)}</tbody></table>` : null;
    } else if (tab === 'whips') {
      body = r.whipsaws.length ? html`<table class="grid"><thead><tr><th>Instrument</th><th>Sold</th><th>Re-bought</th><th class="num">Days</th><th class="num">Sell</th><th class="num">Re-buy</th><th class="num">Change</th><th class="num">Cost</th></tr></thead><tbody>${r.whipsaws.map(w => html`<tr>${nameCell(w.name)}<td class="nowrap">${fmtDate(w.sellDate, { year: false })}</td><td class="nowrap">${fmtDate(w.buyDate, { year: false })}</td><td class="num">${w.days}</td><td class="num">€${w.sellPrice.toFixed(2)}</td><td class="num">€${w.buyPrice.toFixed(2)}</td><td class="num">${pc(w.pct)}</td><td class="num mono ${w.cost > 0 ? 'chg-down' : 'chg-up'}">${fmtEUR(-w.cost, { sign: true })}</td></tr>`)}</tbody></table>` : null;
    } else if (tab === 'after') {
      const rows = [...r.afterSale].sort((a, b) => b.euros - a.euros);
      body = rows.length ? html`<table class="grid"><thead><tr><th>Instrument</th><th>Sold</th><th class="num">Qty</th><th class="num">Sell price</th><th class="num">Now</th><th class="num">Since sale</th><th class="num">On shares sold</th></tr></thead><tbody>${rows.map(a => html`<tr>${nameCell(a.name)}<td class="nowrap">${fmtDate(a.date, { year: false })}</td><td class="num">${+a.qty.toFixed(4)}</td><td class="num">€${a.sellPrice.toFixed(2)}</td><td class="num">€${a.now.toFixed(2)}</td><td class="num">${pc(a.pct)}</td><td class="num mono ${a.euros > 0 ? 'chg-down' : 'chg-up'}" data-tip="${a.euros > 0 ? 'Gain missed by selling' : 'Loss avoided by selling'}">${fmtEUR(a.euros, { sign: true })}</td></tr>`)}</tbody></table>` : null;
    } else if (tab === 'plans') {
      body = r.plans.length ? html`<table class="grid"><thead><tr><th>Instrument</th><th class="num">Amount</th><th class="num">Day</th><th class="num">Buys</th><th>Since</th><th class="num">Invested</th></tr></thead><tbody>${r.plans.map(p => html`<tr>${nameCell(p.name)}<td class="num mono">${fmtEUR(p.amount, { cents: true })}</td><td class="num">~${p.day}</td><td class="num">${p.count}</td><td>${fmtDate(p.first)}</td><td class="num mono">${fmtEUR(p.total)}</td></tr>`)}</tbody></table>` : null;
    } else {
      const rows = d.transactions.slice(0, 600);
      const KIND = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend', split: 'Split', interest: 'Interest' };
      const susp = new Set(r.suspects.map(s => `${s.date}|${s.name}|${s.total}`));
      body = html`<table class="grid"><thead><tr><th>Date</th><th>Type</th><th>Instrument</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Tax</th><th class="num">Total</th></tr></thead><tbody>${rows.map(t => html`<tr ${susp.has(`${t.date}|${t.name}|${t.total}`) ? html`class="row-warn" data-tip="Price far from nearby trades; possibly an incomplete import"` : ''}><td class="nowrap">${fmtDate(t.date)}</td><td><span class="side">${KIND[t.kind] || t.kind}</span></td>${nameCell(t.name)}<td class="num">${t.qty != null ? +(+t.qty).toFixed(4) : ''}</td><td class="num">${t.price != null ? '€' + t.price.toFixed(2) : ''}</td><td class="num">${t.tax ? '€' + t.tax.toFixed(2) : ''}</td><td class="num mono">${t.total != null ? fmtEUR(t.total, { cents: true }) : ''}</td></tr>`)}</tbody></table>${d.transactions.length > rows.length ? html`<p class="xs muted" style="padding:8px 12px">Showing the latest ${rows.length}.</p>` : ''}`;
    }
    mount($('#t-table', el), body || html`<div class="empty"><h3>Nothing in this period</h3></div>`);
  }

  function startCoach() {
    const d = portfolio.derived();
    if (!d || !ctx.caps.sample) return;
    const panel = $('#t-coach-panel', el);
    panel.hidden = false;
    const out = $('#t-coach-out', el), note = $('#t-coach-note', el);
    const rewrite = !!(coach && coach.text);
    if (coach && coach.ctl) coach.ctl.stop();
    coach = { text: '', busy: true };
    mount(out, html`<p class="thinking">Claude is reading your findings… usually 20–60 seconds.</p>`);
    note.textContent = '';
    $('#t-coach', el).disabled = true;
    coach.ctl = streamInto(ctx.caps.sample, coachPrompt({ stats: d.review.stats, findings: d.review.findings, summary: d.summary || {}, positions: d.positions }), {
      cache: rewrite ? { gcTime: 3600000, refresh: true } : { gcTime: 3600000 },
      render: text => { coach.text = text; mount(out, markdown(text)); },
      onDone: r => { coach.busy = false; note.textContent = r.truncated ? 'Cut short by the length limit.' : 'Not investment or tax advice.'; done(); },
      onError: e => { coach.busy = false; note.textContent = sampleErrorCopy(e); if (!coach.text) mount(out, ''); done(); }
    });
    const done = () => { const b = $('#t-coach', el); b.disabled = false; mount(b, html`${ICON.spark} Rewrite coaching`); };
  }

  on(el, 'click', '[data-ttab]', (_, b) => { tab = b.dataset.ttab; const d = portfolio.derived(); if (d) tabs(d); });
  on(el, 'click', '#t-coach', startCoach);
  on(el, 'click', '#t-import', () => ctx.openImport());

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      // Re-render only when the inputs change, so open evidence lists stay open.
      const d = portfolio.derived();
      const key = `${d?.importedAt}|${d?.transactions?.length}|${JSON.stringify(d?.overrides || {})}|${st.cloud?.logoCount || 0}|${st.caps.sample}`;
      if (!changed || key !== lastKey) { lastKey = key; render(); }
    }
  };
}
