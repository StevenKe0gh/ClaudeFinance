/**
 * Position sizing under two hard constraints: a cash reserve and a cap per
 * position. Weights come from the chosen method; anything the cap prevents
 * from being invested is reported as idle cash rather than silently spread.
 */

export const METHODS = {
  conviction: { label: 'Conviction-weighted', desc: 'Score above 30, squared: an 80 gets about 2.8× the slice of a 50.' },
  tiered: { label: 'By tier', desc: 'Tier A gets 3 parts, B 2, C 1, D half a part.' },
  equal: { label: 'Equal', desc: 'Same amount in every position.' }
};

const TIER_PARTS = { A: 3, B: 2, C: 1, D: 0.5 };

export function rawWeight(item, method) {
  if (method === 'equal') return 1;
  if (method === 'tiered') return TIER_PARTS[item.tier] ?? 1;
  const s = Math.max(0, (item.score ?? 0) - 30);
  return Math.max(1, s * s);
}

/**
 * @param {{ticker:string, score?:number, tier?:string}[]} items
 * @param {{capital:number, reserve:number, cap:number, method:string}} cfg  reserve/cap in percent
 */
export function allocate(items, { capital, reserve, cap, method }) {
  const investable = Math.max(0, capital * (1 - reserve / 100));
  const maxPos = capital * (cap / 100);
  const w = items.map(it => rawWeight(it, method));
  const alloc = items.map(() => 0);
  let free = items.map((_, i) => i);
  let rem = investable;

  while (free.length && rem > 0.005) {
    const sw = free.reduce((s, i) => s + w[i], 0);
    const over = free.filter(i => (rem * w[i]) / sw > maxPos - alloc[i] + 1e-9);
    if (!over.length) {
      for (const i of free) alloc[i] += (rem * w[i]) / sw;
      rem = 0;
      break;
    }
    for (const i of over) { rem -= maxPos - alloc[i]; alloc[i] = maxPos; }
    free = free.filter(i => !over.includes(i));
  }

  const amounts = alloc.map(a => Math.floor(a));
  const invested = amounts.reduce((s, a) => s + a, 0);
  const idle = Math.max(0, investable - invested);
  const shares = amounts.map(a => (capital > 0 ? a / capital : 0));
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  return {
    amounts,
    shares,
    invested,
    reserve: capital - investable,
    idle,
    cash: capital - invested,
    maxPos,
    effectiveN: hhi > 0 ? (invested / capital) ** 2 / hhi : 0,
    largest: Math.max(0, ...shares),
    minPositionsForFullInvestment: cap > 0 ? Math.ceil((100 - reserve) / cap - 1e-9) : Infinity
  };
}
