import { TOOLS, PAGE } from '../core/config.js';
import { addDays } from '../core/util.js';

/**
 * Typed fetchers for the Quiver datasets the workstation uses. Each returns
 * raw rows; cleaning and classification live in model/clean.js.
 */
export function createQuiver(conn) {
  return {
    /** Insider open-market purchases (Form 4 code P) traded in [from, to]. */
    insiderPurchases: ({ from, to, refresh }) =>
      conn.sharded(TOOLS.insider,
        { transaction_code: 'P', sort_by: 'transaction_date', sort_order: 'desc' },
        { from, to, shardDays: 7, pageSize: PAGE.insider, maxPages: 14, refresh, stage: 'ingest' }),

    /** Every congressional trade filed in [from, to]; sales are needed to spot same-day buy/sell pairs. */
    congressTrades: ({ from, to, refresh }) =>
      conn.paged(TOOLS.congress,
        { date_from: from, date_to: to, date_field: 'filed', sort_by: 'filed', sort_order: 'desc' },
        { pageSize: PAGE.congress, maxPages: 10, refresh, stage: 'ingest' }),

    /** Per-ticker buy/sell counts and estimated volumes, filed in [from, to]. */
    congressByTicker: ({ from, to, refresh }) =>
      conn.paged(TOOLS.congress,
        { agg_type: 'ticker', date_from: from, date_to: to, sort_by: 'purchase_count', sort_order: 'desc' },
        { pageSize: PAGE.aggregate, maxPages: 6, refresh, stage: 'ingest' }),

    /** All Form 4 activity for one ticker since `from` (enrichment + dossier). */
    tickerInsider: (ticker, { from, to, refresh, maxPages = 3, stage = 'dossier' }) =>
      conn.paged(TOOLS.insider,
        { ticker, date_from: from, date_to: to, sort_by: 'transaction_date', sort_order: 'desc' },
        { pageSize: PAGE.insider, maxPages, refresh, stage }),

    tickerCongress: (ticker, { from, refresh }) =>
      conn.paged(TOOLS.congress,
        { ticker, date_from: from, date_field: 'traded', sort_by: 'traded', sort_order: 'desc' },
        { pageSize: PAGE.congress, maxPages: 4, refresh, stage: 'dossier' }),

    contracts: (ticker, { from, to, refresh }) =>
      conn.paged(TOOLS.contracts,
        { ticker, date_from: from, date_to: to, sort_by: 'action_date', sort_order: 'desc' },
        { pageSize: PAGE.aggregate, maxPages: 2, refresh, stage: 'dossier' }),

    lobbying: (ticker, { yearFrom, refresh }) =>
      conn.call(TOOLS.lobbying, { ticker, year_from: yearFrom, sort_by: 'date', sort_order: 'desc', limit: 60 }, { refresh, stage: 'dossier' }),


    news: (ticker, { refresh }) =>
      conn.call(TOOLS.news, { ticker, limit: 10 }, { refresh, stage: 'dossier' }),

    ownership: (ticker, { refresh }) =>
      conn.call(TOOLS.ownership, { ticker, limit: 8 }, { refresh, stage: 'dossier' }),

    politician: ({ bioguideId, name, refresh }) =>
      conn.call(TOOLS.politician, bioguideId ? { bioguide_id: bioguideId } : { politician: name }, { refresh, stage: 'member' }),

    /* Policy monitor. Feed summaries run ~1,200 characters, so pages stay at 40 rows to keep under the response cap. */

    /** Newest bill introductions and press releases, with the tickers Quiver tagged. */
    legislationFeed: ({ query, from, pages = 2, refresh, stage = 'policy' } = {}) =>
      conn.paged(TOOLS.news,
        { category: 'legislation_automated', ...(query ? { query } : {}), ...(from ? { date_from: from } : {}), sort_by: 'datetime', sort_order: 'desc' },
        { pageSize: 40, maxPages: pages, refresh, stage }),

    /** Bills whose title contains `query`, at their latest stage. */
    bills: (query, { pages = 2, refresh, stage = 'policy' } = {}) =>
      conn.paged(TOOLS.legislation, { query, sort_by: 'congress', sort_order: 'desc' }, { pageSize: 40, maxPages: pages, refresh, stage }),

    /** Federal awards of at least `minAmount` dated in [from, to], newest first. */
    recentContracts: ({ from, to, minAmount = 1e7, refresh, stage = 'policy' }) =>
      conn.paged(TOOLS.contracts,
        { date_from: from, date_to: to, min_amount: minAmount, sort_by: 'action_date', sort_order: 'desc' },
        { pageSize: 200, maxPages: 2, refresh, stage }),

    memberTrades: (name, { from, refresh }) =>
      conn.paged(TOOLS.congress,
        { politician: name, date_from: from, date_field: 'traded', sort_by: 'traded', sort_order: 'desc' },
        { pageSize: PAGE.congress, maxPages: 3, refresh, stage: 'member' })
  };
}

export const windowBounds = (asOf, days) => ({ from: addDays(asOf, -(days - 1)), to: asOf });
