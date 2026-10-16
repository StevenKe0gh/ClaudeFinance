import { html, patch } from '../ui/html.js';
import { tierChip, partyChip } from '../ui/parts.js';
import { fmtUSD, fmtDate, cleanCompany } from '../core/util.js';
import { brand, nameOf } from '../ui/brand.js';
import { buyOf, buyChip, brokerSettings } from '../ui/brokers.js';
import { BROKERS, notBuyable } from '../model/brokers.js';
import { signalLine } from '../model/cards.js';
import { FAMILY_STAKES } from '../data/families.js';

/**
 * Front page: what Paper Trail does and today's strongest findings, from live
 * data when the viewer has the Quiver connector, else from the last saved run,
 * so a first visit never lands on an empty screen.
 */
export function createHomeView(ctx) {
  const { store, congress } = ctx;
  const el = document.createElement('section');
  el.className = 'view home';
  el.id = 'v-home';

  /** Strongest buyable signals: live, else the latest saved snapshot's cards. */
  function topSignals(st, buy) {
    if (st.signals.length) {
      return { live: true, asOf: st.data?.asOf, rows: st.signals.filter(s => (s.tier === 'A' || s.tier === 'B') && !notBuyable(buy(s.ticker, s.company))).slice(0, 6).map(s => ({ ticker: s.ticker, company: s.company, tier: s.tier, score: s.score, line: signalLine(s) })) };
    }
    const snap = [...(st.cloud?.snapshots || [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!snap) return null;
    const rows = snap.cards
      ? snap.cards.map(([ticker, company, tier, score, line]) => ({ ticker, company, tier, score, line }))
      : (snap.top || []).filter(([, , t]) => t === 'A' || t === 'B').map(([ticker, score, tier]) => ({ ticker, company: '', tier, score, line: '' }));
    return { live: false, asOf: snap.date, rows: rows.filter(r => !notBuyable(buy(r.ticker, r.company))).slice(0, 6) };
  }

  function render() {
    const st = store.get();
    const live = st.caps.mcp === 'on';
    const buy = buyOf(st);
    const brokers = brokerSettings(st).use.map(b => BROKERS[b].short).join(' and ');
    const sig = topSignals(st, buy);
    const sen = congress.chambers.Senate.current();
    const hou = congress.chambers.House.current();
    const tr = congress.trump.current();
    const held = (cur, n) => (cur ? cur.data.stocks.filter(x => !notBuyable(buy(x.ticker, x.company))).slice(0, n) : []);
    const trumpBuys = tr ? tr.data.stocks.filter(x => x.net > 0).slice(0, 4) : [];

    patch(el, html`
      <div class="home-hero">
        <h1>Follow the money into the market.</h1>
        <p>Paper Trail reads what company insiders, members of Congress, the best hedge funds and the President's family disclose about their trades, ranks the strongest buying, and keeps only stocks you can buy at ${brokers}.</p>
        <div class="home-cta">
          <button class="btn primary" type="button" data-nav="radar">Open today's radar</button>
          <button class="btn" type="button" data-nav="congress">What Congress holds</button>
          <button class="btn" type="button" data-nav="families">Trump and Kushner</button>
          <button class="btn ghost" type="button" data-brokers>Choose your brokers</button>
        </div>
        ${live ? '' : html`<p class="home-note small">You are seeing the latest saved run. Live filings, the AI analyst and your own plan need this page opened on claude.ai with the Quiver Quant connector.</p>`}
      </div>

      <div class="home-grid">
        <section class="panel home-card span-2"><div class="panel-h"><h2>Strongest buying right now</h2><span class="grow"></span><span class="src">${sig ? `${sig.live ? 'live' : 'saved'} · ${fmtDate(sig.asOf)}` : ''}</span></div>
          <div class="panel-b">${sig && sig.rows.length ? html`<ul class="home-sig">${sig.rows.map(r => html`<li><button class="home-row" type="button" data-open="${r.ticker}">${tierChip(r.tier)}<span class="home-co">${brand(r.ticker, { name: nameOf(r.ticker, cleanCompany(r.company)), open: false })}</span><span class="small muted home-line">${r.line}</span>${buyChip(buy(r.ticker, r.company), { label: false })}</button></li>`)}</ul>` : html`<p class="small muted">The first run fills this in.</p>`}</div></section>

        <section class="panel home-card"><div class="panel-h"><h2>Most held in Congress</h2><span class="grow"></span><button class="linkish xs" type="button" data-nav="congress">All →</button></div>
          <div class="panel-b">${sen || hou ? html`<ul class="home-held">${[['Senate', sen], ['House', hou]].filter(([, c]) => c).map(([ch, c]) => html`<li class="home-sub">${ch}</li>${held(c, 4).map(x => html`<li><button class="home-row" type="button" data-open="${x.ticker}">${brand(x.ticker, { name: nameOf(x.ticker, cleanCompany(x.company)), open: false })}<span class="home-pp">${x.parties.R ? html`${partyChip('R')}<span class="mono xs">${x.parties.R}</span>` : ''}${x.parties.D ? html`${partyChip('D')}<span class="mono xs">${x.parties.D}</span>` : ''}</span></button></li>`)}`)}</ul>` : html`<p class="small muted">Estimated from Senate and House trade disclosures once the page has run with the connector.</p>`}</div></section>

        <section class="panel home-card"><div class="panel-h"><h2>President's accounts buying</h2><span class="grow"></span><button class="linkish xs" type="button" data-nav="families">More →</button></div>
          <div class="panel-b">${trumpBuys.length ? html`<ul class="home-held">${trumpBuys.map(x => html`<li><button class="home-row" type="button" data-open="${x.ticker}">${brand(x.ticker, { name: nameOf(x.ticker, x.name), open: false })}<span class="mono small pos">+${fmtUSD(x.net)}</span></button></li>`)}</ul><p class="xs muted">Net purchases since ${fmtDate(tr.from)}, from his STOCK Act reports. Outside managers run the accounts.</p>` : html`<p class="small muted">Plus ${FAMILY_STAKES.length} family stakes and roles, from Trump Media to Affinity Partners.</p>`}</div></section>
      </div>

      <section class="home-how">
        <h2>How it works</h2>
        <ol>
          <li><b>Collect.</b> Insider purchases (SEC Form 4), congressional trades (STOCK Act), 13F filings of the top funds, lobbying, federal contracts and new bills.</li>
          <li><b>Rank.</b> A transparent score weights who bought, how much, how recently and whether a member's committee oversees the company.</li>
          <li><b>Filter.</b> US funds and ETFs that EU retail clients cannot buy drop out, and each stock shows whether ${brokers} likely carry it.</li>
          <li><b>Explain.</b> A morning brief and an AI analyst say what changed, what to discount and how it touches your depot.</li>
        </ol>
        <p class="xs muted">Research aid, not investment advice. Filings show what people did, not why. Sources: SEC EDGAR, Senate and House disclosures, USAspending and Congress.gov, via Quiver Quant.</p>
      </section>`);
  }

  return {
    el,
    render(st, changed) {
      if (el.hidden) return;
      if (!changed || changed.some(k => ['signals', 'cloud', 'caps', 'workspace', 'holdSenate', 'holdHouse', 'trump'].includes(k))) render();
    }
  };
}
