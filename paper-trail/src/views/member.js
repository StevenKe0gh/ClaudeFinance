import { html, mount } from '../ui/html.js';
import { tierChip, errorAlert, kpi } from '../ui/parts.js';
import { tri } from '../ui/charts.js';
import { fmtUSD, fmtInt, fmtDate, isoDate, addDays, groupBy, initials, cleanCompany } from '../core/util.js';
import { cleanCongress, partyOf } from '../model/clean.js';
import { brand, nameOf } from '../ui/brand.js';

/** Member of Congress profile: disclosure stats, a year of trades, and overlap with the current signals. */
export function createMemberView(ctx) {
  const { store, quiver } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-member';
  let cur = null;
  let seq = 0;

  async function load(name, bioguide) {
    const my = ++seq;
    cur = { name, bioguide, profile: null, trades: null, err: {} };
    render();
    const asOf = isoDate();
    await Promise.all([
      quiver.politician({ bioguideId: bioguide, name }).then(r => { cur.profile = r.object || r.rows[0] || null; }).catch(e => { cur.err.profile = e; }),
      quiver.memberTrades(name, { from: addDays(asOf, -365) }).then(r => { cur.trades = cleanCongress(r.rows).rows; }).catch(e => { cur.err.trades = e; })
    ]);
    if (my === seq) render();
  }

  function render() {
    if (!cur) {
      mount(el, html`<div class="view-h"><div><h1>Member profile</h1><p>Open a member of Congress from any ledger, inspector or the graph.</p></div></div><div class="panel"><div class="empty"><h3>No member selected</h3><span>Click a member’s name anywhere in the workstation.</span></div></div>`);
      return;
    }
    const p = cur.profile && cur.profile.profile ? cur.profile.profile : null;
    const nw = cur.profile && cur.profile.net_worth;
    const stats = cur.profile && cur.profile.trading_stats;
    const trades = cur.trades || [];
    const party = partyOf(p ? p.party : trades[0]?.party);
    const chamber = trades[0]?.chamber || '';
    const buys = trades.filter(r => r.kind === 'buy');
    const sells = trades.filter(r => r.kind === 'sell');
    const late = trades.filter(r => r.lagDays > 45).length;
    const sigs = new Map(store.get().signals.map(s => [s.ticker, s]));
    const overlap = [...new Set(buys.map(r => r.ticker))].filter(t => sigs.has(t)).map(t => sigs.get(t)).sort((a, b) => b.score - a.score);
    const byTicker = [...groupBy(trades, r => r.ticker)].map(([t, rows]) => ({ t, buys: rows.filter(r => r.kind === 'buy').length, sells: rows.filter(r => r.kind === 'sell').length, usd: rows.filter(r => r.kind === 'buy' && !r.wash).reduce((s, r) => s + r.mid, 0), company: rows[0].company })).sort((a, b) => b.buys - a.buys || b.usd - a.usd).slice(0, 10);
    const loading = !cur.trades && !cur.err.trades;

    mount(el, html`
      <div class="panel"><div class="dz-head">
        <div class="member-h"><span class="avatar">${initials(p ? p.name : cur.name)}</span><div><h1 style="font:600 22px var(--f-ui)">${p ? p.name : cur.name}</h1><div class="small muted">${{ D: 'Democrat', R: 'Republican', I: 'Independent' }[party] || ''}${p && p.state ? ` · ${p.state}` : ''}${chamber ? ` · ${chamber}` : ''}${p && p.bioguide_id ? ` · ${p.bioguide_id}` : ''}</div></div></div>
      </div></div>
      ${cur.err.profile ? errorAlert(cur.err.profile) : ''}
      <div class="kpis">
        ${kpi('Est. net worth', nw ? fmtUSD(nw.current_nw) : '—', nw ? `${fmtUSD(nw.disclosure_change, { sign: true })} since disclosure` : 'from Quiver')}
        ${kpi('Trades, 12 months', loading ? '…' : fmtInt(trades.length), stats ? `${fmtInt(stats.recent_trades)} recent per Quiver` : '')}
        ${kpi('Purchases', loading ? '…' : fmtInt(buys.length), `${fmtUSD(buys.filter(r => !r.wash).reduce((s, r) => s + r.mid, 0))} est.`)}
        ${kpi('Sales', loading ? '…' : fmtInt(sells.length), `${fmtUSD(sells.reduce((s, r) => s + r.mid, 0))} est.`)}
        ${kpi('Late filings', loading ? '…' : fmtInt(late), 'over 45 days')}
        ${kpi('In current signals', loading ? '…' : fmtInt(overlap.length), 'tickers this member bought')}
      </div>
      <div class="dz-grid">
        <section class="panel span-4"><div class="panel-h"><h2>Overlap with signals</h2></div><div class="panel-b">${loading ? html`<div class="skel"></div>` : overlap.length ? html`<ul class="rows">${overlap.map(s => html`<li>${tierChip(s.tier)}<button class="linkish grow t1 mono" type="button" data-open="${s.ticker}">${s.ticker}</button><span class="mono">${s.score}</span></li>`)}</ul>` : html`<p class="small muted">None of this member’s purchases are in the current signal set.</p>`}</div></section>
        <section class="panel span-8"><div class="panel-h"><h2>Most-traded tickers</h2><span class="src">12 months</span></div><div class="panel-b flush">${loading ? html`<div class="panel-b"><div class="skel"></div></div>` : html`<div class="table-wrap"><table class="grid"><thead><tr><th>Company</th><th class="num">Buys</th><th class="num">Sales</th><th class="num">Est. bought</th></tr></thead><tbody>${byTicker.map(r => html`<tr><td>${brand(r.t, { name: nameOf(r.t, cleanCompany(r.company)) })}</td><td class="num">${r.buys}</td><td class="num">${r.sells}</td><td class="num">${fmtUSD(r.usd)}</td></tr>`)}</tbody></table></div>`}</div></section>
        <section class="panel span-12"><div class="panel-h"><h2>Trades</h2><span class="src">House and Senate PTRs · 12 months</span></div><div class="panel-b flush">
          ${cur.err.trades ? html`<div class="panel-b">${errorAlert(cur.err.trades)}</div>` : loading ? html`<div class="panel-b"><div class="skel"></div><div class="skel"></div></div>` : !trades.length ? html`<div class="panel-b"><p class="small muted">No trades with tickers in 12 months.</p></div>` : html`<div class="table-wrap" style="max-height:560px"><table class="grid"><thead><tr><th>Traded</th><th>Ticker</th><th>Trade</th><th>Amount</th><th>Filed</th><th class="num">Days to file</th><th>Owner</th></tr></thead><tbody>
            ${trades.map(r => html`<tr><td class="nowrap">${fmtDate(r.traded)}</td><td><button class="tk" type="button" data-open="${r.ticker}">${r.ticker}</button></td><td><span class="side">${r.kind === 'buy' ? tri('buy', 4) : r.kind === 'sell' ? tri('sell', 4) : ''}${r.transaction}</span></td><td class="mono small nowrap">${r.amount}</td><td class="nowrap">${fmtDate(r.filed)}</td><td class="num ${r.lagDays > 45 ? 'status-err' : ''}">${r.lagDays ?? '—'}</td><td class="small muted">${r.owner || '—'}</td></tr>`)}
          </tbody></table></div>`}
        </div></section>
      </div>`);
  }

  return {
    el,
    open({ name, bioguide }) { if (name && (!cur || cur.name !== name)) load(name, bioguide); else render(); },
    render(st, changed) { if (cur && !el.hidden && changed && changed.includes('signals')) render(); },
    current: () => cur && cur.name
  };
}
