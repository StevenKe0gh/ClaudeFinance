import { groupBy, median } from '../core/util.js';

/**
 * Pattern detection on one ticker's insider purchases. These separate
 * discretionary open-market buying (informative) from mechanical buying
 * (offerings, purchase plans, tender prices), which looks similar in Form 4
 * data but says little about what insiders expect.
 */
export function insiderPatterns(buys) {
  const owners = new Set(buys.map(b => b.owner));
  const cents = p => Math.round(p * 100);

  // Several insiders on the same day at the identical price: an offering or
  // private placement allocation, not individual market orders.
  let placement = false;
  for (const g of groupBy(buys, b => `${b.date}|${cents(b.price)}`).values()) {
    const n = new Set(g.map(b => b.owner)).size;
    const round = cents(g[0].price) % 100 === 0;
    const usd = g.reduce((s, b) => s + b.value, 0);
    const sameLot = n >= 2 && new Set(g.map(b => b.shares)).size === 1;
    if (n >= 3 || (n >= 2 && (round || usd >= 5e6 || sameLot))) { placement = true; break; }
  }

  // One buyer, many lines, several days, one price: a tender or fixed-price deal.
  let fixedPrice = false;
  for (const g of groupBy(buys, b => b.owner).values()) {
    const days = new Set(g.map(b => b.date)).size;
    const modal = Math.max(...[...groupBy(g, b => cents(b.price)).values()].map(x => x.length));
    if (g.length >= 3 && days >= 2 && modal / g.length >= 0.8) { fixedPrice = true; break; }
  }

  // Many small, uniform purchases: employee or director purchase programs.
  const perOwner = [...groupBy(buys, b => b.owner).values()].map(g => g.reduce((s, b) => s + b.value, 0));
  const programmatic =
    (owners.size >= 8 && (median(perOwner) ?? 0) < 15000) ||
    (buys.length >= 10 && (median(buys.map(b => b.value)) ?? 0) < 5000);

  // Repeated buys at changing prices across days: someone working an order.
  const accumulating = [];
  for (const [owner, g] of groupBy(buys, b => b.owner)) {
    const days = new Set(g.map(b => b.date)).size;
    const lo = Math.min(...g.map(b => b.price));
    const hi = Math.max(...g.map(b => b.price));
    if (days >= 3 && lo > 0 && (hi - lo) / lo > 0.01) accumulating.push(owner);
  }

  // A buyer multiplying their holding (>400%) with $1M+: conversions and
  // placements look like this; open-market buyers rarely do.
  const stakeJump = [...groupBy(buys, b => b.owner).values()].some(g =>
    g.reduce((s, b) => s + b.value, 0) >= 1e6 && g.some(b => b.stakePct != null && b.stakePct > 400));

  return {
    placement,
    stakeJump,
    fixedPrice,
    programmatic,
    accumulating,
    lateForm4: buys.filter(b => b.lateDays != null && b.lateDays > 4).length,
    newPositions: new Set(buys.filter(b => b.newPosition).map(b => b.owner)).size
  };
}
