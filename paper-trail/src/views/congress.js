import { html, patch, on } from '../ui/html.js';
import { kpi, errorAlert, partyChip } from '../ui/parts.js';
import { fmtUSD, fmtInt, fmtDate, cleanCompany } from '../core/util.js';
import { brand, nameOf } from '../ui/brand.js';
import { buyOf, buyChip } from '../ui/brokers.js';
import { notBuyable } from '../model/brokers.js';
import { SEATS } from '../core/committees.js';
import { CHAMBERS } from '../app/congress.js';
import { influenceChart } from '../ui/influence.js';

const PARTY = { all: 'All', R: 'Republicans', D: 'Democrats' };
const ACTION = { buy: 'bought', trim: 'sold part', exit: 'sold all' };
const SHOWN = 40;

/** What sitting members of Congress most likely hold, ranked by how many of them hold it. */
export function createCongressView(ctx) {
  const { store, congress } = ctx;
  const el = document.createElement('section');
  el.className = 'view';
  el.id = 'v-congress';
  let chamber = 'Senate';
  let party = 'all';
  let buyableOnly = true;
  let more = false;

  const loader = () => congress.chambers[chamber];

  /** Lobbying against holdings for the 30 stocks Congress holds most, both chambers together. */
  function influencePanel(st) {
    const I = congress.influence;
    const cur = I.current();
    const s = I.status();
    const insiders = new Set(st.signals.filter(x => x.insider && x.insider.buyers && x.insider.buyers.length).map(x => x.ticker));
    const both = congress.chambers.Senate.current() && congress.chambers.House.current();
    const body = cur ? influenceChart(cur.data, { insiders })
      : s.status === 'error' && s.error?.code !== 'not_ready' ? errorAlert(s.error)
      : html`<p class="small muted">${st.caps.mcp === 'on' ? (both ? 'Looking up lobbying and federal awards for the 30 most-held stocks…' : 'Drawn once both chambers are loaded.') : 'Appears once the page has been opened with the Quiver Quant connector.'}</p><div class="skel" style="height:160px"></div>`;
    return html`<section class="panel"><div class="panel-h"><h2>Influence map</h2><span class="grow"></span><span class="src">${cur ? `${cur.source === 'live' ? 'live' : 'saved'} · ${fmtDate(cur.asOf)} · lobbying and awards via Quiver` : ''}</span></div>
      <div class="panel-b"><p class="small muted if-lead">The 30 stocks members of Congress hold most, Senate and House together. Further right, the company spends more on lobbying; higher up, more members own it; bigger, it won more federal money. Top right is where ownership and influence meet.</p>${body}</div></section>`;
  }

  function maybeInfluence() {
    if (congress.chambers.Senate.current() && congress.chambers.House.current()) congress.influence.load();
  }

  function render() {
    const st = store.get();
    const L = loader();
    const cfg = CHAMBERS[chamber];
    const cur = L.current();
    const s = L.status();
    const live = st.caps.mcp === 'on';
    const buy = buyOf(st);
    const people = chamber === 'Senate' ? 'senators' : 'representatives';
    const head = html`<div class="view-h"><div><h1>Congress holdings</h1><p>What sitting ${people} most likely own today, estimated from every stock trade they disclosed ${cfg.since}. A stock counts as held when a member, a spouse or a child bought it and has not reported selling all of it since.</p></div>
      <div class="tools"><div class="seg" role="group" aria-label="Chamber">${Object.keys(CHAMBERS).map(k => html`<button type="button" data-cg-chamber="${k}" aria-pressed="${k === chamber}">${k}</button>`)}</div>
      <div class="seg" role="group" aria-label="Party">${Object.entries(PARTY).map(([k, v]) => html`<button type="button" data-cg-party="${k}" aria-pressed="${k === party}">${v}</button>`)}</div>
      <label class="check"><input type="checkbox" id="cg-buyable" ${buyableOnly ? 'checked' : ''}> Only stocks I can buy</label>
      ${live ? html`<button class="btn ghost sm" type="button" id="cg-refresh" ${s.status === 'loading' ? 'disabled' : ''}>Refresh</button>` : ''}</div></div>`;

    if (!cur) {
      const body = s.status === 'error' ? errorAlert(s.error)
        : live ? html`<div class="panel"><div class="panel-b"><p class="small muted">Reading every ${chamber} trade disclosed ${cfg.since} from Quiver. ${chamber === 'House' ? 'The House files thousands a month, so this takes up to a minute' : 'Usually 15 to 40 seconds'}; after that the estimate is saved for the day.</p><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>`
        : html`<div class="panel"><div class="empty"><h3>No estimate saved yet</h3><span>It appears once the page has been opened with the Quiver Quant connector.</span></div></div>`;
      patch(el, html`${head}${body}`);
      return;
    }

    const all = cur.data.stocks;
    const byParty = party === 'all' ? all : all.map(x => {
      const holders = x.holders.filter(h => h.party === party);
      const count = x.parties[party] || 0;
      return count ? { ...x, holders, count, cost: holders.reduce((a, h) => a + h.cost, 0) } : null;
    }).filter(Boolean).sort((a, b) => b.count - a.count || b.cost - a.cost);
    const rows = buyableOnly ? byParty.filter(x => !notBuyable(buy(x.ticker, x.company))) : byParty;
    const hidden = byParty.length - rows.length;
    const top = rows[0];
    const both = all.filter(x => x.parties.D && x.parties.R).length;
    const max = Math.max(1, ...rows.map(x => x.count));
    const shown = more ? rows : rows.slice(0, SHOWN);
    const startYear = cur.from.slice(0, 4);

    patch(el, html`${head}
      <div class="kpis k4">
        ${kpi(`${chamber === 'Senate' ? 'Senators' : 'Representatives'} with stock positions`, fmtInt(cur.data.members), `of ${SEATS[chamber]} seats, from disclosed trades`)}
        ${kpi('Stocks held', fmtInt(all.length), `by at least one sitting ${cfg.member}`)}
        ${kpi('Most widely held', top ? nameOf(top.ticker, cleanCompany(top.company)) : '—', top ? `${top.count} ${top.count > 1 ? people : cfg.member}${party !== 'all' ? ` (${PARTY[party]})` : ''}` : '')}
        ${kpi('Held across the aisle', fmtInt(both), 'stocks held by both parties')}
      </div>
      ${s.status === 'error' ? errorAlert(s.error) : ''}
      ${influencePanel(st)}
      <section class="panel"><div class="panel-h"><h2>Most held in the ${chamber}</h2><span class="grow"></span><span class="src">${cur.source === 'live' ? `live · trades to ${fmtDate(cur.asOf)}` : `saved estimate · ${fmtDate(cur.asOf)}`}${s.status === 'loading' ? ' · refreshing…' : ''}</span></div>
        <div class="panel-b flush"><div class="sn-list" role="list">
          <div class="sn-row sn-headrow" aria-hidden="true"><span class="sn-n">#</span><span>Company</span><span>Members</span><span class="num">Put in, est.</span><span class="num">90 days</span><span>Latest</span><span>Buy</span></div>
          ${shown.map((x, i) => {
            const av = buy(x.ticker, x.company);
            const rest = x.count - x.holders.length;
            return html`<details class="sn-item" data-key="${`cg-${chamber}-${x.ticker}`}" role="listitem"><summary class="sn-row">
              <span class="sn-n mono">${i + 1}</span>
              <span class="sn-co">${brand(x.ticker, { name: nameOf(x.ticker, cleanCompany(x.company)) })}</span>
              <span class="sn-who"><b class="mono">${x.count}</b><span class="sn-track"><span class="sn-bar" style="${`--w:${(100 * x.count) / max}%`}" data-tip="${`${x.parties.R} Republican · ${x.parties.D} Democrat${x.parties.I ? ` · ${x.parties.I} independent` : ''}`}"><i data-p="R" style="${`flex:${party === 'D' ? 0 : x.parties.R}`}"></i><i data-p="D" style="${`flex:${party === 'R' ? 0 : x.parties.D}`}"></i><i data-p="I" style="${`flex:${party === 'all' ? x.parties.I : 0}`}"></i></span></span></span>
              <span class="num mono">${x.cost ? fmtUSD(x.cost) : '—'}</span>
              <span class="num mono sn-flow">${x.recent.buys || x.recent.sells ? html`<span class="pos">+${x.recent.buys}</span> / <span class="neg">−${x.recent.sells}</span>` : html`<span class="dim">—</span>`}</span>
              <span class="small muted sn-last">${x.last ? `${x.last.name} ${ACTION[x.last.kind]} · ${fmtDate(x.last.date, { year: false })}` : ''}</span>
              <span>${buyChip(av, { label: false })}</span>
            </summary>
            <ul class="sn-holders">${x.holders.map(h => html`<li>${partyChip(h.party)}<button class="linkish" type="button" data-member="${h.filer || h.name}" data-bioguide="${h.bioguide}">${h.name}</button><span class="small muted">${h.since ? `first bought ${fmtDate(h.since)}` : `owned before ${startYear}`}</span><span class="small mono">${h.known && h.cost ? `~${fmtUSD(h.cost)} put in` : 'size unknown'}</span><span class="small muted">last ${ACTION[h.last.kind]} ${fmtDate(h.last.date)}</span></li>`)}
              ${rest > 0 ? html`<li class="sn-open small muted">and ${rest} more</li>` : ''}
              <li class="sn-open"><button class="linkish xs" type="button" data-open="${x.ticker}">Open the dossier for ${nameOf(x.ticker, cleanCompany(x.company))} →</button></li></ul>
            </details>`;
          })}
        </div>
        ${rows.length > SHOWN ? html`<div class="sn-foot"><button class="btn ghost sm" type="button" id="cg-more">${more ? 'Show fewer' : `Show all ${fmtInt(rows.length)}`}</button></div>` : ''}
        </div></section>
      <p class="xs muted sn-note">Members disclose trades within 45 days in dollar ranges, not their portfolios, so this is an estimate. Amounts are what went in at the midpoint of each range, not today's value. Stocks bought before ${startYear} and not traded since do not appear; a partial sale with no earlier purchase marks a stock owned before the window, size unknown.${chamber === 'House' ? ' A few members run managed accounts that trade hundreds of stocks; each still counts once per stock.' : ''} Index funds and bonds without a ticker are left out.${buyableOnly && hidden ? ` ${hidden} stock${hidden > 1 ? 's' : ''} you cannot buy at your brokers ${hidden > 1 ? 'are' : 'is'} hidden.` : ''} Source: ${chamber} periodic transaction reports via Quiver Quant.</p>`);
  }

  on(el, 'click', '[data-cg-chamber]', (_, b) => { chamber = b.dataset.cgChamber; more = false; render(); loader().load(); });
  on(el, 'click', '[data-cg-party]', (_, b) => { party = b.dataset.cgParty; render(); });
  on(el, 'change', '#cg-buyable', (_, c) => { buyableOnly = c.checked; render(); });
  on(el, 'click', '#cg-more', () => { more = !more; render(); });
  on(el, 'click', '#cg-refresh', () => { loader().load({ refresh: true }); congress.influence.load({ refresh: true }); });

  return {
    el,
    show() { congress.chambers.Senate.load(); congress.chambers.House.load(); maybeInfluence(); },
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || changed.some(k => ['holdSenate', 'holdHouse', 'influence', 'cloud', 'caps', 'workspace', 'signals'].includes(k))) render();
      if (changed && changed.includes('caps') && st.caps.mcp === 'on') { congress.chambers.Senate.load(); congress.chambers.House.load(); }
      if (changed && changed.some(k => ['holdSenate', 'holdHouse', 'cloud'].includes(k))) maybeInfluence();
    }
  };
}
