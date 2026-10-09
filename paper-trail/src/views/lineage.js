import { html, mount, $ } from '../ui/html.js';
import { fmtInt, fmtClock } from '../core/util.js';
import { APP, SERVER } from '../core/config.js';

const DROP_LABEL = { noTicker: 'No valid ticker', mutualFund: 'Mutual-fund share class', badDate: 'Date outside window or invalid', nonPositive: 'Zero shares or price', subPenny: 'Price under 5¢ (unit mismatch)', outlier: 'Implausible value (> $2B line)', duplicate: 'Duplicate line' };

/** Data lineage: pipeline stages, data quality, capabilities and the raw request log. */
export function createLineageView(ctx) {
  const { store, conn } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-lineage';
  mount(el, html`
    <div class="view-h"><div><h1>Data lineage</h1><p>Every request this session made to Quiver, how each pipeline stage did, and what was dropped before scoring.</p></div></div>
    <section class="panel"><div class="panel-h"><h2>Pipeline</h2><span class="src" id="l-run"></span></div><div class="stages" id="l-stages"></div></section>
    <div class="dz-grid">
      <section class="panel span-6"><div class="panel-h"><h2>Data quality</h2></div><div class="panel-b" id="l-quality"></div></section>
      <section class="panel span-6"><div class="panel-h"><h2>Runtime</h2></div><div class="panel-b" id="l-caps"></div></section>
    </div>
    <section class="panel"><div class="panel-h"><h2>Request log</h2><span class="src" id="l-count"></span></div><div class="panel-b flush" id="l-log"></div></section>`);

  function stages(st) {
    const p = st.pipeline;
    $('#l-run', el).textContent = p.startedAt ? `started ${fmtClock(p.startedAt)}${p.finishedAt ? ` · ${((p.finishedAt - p.startedAt) / 1000).toFixed(1)}s` : ''}` : 'not run';
    mount($('#l-stages', el), html`${p.stages.map(s => html`<div class="stage" data-s="${s.status}"><span class="st"><i></i>${s.label}</span><span class="v">${s.status === 'pending' ? '—' : fmtInt(s.rows)}</span><span class="xs muted">${s.status}${s.pages ? ` · ${s.pages} pages` : ''}${s.ms ? ` · ${(s.ms / 1000).toFixed(1)}s` : ''}${s.detail ? ` · ${s.detail}` : ''}</span></div>`)}`);
  }
  function quality(st) {
    const d = st.data;
    if (!d) { mount($('#l-quality', el), html`<p class="small muted">Available after the first pull.</p>`); return; }
    const dropped = Object.values(d.drops).reduce((a, b) => a + b, 0);
    mount($('#l-quality', el), html`<dl class="kv">
      <dt>Form 4 rows received</dt><dd>${fmtInt(d.rawCounts.insider)}</dd>
      <dt>Congress rows received</dt><dd>${fmtInt(d.rawCounts.congress)}</dd>
      <dt>Tickers in Congress aggregates</dt><dd>${fmtInt(d.rawCounts.aggregate)}</dd>
      <dt>Rows kept for scoring</dt><dd>${fmtInt(d.insiderBuys.length + d.congressRows.length)}</dd>
      <dt>Rows dropped</dt><dd>${fmtInt(dropped)}</dd>
      ${Object.entries(d.drops).filter(([, v]) => v).map(([k, v]) => html`<dt class="dim">· ${DROP_LABEL[k] || k}</dt><dd class="dim">${fmtInt(v)}</dd>`)}
      <dt>Form 4 coverage</dt><dd class="${d.coverage.insider ? 'status-ok' : 'status-err'}">${d.coverage.insider ? 'complete' : 'page limit hit'}</dd>
      <dt>Congress coverage</dt><dd class="${d.coverage.congress ? 'status-ok' : 'status-err'}">${d.coverage.congress ? 'complete' : 'page limit hit'}</dd>
      <dt>Window</dt><dd>${d.from} → ${d.asOf}</dd></dl>`);
  }
  function caps(st) {
    const c = st.caps;
    const row = (k, v, note) => html`<dt>${k}</dt><dd class="${v === 'on' ? 'status-ok' : v === 'off' ? 'status-err' : 'status-pend'}">${v}${note ? html` <span class="dim">${note}</span>` : ''}</dd>`;
    mount($('#l-caps', el), html`<dl class="kv">
      <dt>App</dt><dd>${APP.name} ${APP.version}</dd>
      <dt>Model</dt><dd>${APP.model} · ${st.model.preset}</dd>
      ${row(`Connector (${SERVER})`, c.mcp)}
      ${row('Claude (memos, brief)', c.sample)}
      ${row('Workspace sync', c.db, ctx.workspace.mode)}
      ${row('File export', c.downloads)}
      <dt>Cache policy</dt><dd>5 min fresh · 1 h kept</dd>
      <dt>Concurrency</dt><dd>4 requests</dd></dl>`);
  }
  function log() {
    const rows = conn.log.slice(0, 200);
    $('#l-count', el).textContent = `${fmtInt(conn.log.length)} requests`;
    mount($('#l-log', el), rows.length ? html`<div class="table-wrap" style="max-height:520px"><table class="grid"><thead><tr><th>Time</th><th>Stage</th><th>Tool</th><th>Arguments</th><th class="num">Rows</th><th class="num">ms</th><th>Cache</th><th>Status</th></tr></thead><tbody>
      ${rows.map(r => html`<tr><td class="mono xs nowrap">${fmtClock(r.at)}</td><td class="xs">${r.stage}</td><td class="mono xs">${r.tool}</td><td class="code" style="max-width:420px">${JSON.stringify(r.input)}</td><td class="num">${r.status === 'ok' ? fmtInt(r.rows) : ''}${r.truncated ? html` <span class="flag" data-tone="warn" data-tip="Server truncated this response; paging continued from where it stopped">trunc</span>` : ''}</td><td class="num">${r.ms || ''}</td><td class="xs">${r.cached ? 'hit' : r.status === 'ok' ? 'miss' : ''}</td><td class="xs ${r.status === 'ok' ? 'status-ok' : r.status === 'error' ? 'status-err' : 'status-pend'}">${r.status}${r.code ? ` · ${r.code}` : ''}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><span>No requests yet.</span></div>`);
  }

  let pendingLog = false;
  conn.onLog(() => {
    if (el.hidden || pendingLog) return;
    pendingLog = true;
    requestAnimationFrame(() => { pendingLog = false; log(); });
  });

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      const has = k => !changed || changed.includes(k);
      if (has('pipeline')) stages(st);
      if (has('data')) quality(st);
      if (has('caps') || has('model')) caps(st);
      if (!changed) log();
    }
  };
}
