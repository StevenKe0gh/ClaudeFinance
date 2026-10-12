/**
 * Can the investor actually buy it? An estimate per broker for a German
 * retail account, from what the page knows about a US ticker (exchange
 * listing, name, sector, market value), overridden by what the investor has
 * confirmed in their own broker app. No broker publishes its instrument list
 * in a form this page can read, so everything not confirmed is an estimate.
 */

export const BROKERS = Object.freeze({
  scalable: { label: 'Scalable Capital', short: 'Scalable', venue: 'gettex and Xetra' },
  traderepublic: { label: 'Trade Republic', short: 'Trade Republic', venue: 'LS Exchange' },
  revolut: { label: 'Revolut', short: 'Revolut', venue: 'US exchanges' }
});
export const DEFAULT_BROKERS = ['scalable', 'traderepublic'];

export const BUY = Object.freeze({
  yes: { rank: 4, label: 'You confirmed it', short: 'Confirmed' },
  likely: { rank: 3, label: 'Likely buyable', short: 'Likely' },
  maybe: { rank: 2, label: 'Uncertain', short: 'Check' },
  unlikely: { rank: 1, label: 'Unlikely', short: 'Unlikely' },
  no: { rank: 0, label: 'Not buyable', short: 'Not buyable' }
});

const ETF = /\b(etf|etn|spdr|ishares|vanguard|proshares|direxion|invesco qqq|global x|index fund)\b/i;
const FUND = /\bfund\b/i;
const LENDER = /\b(bdc|lending)\b/i;
const SPAC = /\bacquisition (corp|corporation|company|co)\b|\bspac\b/i;
const FUND_INDUSTRY = /investors services|investment managers|trusts except|^$/i;
const PARTNERSHIP = /\bpartners\b|\bl\.?p\.?$/i;

/**
 * What kind of security this is, as far as the name and listing tell.
 * @param {{listed:boolean, name?:string, sector?:string, industry?:string, quiverName?:string}} info
 */
export function classify({ listed, name = '', sector = '', industry = '', quiverName = '' }) {
  const n = `${name} ${quiverName}`;
  if (ETF.test(n)) return 'etf';
  if (LENDER.test(n)) return 'bdc';
  if (FUND.test(name || quiverName)) return 'fund';
  if (/\btrust\b/i.test(name) && FUND_INDUSTRY.test(industry) && !/real estate/i.test(sector)) return 'trust';
  if (SPAC.test(n)) return 'spac';
  if (PARTNERSHIP.test(name) && /energy|utilit|oil|gas|pipeline/i.test(`${sector} ${industry}`)) return 'partnership';
  if (!listed) return 'unlisted';
  return 'stock';
}

const capText = m => (m >= 1e6 ? `$${(m / 1e6).toFixed(1)}T` : m >= 1000 ? `$${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}B` : `$${Math.round(m)}M`);

/** Estimate for one broker. `capM` is market value in millions of dollars, or null. */
export function estimate(broker, kind, capM) {
  switch (kind) {
    case 'etf': return { status: 'no', reason: 'US-listed ETF: without an EU key information document (PRIIPs) EU brokers cannot sell it to retail clients' };
    case 'fund': return { status: 'no', reason: 'US closed-end fund: EU PRIIPs rules block retail purchases' };
    case 'trust': return { status: 'unlikely', reason: 'Looks like a US fund or trust, which EU brokers usually cannot offer retail clients' };
    case 'bdc': return { status: 'maybe', reason: 'Business development company: some EU brokers block these as funds' };
    case 'spac': return { status: 'unlikely', reason: 'SPAC shell: rarely tradable on German venues before a merger' };
    case 'partnership': return { status: 'maybe', reason: 'US partnership (MLP): many brokers restrict these since the 2023 US withholding rule on their sales' };
    case 'unlisted': return broker === 'revolut'
      ? { status: 'no', reason: 'Not listed on NYSE or Nasdaq; Revolut trades only US-exchange stocks' }
      : { status: 'unlikely', reason: 'Not listed on NYSE or Nasdaq (OTC or a foreign line); German venues rarely carry these' };
    default: break;
  }
  const known = Number.isFinite(capM) && capM > 0;
  if (broker === 'revolut') {
    if (!known) return { status: 'maybe', reason: 'No market value on file; Revolut carries a curated list of mostly large US companies' };
    if (capM >= 10000) return { status: 'likely', reason: `Large US-listed company (${capText(capM)}); Revolut carries most of these` };
    if (capM >= 2000) return { status: 'maybe', reason: `Mid-size company (${capText(capM)}); Revolut's US list is curated, check the app` };
    return { status: 'unlikely', reason: `Smaller company (${capText(capM)}); Revolut's US list rarely reaches this far down` };
  }
  if (!known) return { status: 'maybe', reason: 'No market value on file; check the app' };
  if (capM >= 300) return { status: 'likely', reason: `US-listed company worth ${capText(capM)}; German venues carry nearly all of these` };
  if (capM >= 50) return { status: 'maybe', reason: `Small company (${capText(capM)}); German venues carry some` };
  return { status: 'unlikely', reason: `Micro cap (${capText(capM)}); rarely on German venues` };
}

/**
 * Availability across the investor's brokers. A confirmation in `marks`
 * (ticker → broker → true | false) beats any estimate; the overall status is
 * the best one among the brokers in use.
 */
export function availability(ticker, { use = DEFAULT_BROKERS, marks = {}, info }) {
  const kind = classify(info);
  const per = {};
  for (const b of use) {
    const m = marks[ticker] ? marks[ticker][b] : undefined;
    per[b] = m === true ? { status: 'yes', reason: 'You confirmed you can buy it here', confirmed: true }
      : m === false ? { status: 'no', reason: 'You marked it as not available here', confirmed: true }
      : { ...estimate(b, kind, info.capM), confirmed: false };
  }
  let best = null;
  for (const b of use) if (!best || BUY[per[b].status].rank > BUY[per[best].status].rank) best = b;
  const status = best ? per[best].status : 'maybe';
  return { ticker, kind, status, best, per, where: use.filter(b => per[b].status === status) };
}

/** True when a ticker should leave suggestions (radar, plan ideas, briefs). */
export const notBuyable = av => av.status === 'no';
/** True when the estimate is weak enough to warn before adding to a plan. */
export const doubtful = av => av.status === 'no' || av.status === 'unlikely';
