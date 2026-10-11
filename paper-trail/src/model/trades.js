import { dayDiff, groupBy, median, sum } from '../core/util.js';
import { shortInstrument } from './instruments.js';

/**
 * Trade review: behavioural analytics on a broker transaction history plus
 * current positions. Every finding carries its evidence (the trades behind
 * it) and, where it can be measured, a euro impact. Nothing here needs
 * market data beyond the current prices of instruments still held.
 */

/** German capital-gains tax incl. solidarity surcharge, without church tax. */
export const TAX_RATE = 0.26375;
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

/**
 * Savings plans: the same instrument bought for roughly the same amount
 * (±6%) at least twice, with consecutive purchases 20–40 days apart.
 */
export function detectPlans(buys) {
  const plans = [];
  for (const [name, g] of groupBy(buys, b => b.name)) {
    if (g.length < 2) continue;
    const anchor = [...g].sort((a, b) => g.filter(x => near(x.total, b.total, 0.06)).length - g.filter(x => near(x.total, a.total, 0.06)).length)[0];
    const hits = g.filter(x => near(x.total, anchor.total, 0.06)).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (hits.length < 2) continue;
    let cadence = 0;
    for (let i = 1; i < hits.length; i++) { const d = dayDiff(hits[i - 1].date, hits[i].date); if (d >= 20 && d <= 40) cadence++; }
    if (!cadence || new Set(hits.map(h => h.date.slice(0, 7))).size < hits.length) continue;
    plans.push({
      name,
      amount: median(hits.map(h => h.total)),
      count: hits.length,
      day: Math.round(median(hits.map(h => +h.date.slice(8, 10)))),
      first: hits[0].date,
      last: hits[hits.length - 1].date,
      total: sum(hits, h => h.total),
      trades: hits
    });
  }
  return plans.sort((a, b) => b.amount - a.amount);
}

/**
 * @param {object[]} txs        parsed transactions (any order)
 * @param {object[]} positions  current positions with name, price, value, gain, gainPct, alloc, avg
 * @param {object}   opts       { asOf, summary, resolve(name) → {kind} }
 */
export function analyzeTrades(txs, positions = [], { asOf, summary = {}, resolve = () => ({ kind: 'stock' }) } = {}) {
  const tx = [...txs].filter(t => t && t.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const buys = tx.filter(t => t.kind === 'buy' && t.total > 0);
  const sells = tx.filter(t => t.kind === 'sell' && t.total > 0);
  const divs = tx.filter(t => t.kind === 'dividend');
  const held = new Map(positions.map(p => [p.name, p]));
  const from = tx[0]?.date || null;
  const to = tx[tx.length - 1]?.date || null;
  const months = from ? Math.max(1, (dayDiff(from, to) + 1) / 30.4) : 1;

  /* Lines that cannot be right: a sale more than 30% away from every nearby
     trade in the same (non-leveraged) instrument, usually an import gap. */
  const suspects = new Set(sells.filter(s => {
    if (['leveraged', 'derivative'].includes(resolve(s.name, s.assetType).kind)) return false;
    const ref = tx.filter(t => t !== s && t.name === s.name && (t.kind === 'buy' || t.kind === 'sell') && t.price > 0 && Math.abs(dayDiff(t.date, s.date)) <= 30).map(t => t.price);
    return ref.length > 0 && Math.abs(s.price / median(ref) - 1) > 0.3;
  }));

  const plans = detectPlans(buys);
  const planSet = new Set(plans.flatMap(p => p.trades));
  const discBuys = buys.filter(b => !planSet.has(b));

  /* Round trips: a sell preceded by buys of the same instrument within 90 days. */
  const roundTrips = [];
  const whipsaws = [];
  for (const [name, g] of groupBy(tx.filter(t => t.kind === 'buy' || t.kind === 'sell'), t => t.name)) {
    for (let i = 0; i < g.length; i++) {
      const s = g[i];
      if (s.kind !== 'sell' || suspects.has(s)) continue;
      // buy → sell
      const prior = g.slice(0, i).filter(b => b.kind === 'buy' && !planSet.has(b) && dayDiff(b.date, s.date) <= 90);
      let qtyLeft = s.qty || 0;
      for (const b of prior.reverse()) {
        if (qtyLeft <= 1e-9) break;
        const q = Math.min(qtyLeft, b.qty || 0);
        if (q <= 0) continue;
        qtyLeft -= q;
        roundTrips.push({ name, buyDate: b.date, sellDate: s.date, qty: q, buyPrice: b.price, sellPrice: s.price, pnl: (s.price - b.price) * q, pnlPct: (s.price / b.price - 1) * 100, days: dayDiff(b.date, s.date) });
      }
      // sell → rebuy within 21 days
      const rebuy = g.slice(i + 1).find(b => b.kind === 'buy' && !planSet.has(b) && dayDiff(s.date, b.date) <= 21);
      if (rebuy) {
        const q = Math.min(s.qty || 0, rebuy.qty || 0);
        whipsaws.push({ name, sellDate: s.date, sellPrice: s.price, buyDate: rebuy.date, buyPrice: rebuy.price, qty: q, days: dayDiff(s.date, rebuy.date), cost: (rebuy.price - s.price) * q, pct: (rebuy.price / s.price - 1) * 100 });
      }
    }
  }

  /* What happened after each sale, for instruments still held. */
  const afterSale = sells.filter(s => held.has(s.name) && s.price > 0 && !suspects.has(s)).map(s => {
    const now = held.get(s.name).price;
    return { name: s.name, date: s.date, sellPrice: s.price, now, qty: s.qty || 0, pct: (now / s.price - 1) * 100, euros: (now - s.price) * (s.qty || 0) };
  });

  /* Entry quality: return since purchase for buys of instruments still held. */
  const entryReturns = kind => {
    const rows = (kind === 'plan' ? buys.filter(b => planSet.has(b)) : discBuys).filter(b => held.has(b.name) && b.price > 0);
    const w = sum(rows, r => r.total);
    return { n: rows.length, pct: w ? sum(rows, r => r.total * (held.get(r.name).price / r.price - 1)) / w * 100 : null, rows };
  };

  /* Taxes and FIFO drag: tax paid on sales of positions that are now at a loss overall. */
  const taxes = sum(sells, s => s.tax || 0);
  const fifoDrag = sells.filter(s => s.tax > 0 && !suspects.has(s) && held.has(s.name) && held.get(s.name).gainPct <= -10)
    .map(s => ({ name: s.name, date: s.date, tax: s.tax, gainPct: held.get(s.name).gainPct }));

  /* Portfolio shape */
  const total = sum(positions, p => p.value) || summary.depotValue || 0;
  const kinds = positions.map(p => ({ ...p, kind: resolve(p.name, p.type).kind }));
  const fundShare = total ? sum(kinds.filter(p => p.kind === 'etf' || p.kind === 'etc'), p => p.value) / total * 100 : null;
  const tail = positions.filter(p => p.alloc < 1);
  const sorted = [...positions].sort((a, b) => b.alloc - a.alloc);
  const top3 = sum(sorted.slice(0, 3), p => p.alloc);
  const losers = positions.filter(p => p.gainPct != null && p.gainPct <= -15).sort((a, b) => a.gainPct - b.gainPct);
  const winners = positions.filter(p => p.gainPct != null && p.gainPct >= 25).sort((a, b) => b.gainPct - a.gainPct);
  const speculative = tx.filter(t => (t.kind === 'buy' || t.kind === 'sell') && ['leveraged', 'derivative'].includes(resolve(t.name, t.assetType).kind));

  const stats = {
    from, to, months,
    buys: buys.length, sells: sells.length, dividends: divs.length,
    bought: sum(buys, b => b.total), sold: sum(sells, s => s.total), dividendIncome: sum(divs, d => d.total || 0),
    planBuys: planSet.size, discretionaryBuys: discBuys.length,
    discretionaryPerMonth: (discBuys.length + sells.length) / months,
    taxes, estRealizedGain: taxes / TAX_RATE,
    turnoverPct: total ? (sum(sells, s => s.total) / total) * 100 * (12 / months) : null,
    fundShare, top3, tailCount: tail.length, tailPct: sum(tail, p => p.alloc), positions: positions.length,
    entryDiscretionary: entryReturns('disc'), entryPlan: entryReturns('plan')
  };

  /* ---------- Findings ---------- */
  const F = [];
  const eur = v => `€${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  const nm = n => shortInstrument(n);
  const pc = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

  if (plans.length) {
    const monthly = sum(plans.filter(p => dayDiff(p.last, asOf || to) <= 45), p => p.amount);
    F.push({ tone: 'good', key: 'plans', title: `${plans.length} savings plans run like clockwork`, detail: `About ${eur(monthly)} a month goes in automatically (${plans.slice(0, 5).map(p => nm(p.name)).join(', ')}${plans.length > 5 ? ' and more' : ''}). Regular buying at any price is the habit that compounds.`, impact: null, items: plans.map(p => ({ label: p.name, value: `${eur(p.amount)} on day ~${p.day}`, sub: `${p.count} buys since ${p.first}` })) });
  }
  if (fundShare != null && fundShare >= 50) {
    F.push({ tone: 'good', key: 'core', title: `A broad core: ${fundShare.toFixed(0)}% in funds`, detail: `ETFs and ETCs carry most of the portfolio, led by ${nm(sorted[0]?.name)} at ${sorted[0]?.alloc.toFixed(1)}%. Single-stock mistakes cannot sink you.`, impact: null, items: kinds.filter(p => p.kind === 'etf' || p.kind === 'etc').map(p => ({ label: p.name, value: `${p.alloc.toFixed(1)}%`, sub: pc(p.gainPct) })) });
  }
  if (winners.length) {
    F.push({ tone: 'good', key: 'winners', title: `Winners left to run`, detail: `${winners.length} positions are up 25% or more and you kept them: ${winners.slice(0, 4).map(w => `${nm(w.name)} ${pc(w.gainPct)}`).join(', ')}.`, impact: sum(winners, w => w.gain), items: winners.map(w => ({ label: w.name, value: pc(w.gainPct), sub: `${eur(w.gain)} unrealised` })) });
  }
  const goodExits = afterSale.filter(a => a.pct <= -4).sort((a, b) => a.euros - b.euros);
  if (goodExits.length) {
    F.push({ tone: 'good', key: 'exits', title: `Well-timed sales`, detail: `${goodExits.length} sales were followed by further falls, saving about ${eur(-sum(goodExits, a => a.euros))} on the shares sold.`, impact: -sum(goodExits, a => a.euros), items: goodExits.map(a => ({ label: a.name, value: pc(a.pct), sub: `sold ${a.date} at €${a.sellPrice.toFixed(2)}, now €${a.now.toFixed(2)}` })) });
  }
  const goodTrips = roundTrips.filter(r => r.pnl > 0 && r.days <= 30);
  if (goodTrips.length) {
    F.push({ tone: 'good', key: 'quickwins', title: `Quick trades that paid`, detail: `${goodTrips.length} buy-and-sell round trips within a month made ${eur(sum(goodTrips, r => r.pnl))}.`, impact: sum(goodTrips, r => r.pnl), items: goodTrips.map(r => ({ label: r.name, value: pc(r.pnlPct), sub: `${r.buyDate} → ${r.sellDate} (${r.days}d), ${eur(r.pnl)}` })) });
  }

  const badWhips = whipsaws.filter(w => w.cost > 0);
  if (badWhips.length) {
    F.push({ tone: 'bad', key: 'whipsaw', title: `Sold, then bought back higher`, detail: `${badWhips.length} times you sold and re-bought the same stock within three weeks at a higher price. That paid ${eur(sum(badWhips, w => w.cost))} more for the same shares, plus any tax triggered by the sale.`, impact: -sum(badWhips, w => w.cost), items: badWhips.map(w => ({ label: w.name, value: pc(w.pct), sub: `sold ${w.sellDate} at €${w.sellPrice.toFixed(2)}, bought ${w.buyDate} at €${w.buyPrice.toFixed(2)}` })) });
  }
  const badTrips = roundTrips.filter(r => r.pnl < 0 && r.days <= 60);
  if (badTrips.length) {
    F.push({ tone: 'bad', key: 'quicklosses', title: `Short trades that lost`, detail: `${badTrips.length} positions were bought and sold at a loss within two months, ${eur(sum(badTrips, r => r.pnl))} in total. Short holding periods leave no room for a thesis to play out.`, impact: sum(badTrips, r => r.pnl), items: badTrips.sort((a, b) => a.pnl - b.pnl).map(r => ({ label: r.name, value: pc(r.pnlPct), sub: `${r.buyDate} → ${r.sellDate} (${r.days}d), ${eur(r.pnl)}` })) });
  }
  const early = afterSale.filter(a => a.pct >= 8).sort((a, b) => b.euros - a.euros);
  if (early.length) {
    F.push({ tone: 'bad', key: 'early', title: `Sold before a further rise`, detail: `${early.length} sales were followed by gains of 8% or more on stocks you still hold, about ${eur(sum(early, a => a.euros))} left on the table.`, impact: -sum(early, a => a.euros), items: early.map(a => ({ label: a.name, value: pc(a.pct), sub: `sold ${a.date} at €${a.sellPrice.toFixed(2)}, now €${a.now.toFixed(2)}` })) });
  }
  if (losers.length) {
    F.push({ tone: 'bad', key: 'losers', title: `Laggards still in the book`, detail: `${losers.length} positions are down 15% or more: ${losers.slice(0, 4).map(l => `${nm(l.name)} ${pc(l.gainPct)}`).join(', ')}. Decide whether each still has a reason to be held; hope is not one.`, impact: sum(losers, l => l.gain), items: losers.map(l => ({ label: l.name, value: pc(l.gainPct), sub: `${eur(l.gain)} unrealised, ${l.alloc.toFixed(1)}% of depot` })) });
  }
  if (fifoDrag.length) {
    F.push({ tone: 'bad', key: 'fifo', title: `Tax paid on positions that are losing`, detail: `German FIFO taxes the oldest, cheapest lots first. Partial sales of ${[...new Set(fifoDrag.map(f => nm(f.name)))].join(', ')} cost ${eur(sum(fifoDrag, f => f.tax))} in tax although those positions are down overall. The expensive lots you still hold will only realise losses later.`, impact: -sum(fifoDrag, f => f.tax), items: fifoDrag.map(f => ({ label: f.name, value: eur(f.tax), sub: `${f.date}, position now ${pc(f.gainPct)}` })) });
  }
  if (tail.length >= 4) {
    F.push({ tone: 'bad', key: 'tail', title: `${tail.length} positions under 1%`, detail: `Together they are ${stats.tailPct.toFixed(1)}% of the depot. Even a double in one of them barely moves the total, but each needs watching. Consolidate or size them up deliberately.`, impact: null, items: tail.map(p => ({ label: p.name, value: `${p.alloc.toFixed(2)}%`, sub: pc(p.gainPct) })) });
  }
  if (speculative.length) {
    F.push({ tone: 'watch', key: 'spec', title: `Leveraged and short products`, detail: `${speculative.length} trades in leveraged ETPs or knock-out style certificates. Daily-reset leverage decays in sideways markets; keep these tiny or avoid them.`, impact: null, items: speculative.map(t => ({ label: t.name, value: t.kind === 'buy' ? 'buy' : 'sell', sub: `${t.date} · €${(t.total || 0).toFixed(2)}` })) });
  }
  if (stats.discretionaryPerMonth >= 12) {
    F.push({ tone: 'watch', key: 'activity', title: `High trading activity`, detail: `About ${stats.discretionaryPerMonth.toFixed(0)} discretionary trades a month outside your savings plans, with ${eur(taxes)} tax withheld on sales in this period. Activity is not progress: each trade needs an edge to beat the plan.`, impact: -taxes, items: [] });
  }
  if (stats.entryDiscretionary.pct != null && stats.entryPlan.pct != null) {
    const d = stats.entryDiscretionary.pct - stats.entryPlan.pct;
    F.push({ tone: d >= 0 ? 'good' : 'watch', key: 'entries', title: d >= 0 ? `Discretionary buys beat the plan` : `Discretionary buys trail the plan`, detail: `Stocks you picked yourself are ${pc(stats.entryDiscretionary.pct)} since purchase (money-weighted, ${stats.entryDiscretionary.n} buys) against ${pc(stats.entryPlan.pct)} for plan purchases (${stats.entryPlan.n}).`, impact: null, items: stats.entryDiscretionary.rows.map(r => ({ label: r.name, value: pc((held.get(r.name).price / r.price - 1) * 100), sub: `${r.date} at €${r.price.toFixed(2)}` })) });
  }

  if (suspects.size) {
    F.push({ tone: 'watch', key: 'data', title: `Check ${suspects.size} transaction${suspects.size > 1 ? 's' : ''}`, detail: `These sales sit more than 30% away from every nearby trade in the same stock, which usually means an incomplete bank import (Finanzfluss shows a warning about compensating bookings). They are left out of the findings above.`, impact: null, items: [...suspects].map(s => ({ label: s.name, value: `€${s.price.toFixed(2)}`, sub: `${s.date} · ${s.qty} sh · tax €${(s.tax || 0).toFixed(2)}` })) });
  }

  return { stats, plans, roundTrips, whipsaws, afterSale, fifoDrag, losers, winners, tail, speculative, suspects: [...suspects], findings: F };
}
