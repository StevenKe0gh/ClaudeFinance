import { html, mount, on, $ } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { kpi, tierChip, errorAlert } from '../ui/parts.js';
import { openDrawer, openModal, closeTop, toast } from '../ui/overlay.js';
import { brand, nameOf } from '../ui/brand.js';
import { fmtEUR, fmtSignedPct, fmtDate, fmtInt, fmtUSD } from '../core/util.js';
import { parseFinanzfluss, mergeTransactions } from '../model/finanzfluss.js';
import { KIND_LABEL } from '../model/instruments.js';
import { holdingAlerts } from '../app/portfolio.js';

/**
 * Holdings: the imported depot with company identity, allocation, gains and
 * a live cross-check of every US-listed holding against insider and
 * congressional trading.
 */
export function createHoldingsView(ctx) {
  const { store, portfolio } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-holdings';
  let sort = { key: 'value', dir: 'desc' };

  mount(el, html`
    <div class="view-h">
      <div><h1>Holdings</h1><p>Your depot as imported from Finanzfluss, with every US-listed position checked against the last 90 days of insider filings and a year of congressional trades.</p></div>
      <div class="tools">
        <button class="btn" type="button" id="h-check" data-tip="Re-run the insider and Congress check for every US holding">${ICON.refresh} Re-check</button>
        <button class="btn" type="button" data-nav="trades">${ICON.trades} Trade review</button>
        <button class="btn primary" type="button" id="h-import">${ICON.plus} Import from Finanzfluss</button>
      </div>
    </div>
    <div class="kpis" id="h-kpis"></div>
    <div id="h-note"></div>
    <div class="hold-grid">
      <section class="panel"><div class="panel-h"><h2>Positions</h2><span class="src" id="h-count"></span></div><div class="table-wrap" id="h-table"></div></section>
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel"><div class="panel-h"><h2>Insider watch</h2><span class="src" id="h-chk"></span></div><div class="panel-b" id="h-alerts"></div></section>
        <section class="panel"><div class="panel-h"><h2>Allocation</h2><span class="src">by instrument type</span></div><div class="panel-b" id="h-alloc"></div></section>
      </div>
    </div>`);

  function empty() {
    mount($('#h-kpis', el), '');
    mount($('#h-note', el), '');
    mount($('#h-table', el), html`<div class="empty"><h3>No depot imported yet</h3><span>In Finanzfluss, open your depot, select the whole page (<kbd>⌘A</kbd>), copy it, and paste it into <b>Import from Finanzfluss</b>. Do the same with the Buchungen pages and the dashboard for the trade review and key figures.</span><div style="margin-top:10px"><button class="btn primary" type="button" id="h-import2">${ICON.plus} Import from Finanzfluss</button></div></div>`);
    mount($('#h-alerts', el), html`<p class="small muted">Appears once a depot is imported.</p>`);
    mount($('#h-alloc', el), '');
    $('#h-count', el).textContent = '';
  }

  function render(st) {
    const d = portfolio.derived();
    if (!d) { empty(); return; }
    const s = d.summary || {};
    const gain = s.unrealized ?? d.positions.reduce((a, p) => a + (p.gain || 0), 0);
    mount($('#h-kpis', el), html`
      ${kpi('Depot value', fmtEUR(s.depotValue ?? d.total), s.depotName || `${d.positions.length} positions`)}
      ${kpi('Unrealised gain', html`<span class="${gain >= 0 ? 'chg-up' : 'chg-down'}">${fmtEUR(gain, { sign: true })}</span>`, s.unrealizedPct != null ? `${fmtSignedPct(s.unrealizedPct)} on ${fmtEUR(s.invested ?? s.costBasis)}` : '')}
      ${kpi('Realised, net', s.realizedNet != null ? fmtEUR(s.realizedNet, { sign: true }) : '—', s.realized != null ? `${fmtEUR(s.realized)} before tax` : 'from the dashboard paste')}
      ${kpi('Dividends', s.dividends != null ? fmtEUR(s.dividends) : '—', s.taxesFees != null ? `taxes and fees ${fmtEUR(s.taxesFees)}` : '')}
      ${kpi('Return', s.irr != null ? `${fmtSignedPct(s.irr, 2)} IRR` : s.twror != null ? fmtSignedPct(s.twror, 2) : '—', s.twror != null ? `TWROR ${fmtSignedPct(s.twror, 2)}${s.inflation != null ? ` · inflation ${fmtSignedPct(s.inflation, 2)}` : ''}` : '')}
      ${kpi('Cash', s.cash != null ? fmtEUR(s.cash) : '—', `imported ${fmtDate(d.importedAt)}`)}`);
    mount($('#h-note', el), d.where === 'local'
      ? html`<div class="alert" data-tone="info"><div>Kept in this browser only. Open the page on claude.ai to store the depot privately in your account so the daily briefing can check it.</div></div>`
      : '');
    table(st, d);
    alerts(st, d);
    alloc(d);
  }

  function table(st, d) {
    const sig = new Map(st.signals.map(s => [s.ticker, s]));
    const chk = st.holdingChecks?.map;
    const quotes = st.cloud?.quotes?.q || {};
    const key = { value: p => p.value, gain: p => p.gainPct ?? -1e9, day: p => p.dayPct ?? -1e9, name: p => p.short.toLowerCase() }[sort.key];
    const rows = [...d.positions].sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1); });
    $('#h-count', el).textContent = `${d.positions.length} · ${fmtEUR(d.total)}`;
    const th = (k, label, cls = '') => html`<th class="sortable ${cls}" data-hsort="${k}">${label}${sort.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
    mount($('#h-table', el), html`<table class="grid"><thead><tr>${th('name', 'Holding')}${th('value', 'Value', 'num')}<th>Weight</th>${th('gain', 'Gain', 'num')}${th('day', 'Today', 'num')}<th>Insiders · Congress</th><th><span class="sr-only">Edit</span></th></tr></thead><tbody>
      ${rows.map(p => {
        const t = p.inst.us ? p.inst.ticker : null;
        const s = t && sig.get(t);
        const c = t && chk && chk.get(t);
        const q = t && quotes[t];
        const sub = [KIND_LABEL[p.inst.kind], t || p.inst.local || p.inst.label, p.inst.country].filter(Boolean).join(' · ');
        return html`<tr>
          <td>${brand(t || '', { name: t ? nameOf(t, p.short) : p.short, sub, logoKey: fundLike(p) ? '' : p.inst.logo || '', open: !!t, size: 26 })}</td>
          <td class="num"><div class="two" style="align-items:flex-end"><span class="mono">${fmtEUR(p.value)}</span><span class="sub">${p.qty != null ? `${+p.qty.toFixed(4)} × €${(p.price ?? 0).toFixed(2)}` : ''}</span></div></td>
          <td><div class="alloc-row" style="grid-template-columns:minmax(60px,1fr) 44px"><span class="bar"><i data-k="${p.inst.kind}" style="width:${Math.min(100, (p.alloc || 0) * 3)}%"></i></span><span class="mono xs">${(p.alloc ?? 0).toFixed(1)}%</span></div></td>
          <td class="num"><div class="two" style="align-items:flex-end"><span class="mono ${p.gainPct >= 0 ? 'chg-up' : 'chg-down'}">${fmtSignedPct(p.gainPct)}</span><span class="sub">${fmtEUR(p.gain, { sign: true })}</span></div></td>
          <td class="num"><div class="two" style="align-items:flex-end"><span class="mono xs ${p.dayPct >= 0 ? 'chg-up' : 'chg-down'}">${fmtSignedPct(p.dayPct, 2)}</span>${q ? html`<span class="sub" data-tip="US close from the daily quote snapshot">$${q[0].toFixed(2)} ${fmtSignedPct(q[1])}</span>` : ''}</div></td>
          <td>${checkCell(t, s, c, st)}</td>
          <td><button class="btn ghost sm" type="button" data-map="${p.name}" data-tip="Change which listing this holding maps to">${ICON.edit}</button></td>
        </tr>`;
      })}</tbody></table>`);
  }

  /* Issuer wordmarks are unreadable at row size; funds get a monogram of their own name. */
  const fundLike = p => p.inst.kind === 'etf' || p.inst.kind === 'etc';

  function checkCell(t, s, c, st) {
    if (!t) return html`<span class="xs dim">not US-listed</span>`;
    const parts = [];
    if (s && s.tier !== 'D') parts.push(html`${tierChip(s.tier)} `);
    if (!c) return html`<span class="cell-row">${parts}${st.holdingChecks?.status === 'running' ? html`<span class="xs muted">checking…</span>` : st.caps.mcp === 'on' ? html`<span class="xs muted">queued</span>` : html`<span class="xs dim">needs Quiver</span>`}</span>`;
    if (c.error) return html`<span class="xs status-err" data-tip="${c.error.message || c.error.code}">check failed</span>`;
    const ins = c.buys || c.sells
      ? html`<span class="qv"><span class="chg-up" data-tip="${`Open-market buys, 90 days${c.buyers.length ? ': ' + c.buyers.slice(0, 4).join(', ') : ''}`}">▲${c.buys ? fmtUSD(c.buyUsd) : '0'}</span> <span class="chg-down" data-tip="${`Open-market sales, 90 days${c.sellers.length ? ': ' + c.sellers.slice(0, 4).join(', ') : ''}`}">▼${c.sells ? fmtUSD(c.sellUsd) : '0'}</span></span>`
      : html`<span class="qv dim">no Form 4 P/S</span>`;
    const cg = c.cBuys || c.cSells ? html`<span class="qv" data-tip="${`Congress, 12 months${c.members.length ? ': ' + c.members.slice(0, 4).join(', ') : ''}`}">${c.cBuys}B · ${c.cSells}S</span>` : '';
    return html`<div class="two"><span class="cell-row">${parts}${ins}</span>${cg ? html`<span class="sub">Congress ${cg}</span>` : ''}</div>`;
  }

  function alerts(st, d) {
    const hc = st.holdingChecks;
    $('#h-chk', el).textContent = hc ? (hc.status === 'running' ? `checking ${hc.done}/${hc.total}` : `${hc.total} US holdings · ${fmtDate(new Date(hc.at).toISOString().slice(0, 10), { year: false })}`) : `${d.usTickers.length} US holdings`;
    const list = holdingAlerts(d, hc?.map, st.signals);
    const briefAlerts = (st.cloud?.briefs?.[0]?.alerts || []).filter(a => !list.some(b => b.ticker === a.ticker && b.text === a.text));
    const all = [...list, ...briefAlerts.map(a => ({ ...a, fromBrief: true }))];
    if (st.caps.mcp !== 'on' && !all.length) { mount($('#h-alerts', el), html`<p class="small muted">The check runs on claude.ai with the Quiver Quant connector. The daily briefing repeats it every morning.</p>`); return; }
    if (!all.length) { mount($('#h-alerts', el), hc?.status === 'running' ? html`<div class="skel"></div><div class="skel" style="width:70%"></div>` : html`<p class="small muted">Nothing notable: no clustered insider buying, heavy insider selling or congressional activity in your US holdings.</p>`); return; }
    mount($('#h-alerts', el), html`${all.slice(0, 12).map(a => html`<div class="alert-row" data-tone="${a.tone}"><span class="dot"></span><div><b>${a.ticker ? html`<button class="linkish" type="button" data-open="${a.ticker}">${a.name || nameOf(a.ticker)}</button>` : a.name}</b> ${a.text}${a.fromBrief ? html` <span class="xs dim">· daily brief</span>` : ''}</div></div>`)}`);
  }

  function alloc(d) {
    const by = new Map();
    for (const p of d.positions) by.set(p.inst.kind, (by.get(p.inst.kind) || 0) + (p.alloc || 0));
    const top = [...d.positions].sort((a, b) => b.alloc - a.alloc).slice(0, 5);
    mount($('#h-alloc', el), html`${[...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<div class="alloc-row"><span>${KIND_LABEL[k] || k}</span><span class="bar"><i data-k="${k}" style="width:${v}%"></i></span><span class="mono xs" style="text-align:right">${v.toFixed(1)}%</span></div>`)}
      <div class="label" style="margin:12px 0 4px">Largest positions</div>
      ${top.map(p => html`<div class="alloc-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.short}</span><span class="bar"><i data-k="${p.inst.kind}" style="width:${p.alloc * 2}%"></i></span><span class="mono xs" style="text-align:right">${p.alloc.toFixed(1)}%</span></div>`)}
      <p class="xs muted" style="margin-top:8px">Top three: ${d.review.stats.top3.toFixed(1)}% of the depot. ${d.review.stats.tailCount} positions under 1%.</p>`);
  }

  /* ---------- Import ---------- */
  function openImport() {
    openDrawer({
      title: 'Import from Finanzfluss',
      src: 'paste · parsed in this page',
      render(body) {
        mount(body, html`<ol class="small muted" style="padding-left:18px;display:flex;flex-direction:column;gap:4px;margin-bottom:10px">
            <li>Open your depot on finanzfluss.de, press <kbd>⌘A</kbd> then <kbd>⌘C</kbd>.</li>
            <li>Paste below. You can paste the depot page, the Buchungen (transactions) pages and the dashboard, one after another or all at once.</li>
            <li>Transactions are merged and de-duplicated, so pasting a page twice is harmless.</li></ol>
          <textarea class="input paste" id="imp-text" placeholder="Paste the Finanzfluss page here" aria-label="Finanzfluss page text"></textarea>
          <div id="imp-preview" style="margin-top:10px"></div>`);
        const ta = $('#imp-text', body);
        ta.addEventListener('input', () => preview(body, ta.value));
        setTimeout(() => ta.focus(), 50);
      }
    });
  }
  function preview(body, text) {
    const host = $('#imp-preview', body);
    if (!text.trim()) { mount(host, ''); return; }
    const parsed = parseFinanzfluss(text);
    const cur = portfolio.raw() || {};
    const merged = mergeTransactions(cur.transactions || [], parsed.transactions);
    const positions = parsed.positions.length ? parsed.positions : cur.positions || [];
    const summary = { ...(cur.summary || {}), ...parsed.summary };
    const nothing = !parsed.positions.length && !parsed.transactions.length && !Object.keys(parsed.summary).length;
    mount(host, nothing
      ? html`<div class="alert" data-tone="warn"><div>Nothing recognisable in this paste. Copy the whole Finanzfluss page, including the table headers.</div></div>`
      : html`<dl class="kv small"><dt>Positions</dt><dd>${parsed.positions.length ? `${parsed.positions.length} (replaces current)` : `keeps ${positions.length}`}</dd>
          <dt>Transactions</dt><dd>${fmtInt(parsed.transactions.length)} read · ${fmtInt(merged.added)} new · ${fmtInt(merged.all.length)} total${summary.txTotal ? ` of ${fmtInt(summary.txTotal)}` : ''}</dd>
          <dt>Key figures</dt><dd>${Object.keys(parsed.summary).length ? Object.keys(parsed.summary).length + ' fields' : 'none in this paste'}</dd>
          ${merged.all.length ? html`<dt>Period</dt><dd>${fmtDate(merged.all.at(-1).date)} – ${fmtDate(merged.all[0].date)}</dd>` : ''}</dl>
        <div class="ins-actions" style="margin-top:10px"><button class="btn primary" type="button" id="imp-save">${ICON.check} Save import</button><span class="xs muted">${ctx.cloud.ready ? 'Stored privately in your account; only you can read it.' : 'Stored in this browser only.'}</span></div>`);
    const btn = $('#imp-save', body);
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await portfolio.save({ positions, summary, transactions: merged.all });
        toast(`Imported ${positions.length} positions and ${fmtInt(merged.all.length)} transactions`, 'ok');
        closeTop();
        render(store.get());
        if (store.get().caps.mcp === 'on') portfolio.check({ refresh: true });
      } catch (e) {
        btn.disabled = false;
        mount(host.appendChild(document.createElement('div')), errorAlert(e));
      }
    });
  }

  function openMap(name) {
    const d = portfolio.derived();
    const p = d && d.positions.find(x => x.name === name);
    if (!p) return;
    openModal({
      title: 'Map holding to a listing',
      content: html`<p class="small" style="margin-bottom:8px"><b>${name}</b></p>
        <p class="small muted" style="margin-bottom:10px">Currently ${p.inst.ticker ? html`mapped to <b>${p.inst.ticker}</b> (${nameOf(p.inst.ticker)})` : 'not mapped to a US listing'}. Enter a US ticker so insider and congressional data can be checked, or leave it empty to clear your override.</p>
        <div class="ins-actions"><input class="input" id="map-t" value="${p.inst.ticker || ''}" placeholder="e.g. NVDA" style="width:120px;text-transform:uppercase" aria-label="US ticker"><button class="btn primary" type="button" id="map-save">Save</button></div>`
    });
    const save = async () => {
      const t = ($('#map-t').value || '').trim().toUpperCase();
      await portfolio.setOverride(name, t ? { ticker: t, kind: 'stock' } : null);
      closeTop();
      toast(t ? `${p.short} → ${nameOf(t)} (${t})` : `Cleared the mapping for ${p.short}`, 'ok');
      setTimeout(() => { render(store.get()); portfolio.check(); }, 300);
    };
    $('#map-save').addEventListener('click', save);
    $('#map-t').addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); });
  }

  on(el, 'click', '#h-import, #h-import2', openImport);
  on(el, 'click', '#h-check', () => portfolio.check({ refresh: true }));
  on(el, 'click', '[data-map]', (_, b) => openMap(b.dataset.map));
  on(el, 'click', '[data-hsort]', (_, t) => { const k = t.dataset.hsort; sort = { key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : k === 'name' ? 'asc' : 'desc' }; table(store.get(), portfolio.derived()); });

  return {
    el,
    openImport,
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || changed.some(k => ['cloud', 'holdingChecks', 'signals', 'portfolioLocalAt', 'caps'].includes(k))) render(st);
    },
    show() { const st = store.get(); if (st.caps.mcp === 'on' && portfolio.derived() && !st.holdingChecks) portfolio.check(); }
  };
}
