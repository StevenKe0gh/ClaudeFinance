import { html, patch, on } from '../ui/html.js';
import { kpi, errorAlert } from '../ui/parts.js';
import { fmtUSD, fmtInt, fmtDate } from '../core/util.js';
import { brand, nameOf } from '../ui/brand.js';
import { buyOf, buyChip } from '../ui/brokers.js';
import { FAMILY_STAKES, FAMILY_ASOF } from '../data/families.js';
import { TRUMP_FROM } from '../app/congress.js';

const usd = v => fmtUSD(Math.abs(v));

/** Where the President's accounts trade, and the companies the Trump and Kushner families hold or help run. */
export function createFamiliesView(ctx) {
  const { store, congress } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-families';

  function stakesPanel(st) {
    const buy = buyOf(st);
    const fam = f => FAMILY_STAKES.filter(x => x.family === f);
    const row = x => html`<tr>
      <td>${x.ticker ? brand(x.ticker, { name: nameOf(x.ticker, x.company) }) : html`<span class="t1">${x.company}</span>`}</td>
      <td class="small">${x.who}</td>
      <td class="small muted">${x.sector}</td>
      <td class="small">${x.what}</td>
      <td class="small muted nowrap">${x.reported}</td>
      <td>${x.ticker ? buyChip(buy(x.ticker, x.company), { label: false }) : html`<span class="dim xs">not listed in the US</span>`}</td>
      <td class="xs nowrap">${x.src.map(([n, u], i) => html`${i ? ' · ' : ''}<a href="${u}" target="_blank" rel="noopener noreferrer">${n} ↗</a>`)}</td>
    </tr>`;
    return html`<section class="panel"><div class="panel-h"><h2>Family stakes and roles</h2><span class="grow"></span><span class="src">news reports and filings · compiled ${fmtDate(FAMILY_ASOF)}</span></div>
      <div class="panel-b"><p class="small fam-lead"><b>Trump family:</b> crypto and bitcoin (American Bitcoin, World Liberty Financial, Thumzup, Dominari), media (Trump Media) and companies selling to conservative customers (PSQ, GrabAGun), plus drones (Unusual Machines). <b>Kushners:</b> private equity and venture money: a Gulf-backed buyout of Electronic Arts, Israel's Phoenix Financial, AI through Thrive Capital, and Amazon.</p></div>
      <div class="panel-b flush"><div class="table-wrap"><table class="grid fam-table"><thead><tr><th>Company</th><th>Who</th><th>Sector</th><th>Stake or role</th><th>Reported</th><th>Buy</th><th>Source</th></tr></thead>
        <tbody><tr class="fam-group"><td colspan="7">Trump family</td></tr>${fam('Trump').map(row)}<tr class="fam-group"><td colspan="7">Kushner family</td></tr>${fam('Kushner').map(row)}</tbody></table></div></div>
      <div class="panel-b"><p class="xs muted">Reported positions change and some reports are more than a year old; open the source before relying on a figure. Being on a board or advisory board is a role, not necessarily a stake.</p></div></section>`;
  }

  function trumpPanels(st) {
    const L = congress.trump;
    const cur = L.current();
    const s = L.status();
    const live = st.caps.mcp === 'on';
    if (!cur) {
      return s.status === 'error' ? errorAlert(s.error)
        : html`<section class="panel"><div class="panel-h"><h2>President Trump's accounts</h2></div><div class="panel-b">${live ? html`<p class="small muted">Reading his ${fmtInt(5000)}+ disclosed trades since January from Quiver; up to a minute, then saved for the day.</p><div class="skel"></div><div class="skel"></div>` : html`<p class="small muted">Appears once the page has been opened with the Quiver Quant connector.</p>`}</div></section>`;
    }
    const f = cur.data;
    const buy = buyOf(st);
    const sectors = f.sectors.filter(x => x.buy + x.sell > 0);
    const max = Math.max(1, ...sectors.map(x => Math.max(x.buy, x.sell)));
    const ups = f.stocks.filter(x => x.net > 0).slice(0, 12);
    const downs = f.stocks.filter(x => x.net < 0).sort((a, b) => a.net - b.net).slice(0, 12);
    const table = (list, sign) => html`<div class="table-wrap"><table class="grid"><thead><tr><th>Company</th><th class="num">${sign > 0 ? 'Net bought' : 'Net sold'}</th><th class="num">Trades</th><th>Last</th><th>Buy</th></tr></thead><tbody>
      ${list.map(x => html`<tr><td>${brand(x.ticker, { name: nameOf(x.ticker, x.name) })}</td><td class="num mono ${sign > 0 ? 'pos' : 'neg'}">${usd(x.net)}</td><td class="num">${x.n}</td><td class="small muted nowrap">${fmtDate(x.last, { year: false })}</td><td>${buyChip(buy(x.ticker, x.name), { label: false })}</td></tr>`)}
    </tbody></table></div>`;
    return html`
      <div class="kpis k4">
        ${kpi('Disclosed trades', fmtInt(f.total.n), `since ${fmtDate(cur.from)}`)}
        ${kpi('Bought, est.', fmtUSD(f.total.buy), 'range midpoints')}
        ${kpi('Sold, est.', fmtUSD(f.total.sell), 'range midpoints')}
        ${kpi('Latest filing', f.latestFiled ? fmtDate(f.latestFiled) : '—', cur.source === 'live' ? 'live from Quiver' : `saved ${fmtDate(cur.asOf)}`)}
      </div>
      <section class="panel"><div class="panel-h"><h2>President Trump's accounts by sector</h2><span class="grow"></span><span class="src">STOCK Act reports since ${fmtDate(cur.from, { year: false })} · bought vs sold</span></div>
        <div class="panel-b"><div class="fam-bars" role="list">${sectors.map(x => html`<div class="fam-bar" role="listitem" data-tip="${`${x.key}: bought ${fmtUSD(x.buy)}, sold ${fmtUSD(x.sell)} in ${x.n} trades`}">
          <span class="fam-k">${x.key}</span>
          <span class="fam-s"><i style="${`width:${(100 * x.sell) / max}%`}"></i></span>
          <span class="fam-b"><i style="${`width:${(100 * x.buy) / max}%`}"></i></span>
          <span class="fam-n mono ${x.net >= 0 ? 'pos' : 'neg'}">${x.net >= 0 ? '+' : '−'}${usd(x.net)}</span></div>`)}</div>
          <div class="fam-legend xs muted"><span><i class="s"></i>sold</span><span><i class="b"></i>bought</span><span>net on the right</span></div></div></section>
      <div class="dz-grid">
        <section class="panel span-6"><div class="panel-h"><h2>Biggest net purchases</h2></div><div class="panel-b flush">${table(ups, 1)}</div></section>
        <section class="panel span-6"><div class="panel-h"><h2>Biggest net sales</h2></div><div class="panel-b flush">${table(downs, -1)}</div></section>
      </div>
      <p class="xs muted sn-note">The President's stocks, funds and bonds are traded by outside managers; the Trump Organization says neither he nor his family directs the trades or hears of them in advance. Amounts are the midpoints of the disclosed ranges; filings arrive up to 45 days after the trade. Quiver's ticker is replaced by the name for funds and bonds, where it is often wrong.</p>`;
  }

  function render() {
    const st = store.get();
    const live = st.caps.mcp === 'on';
    const s = congress.trump.status();
    patch(el, html`<div class="view-h"><div><h1>Trump and Kushner families</h1><p>Where the President's own accounts are buying and selling, and the companies the Trump and Kushner families hold stakes in or help run.</p></div>
      <div class="tools">${live ? html`<button class="btn ghost sm" type="button" id="fam-refresh" ${s.status === 'loading' ? 'disabled' : ''}>Refresh</button>` : ''}</div></div>
      ${stakesPanel(st)}
      ${trumpPanels(st)}`);
  }

  on(el, 'click', '#fam-refresh', () => congress.trump.load({ refresh: true }));

  return {
    el,
    show() { congress.trump.load(); },
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || changed.some(k => ['trump', 'cloud', 'caps', 'workspace'].includes(k))) render();
      if (changed && changed.includes('caps') && st.caps.mcp === 'on') congress.trump.load();
    }
  };
}
