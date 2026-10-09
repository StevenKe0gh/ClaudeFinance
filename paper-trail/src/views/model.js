import { html, mount, on, $ } from '../ui/html.js';
import { ICON } from '../ui/icons.js';
import { tierChip } from '../ui/parts.js';
import { FACTORS, PRESETS, DEFAULT_MODEL, MULT, buildSignals, weightShares } from '../model/score.js';
import { fmtInt } from '../core/util.js';

/**
 * Model workbench: weights, recency half-life and tier cut-offs, with a live
 * impact table against the default model, and the model card.
 */
export function createModelView(ctx) {
  const { store } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-model';
  let baselineKey = null;
  let baseline = new Map();

  mount(el, html`
    <div class="view-h">
      <div><h1>Conviction model</h1><p>How the score is built and what changes when you re-weight it. Changes apply everywhere instantly and are saved to your workspace.</p></div>
      <div class="tools"><button class="btn" type="button" id="m-reset">${ICON.refresh} Reset to Balanced</button></div>
    </div>
    <div class="two-col">
      <section class="panel"><div class="panel-h"><h2>Weights</h2><span class="src" id="m-version"></span></div><div class="panel-b" id="m-controls"></div></section>
      <div style="display:flex;flex-direction:column;gap:var(--gap);min-width:0">
        <section class="panel"><div class="panel-h"><h2>Impact vs. Balanced</h2><span class="src">top 25 under your weights</span></div><div class="panel-b flush" id="m-impact"></div></section>
        <section class="panel"><div class="panel-h"><h2>Model card</h2></div><div class="panel-b" id="m-card"></div></section>
      </div>
    </div>`);

  function controls(st) {
    const m = st.model;
    const share = weightShares(m.weights);
    mount($('#m-controls', el), html`
      <div class="seg" role="group" aria-label="Preset">${Object.entries(PRESETS).map(([k, p]) => html`<button type="button" data-preset="${k}" aria-pressed="${m.preset === k}">${p.short}</button>`)}<button type="button" disabled aria-pressed="${!(m.preset in PRESETS)}">Custom</button></div>
      <div>${FACTORS.map(f => html`<div class="slider">
        <label class="name" for="w-${f.key}"><span class="sw" data-g="${f.group}"></span>${f.label}</label><span class="val">${share[f.key].toFixed(0)}%</span>
        <input type="range" id="w-${f.key}" min="0" max="40" step="1" value="${m.weights[f.key]}" data-w="${f.key}" aria-label="${f.label} weight">
        <span class="desc">${f.desc}</span></div>`)}</div>
      <div class="slider"><label class="name" for="m-hl">Recency half-life</label><span class="val">${m.halfLife}d</span><input type="range" id="m-hl" min="7" max="60" step="1" value="${m.halfLife}"><span class="desc">A buy this many days old counts half as much as one from today.</span></div>
      <div class="form-grid">${['A', 'B', 'C'].map(t => html`<div class="field"><label class="label" for="m-t${t}">Tier ${t} from</label><input class="input" type="number" id="m-t${t}" min="1" max="99" value="${m.tiers[t]}" data-tier="${t}"></div>`)}</div>`);
  }

  function impact(st) {
    const host = $('#m-impact', el);
    if (!st.data) { mount(host, html`<div class="empty"><h3>Waiting for data</h3><span>The impact table fills in after the first pull.</span></div>`); return; }
    const key = `${st.data.fetchedAt}|${st.enrichment.size}`;
    if (key !== baselineKey) {
      const base = buildSignals({ ...st.data, insiderBuys: st.data.insiderBuys, congressRows: st.data.congressRows, enrichment: st.enrichment, model: DEFAULT_MODEL });
      baseline = new Map(base.map(s => [s.ticker, s]));
      baselineKey = key;
    }
    const top = st.signals.slice(0, 25);
    mount(host, html`<div class="table-wrap"><table class="grid"><thead><tr><th class="num">Rank</th><th class="num">Δ</th><th>Ticker</th><th>Tier</th><th class="num">Score</th><th class="num">Δ score</th><th>Driven by</th></tr></thead><tbody>
      ${top.map(s => {
        const b = baseline.get(s.ticker);
        const dr = b ? b.rank - s.rank : null;
        const ds = b ? s.score - b.score : null;
        return html`<tr><td class="num">${s.rank}</td><td class="num ${dr > 0 ? 'delta-up' : dr < 0 ? 'delta-down' : 'dim'}">${dr == null ? 'new' : dr === 0 ? '·' : (dr > 0 ? '▲' : '▼') + Math.abs(dr)}</td><td><button class="tk" type="button" data-open="${s.ticker}">${s.ticker}</button></td><td>${tierChip(s.tier)}</td><td class="num">${s.score}</td><td class="num ${ds > 0 ? 'delta-up' : ds < 0 ? 'delta-down' : 'dim'}">${ds == null ? '' : ds === 0 ? '·' : (ds > 0 ? '+' : '') + ds}</td><td>${drivers(s)}</td></tr>`;
      })}</tbody></table></div>`);
  }

  function drivers(s) {
    const top = [...s.factors].sort((a, b) => b.contrib - a.contrib).filter(f => f.contrib >= 1).slice(0, 3);
    return html`<span class="cell-row xs">${top.map(f => html`<span class="cell-row"><span class="sw" data-g="${f.group}"></span>${f.short}</span>`)}</span>`;
  }

  function card(st) {
    const share = weightShares(st.model.weights);
    mount($('#m-card', el), html`
      <p class="small">Inputs: SEC Form 4 open-market purchases (code P), House and Senate periodic transaction reports, and Quiver’s per-ticker congressional aggregates, for the selected window; congressional purchases over 90 days for convergence; and, for the top 15, 90 days of all Form 4 activity to detect insider selling.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Factor</th><th>Group</th><th class="num">Weight</th><th>Definition</th></tr></thead><tbody>
        ${FACTORS.map(f => html`<tr><td class="nowrap">${f.label}</td><td><span class="cell-row"><span class="sw" data-g="${f.group}"></span>${f.group}</span></td><td class="num">${share[f.key].toFixed(0)}%</td><td class="small muted">${f.desc}</td></tr>`)}
      </tbody></table></div>
      <div><span class="label">Adjustments (multiply the insider or Congress part)</span>
      <ul class="rows small">
        <li><span class="grow">Offering-priced: 3+ insiders, or 2 with a round price, identical lots or $5M+, on one day at one price</span><span class="mono">×${MULT.placement}</span></li>
        <li><span class="grow">Fixed price: one buyer, 3+ lines over several days, 80%+ at one price</span><span class="mono">×${MULT.fixedPrice}</span></li>
        <li><span class="grow">Purchase program: 8+ buyers with a median under $15K, or 10+ lines with a median under $5K</span><span class="mono">×${MULT.programmatic}</span></li>
        <li><span class="grow">Outsized stake jump: a buyer more than quintuples their holding with $1M+</span><span class="mono">×${MULT.stakeJump}</span></li>
        <li><span class="grow">Only funds or 10% owners bought</span><span class="mono">×${MULT.entityOnly}</span></li>
        <li><span class="grow">Insider selling over 90 days (top 15 only)</span><span class="mono">×(1 − 0.6 × sell share)</span></li>
        <li><span class="grow">Congressional sales in the window</span><span class="mono">×(1 − 0.5 × sell share)</span></li>
      </ul></div>
      <div><span class="label">Data hygiene</span><p class="small muted">Rows without a valid ticker, mutual-fund share classes, dates outside the window or in the future, non-positive share counts, prices under 5 cents, single lines above $2B (data errors) and duplicates are dropped before scoring; counts are on the Lineage page. Same-day buy and sell pairs by one member count as zero.</p></div>
      <div><span class="label">Limitations</span><p class="small muted">No price, valuation or volatility data enters the score, and the model has not been backtested. It ranks evidence of informed buying; it does not forecast returns. Congressional trades are disclosed up to 45 days late and as ranges.</p></div>`);
  }

  const setModel = patch => ctx.setModel({ ...store.get().model, ...patch });
  on(el, 'click', '[data-preset]', (_, b) => ctx.applyPreset(b.dataset.preset));
  on(el, 'input', '[data-w]', (_, i) => { const m = store.get().model; setModel({ preset: 'custom', weights: { ...m.weights, [i.dataset.w]: +i.value } }); });
  on(el, 'input', '#m-hl', (_, i) => setModel({ halfLife: +i.value }));
  on(el, 'change', '[data-tier]', (_, i) => { const m = store.get().model; const v = Math.max(1, Math.min(99, +i.value || m.tiers[i.dataset.tier])); setModel({ tiers: { ...m.tiers, [i.dataset.tier]: v } }); });
  on(el, 'click', '#m-reset', () => ctx.applyPreset('balanced'));

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      const has = k => !changed || changed.includes(k);
      $('#m-version', el).textContent = `${fmtInt(st.signals.length)} tickers`;
      if (has('model')) {
        const active = document.activeElement;
        const typing = active && el.contains(active) && active.matches('input[type=range],input[type=number]');
        if (!typing) controls(st);
        else for (const f of FACTORS) { const v = el.querySelector(`#w-${f.key}`)?.closest('.slider')?.querySelector('.val'); if (v) v.textContent = weightShares(st.model.weights)[f.key].toFixed(0) + '%'; }
      }
      if (has('signals') || has('model') || has('data')) { impact(st); card(st); }
    }
  };
}
