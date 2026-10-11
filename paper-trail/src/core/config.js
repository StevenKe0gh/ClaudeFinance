/* global __APP_VERSION__ */
export const APP = {
  name: 'Paper Trail',
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  model: 'conviction-2'
};

/** Connector display name as it appears in claude.ai Settings → Connectors. */
export const SERVER = 'Quiver Quant';

export const TOOLS = Object.freeze({
  congress: 'get_congress_trades',
  insider: 'get_insider_trading',
  contracts: 'get_gov_contracts',
  lobbying: 'get_lobbying',
  darkpool: 'get_dark_pool',
  news: 'get_quiver_newsfeed',
  ownership: 'get_ticker_ownership',
  politician: 'get_congress_politician',
  legislation: 'get_congress_legislation'
});

/**
 * Page sizes keep each response under Quiver's ~75,000-character cap, past
 * which the server truncates and wraps the rows (see data/normalize.js).
 */
export const PAGE = Object.freeze({ insider: 150, congress: 150, aggregate: 200 });

export const WINDOWS = [7, 14, 30, 60, 90];
export const CONVERGENCE_DAYS = 90;
export const ENRICH_TOP_N = 15;
export const CONCURRENCY = 4;

export const DAY = 864e5;
