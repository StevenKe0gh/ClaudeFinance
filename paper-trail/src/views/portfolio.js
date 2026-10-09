import { html, mount, on, $ } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip } from '../ui/parts.js';
import { toast } from '../ui/overlay.js';
import { allocate, METHODS } from '../model/allocate.js';
import { fmtMoney, fmtPct, fmtDate, isoDate, cleanCompany } from '../core/util.js';

/** Position planner: constraints, conviction-weighted sizing, notes, CSV export. */
export function createPortfolioView(ctx) {
  const { store, workspace } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-portfolio';

  mount(el, html`
    <div class="view-h">
      <div><h1>Portfolio plan</h1><p>Sizes the stocks you picked under a cash reserve and a cap per position. Scores refresh from the live signals; notes are saved to your workspace.</p></div>
      <div class="tools">
        <button class="btn" type="button" id="p-addtop">${ICON.plus} Add top 6 tier A/B</button>
        <button class="btn" type="button" id="p-export">${ICON.download} Export CSV</button>
      </div>
    </div>
    <div class="two-col">
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel"><div class="panel-h"><h2>Constraints</h2></div><div class="panel-b" id="p-form"></div></section>
        <section class="panel"><div class="panel-h"><h2>Plan summary</h2></div><div class="panel-b" id="p-sum"></div></section>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel"><div class="panel-h"><h2>Positions</h2><span class="src" id="p-count"></span></div><div class="panel-b flush" id="p-table"></div></section>
        <section class="panel"><div class="panel-h"><h2>Before you place an order</h2></div><div class="panel-b"><ul class="rows small">
          <li>Check the price since each filing date. If the stock already ran, much of the signal may be priced in.</li>
          <li>Congressional trades can be 45 days old when disclosed, and amounts are ranges.</li>
          <li>Use limit orders. Decide now what makes you sell: a price, a date, or insiders turning to sellers.</li>
          <li>Re-run the signals in 30 days before adding money. This plan is a sizing tool, not investment advice.</li>
        </ul></div></section>
      </div>
    </div>`);

  function form(st) {
    const p = st.workspace.portfolio;
    mount($('#p-form', el), html`<div class="form-grid">
      <div class="field full"><label class="label" for="p-cap">Cash to invest ($)</label><input class="input" type="number" id="p-cap" min="100" step="100" value="${p.capital}"></div>
      <div class="field"><label class="label" for="p-res">Cash reserve (%)</label><input class="input" type="number" id="p-res" min="0" max="80" step="5" value="${p.reserve}"></div>
      <div class="field"><label class="label" for="p-max">Max per stock (%)</label><input class="input" type="number" id="p-max" min="5" max="100" step="5" value="${p.cap}"></div>
      <div class="field full"><label class="label" for="p-method">Sizing</label><select class="input" id="p-method">${Object.entries(METHODS).map(([k, m]) => html`<option value="${k}" ${p.method === k ? 'selected' : ''}>${m.label}</option>`)}</select><span class="hint">${METHODS[p.method]?.desc || ''}</span></div>
    </div>`);
  }

  function items(st) {
    const live = new Map(st.signals.map(s => [s.ticker, s]));
    return st.workspace.watch.map(w => {
      const s = live.get(w.ticker);
      return { ...w, score: s ? s.score : w.scoreAtAdd, tier: s ? s.tier : w.tierAtAdd, live: !!s, company: s?.company || w.company };
    }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  function table(st) {
    const list = items(st);
    const p = st.workspace.portfolio;
    $('#p-count', el).textContent = `${list.length} position${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      mount($('#p-table', el), html`<div class="empty"><h3>No positions yet</h3><span>Press ☆ on a signal, <b>Add to portfolio</b> in a dossier, or <b>Add top 6 tier A/B</b> above.</span></div>`);
      mount($('#p-sum', el), html`<p class="small muted">Add positions to see the plan.</p>`);
      return;
    }
    const a = allocate(list, { capital: p.capital, reserve: p.reserve, cap: p.cap, method: p.method });
    const maxAmt = Math.max(1, ...a.amounts);
    mount($('#p-table', el), html`<div class="table-wrap"><table class="grid"><thead><tr><th>Ticker</th><th>Tier</th><th class="num">Score</th><th class="num">Weight</th><th class="num">Amount</th><th style="min-width:90px"><span class="sr-only">Bar</span></th><th>Thesis / exit note</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>
      ${list.map((it, i) => html`<tr>
        <td><div class="two"><button class="tk" type="button" data-open="${it.ticker}">${it.ticker}</button><span class="co">${cleanCompany(it.company)}</span></div></td>
        <td>${it.tier ? tierChip(it.tier) : ''}</td>
        <td class="num" data-tip="${it.live ? 'Live score' : `Score when added on ${fmtDate(it.addedAt)}; not in the current screen`}">${it.score ?? '—'}${it.live ? '' : '*'}</td>
        <td class="num">${fmtPct(a.shares[i] * 100, 1)}</td>
        <td class="num">${fmtMoney(a.amounts[i])}</td>
        <td><span class="alloc"><i style="width:${((a.amounts[i] / maxAmt) * 100).toFixed(1)}%"></i></span></td>
        <td><input class="input note-input" type="text" data-note="${it.ticker}" value="${it.note || ''}" placeholder="Why, and when to sell" aria-label="Note for ${it.ticker}"></td>
        <td><button class="btn ghost sm" type="button" data-remove="${it.ticker}" aria-label="Remove ${it.ticker}">${ICON.close}</button></td>
      </tr>`)}</tbody></table></div>`);
    const warn = a.idle >= 1 ? html`<div class="alert" data-tone="warn"><div>${fmtMoney(a.idle)} stays in cash because of the ${p.cap}% cap. Add ${Math.max(1, a.minPositionsForFullInvestment - list.length)} more position${a.minPositionsForFullInvestment - list.length > 1 ? 's' : ''} or raise the cap.</div></div>` : '';
    mount($('#p-sum', el), html`${warn}<dl class="kv">
      <dt>Invested</dt><dd>${fmtMoney(a.invested)}</dd>
      <dt>Cash (reserve + uninvested)</dt><dd>${fmtMoney(a.cash)}</dd>
      <dt>Largest position</dt><dd>${fmtPct(a.largest * 100, 1)}</dd>
      <dt>Effective positions</dt><dd data-tip="1 / sum of squared weights: how many equal positions this plan behaves like">${a.effectiveN.toFixed(1)}</dd>
      <dt>Stocks needed to invest it all</dt><dd>${a.minPositionsForFullInvestment}</dd></dl>`);
    el._last = { list, a, p };
  }

  const setPortfolio = patch => workspace.update({ portfolio: { ...store.get().workspace.portfolio, ...patch } });
  const num = (v, d, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  on(el, 'change', '#p-cap', (_, i) => setPortfolio({ capital: num(i.value, 10000, 100, 1e9) }));
  on(el, 'change', '#p-res', (_, i) => setPortfolio({ reserve: num(i.value, 10, 0, 80) }));
  on(el, 'change', '#p-max', (_, i) => setPortfolio({ cap: num(i.value, 20, 5, 100) }));
  on(el, 'change', '#p-method', (_, s) => setPortfolio({ method: s.value }));
  on(el, 'click', '[data-remove]', (_, b) => ctx.toggleWatch(b.dataset.remove));
  on(el, 'change', '[data-note]', (_, i) => {
    const watch = store.get().workspace.watch.map(w => (w.ticker === i.dataset.note ? { ...w, note: i.value.slice(0, 500) } : w));
    workspace.update({ watch });
  });
  on(el, 'click', '#p-addtop', () => {
    const st = store.get();
    const have = new Set(st.workspace.watch.map(w => w.ticker));
    const add = st.signals.filter(s => (s.tier === 'A' || s.tier === 'B') && !have.has(s.ticker) && !s.notes.some(n => ['placement', 'fixedPrice', 'programmatic', 'stakeJump'].includes(n.key))).slice(0, 6);
    if (!add.length) { toast('No new tier A/B signals without offering or program patterns.'); return; }
    workspace.update({ watch: [...st.workspace.watch, ...add.map(s => ({ ticker: s.ticker, company: s.company, scoreAtAdd: s.score, tierAtAdd: s.tier, addedAt: isoDate(), note: '' }))] });
    toast(`Added ${add.map(s => s.ticker).join(', ')}`, 'ok');
  });
  on(el, 'click', '#p-export', async () => {
    const last = el._last;
    if (!last) { toast('Add positions first.'); return; }
    if (!ctx.caps.downloads) { toast('File downloads are not available in this view.', 'error'); return; }
    const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Ticker', 'Company', 'Tier', 'Score', 'Weight %', 'Amount USD', 'Note']];
    last.list.forEach((it, i) => rows.push([it.ticker, cleanCompany(it.company), it.tier || '', it.score ?? '', (last.a.shares[i] * 100).toFixed(1), last.a.amounts[i], it.note || '']));
    rows.push(['CASH', 'Reserve and uninvested', '', '', ((last.a.cash / last.p.capital) * 100).toFixed(1), Math.round(last.a.cash), '']);
    try {
      await ctx.caps.downloads.save({ filename: `paper-trail-plan-${isoDate()}.csv`, data: rows.map(r => r.map(cell).join(',')).join('\n') });
      toast('Plan saved', 'ok');
    } catch (e) {
      if (!e || e.code !== 'declined') toast(`Could not save the file (${(e && e.code) || 'error'}).`, 'error');
    }
  });

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      const has = k => !changed || changed.includes(k);
      const typing = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('input,select');
      if (has('workspace') && !typing) form(st);
      if (has('workspace') || has('signals')) {
        if (typing && document.activeElement.matches('[data-note]')) return;
        table(st);
      }
    }
  };
}
