import { whaleActivity, whaleFeed, FEED_QUERIES } from '../model/whales.js';

/**
 * Loads whale activity on demand: per ticker (fund-update news + top
 * owners) when a company is opened, and the whale-wide feed for Briefing.
 * Results live here; store.whales.v bumps so views re-render.
 */
export function createWhales({ store, quiver }) {
  const byTicker = new Map();
  let feed = { status: 'idle', items: [], at: 0 };
  let feedIndex = new Map();
  const bump = () => store.set({ whales: { v: (store.get().whales?.v || 0) + 1 } });

  async function load(ticker, { refresh = false } = {}) {
    if (!ticker) return;
    const cur = byTicker.get(ticker);
    if (cur && !refresh && (cur.status === 'loading' || cur.status === 'done')) return;
    byTicker.set(ticker, { status: 'loading' });
    bump();
    const [news, own] = await Promise.allSettled([quiver.fundNews(ticker, { refresh }), quiver.ownership(ticker, { refresh })]);
    const owners = own.status === 'fulfilled' ? ((own.value.object || own.value.rows[0] || {}).top_owners || []) : [];
    const rows = news.status === 'fulfilled' ? news.value.rows : [];
    const failed = news.status === 'rejected' && own.status === 'rejected';
    byTicker.set(ticker, failed
      ? { status: 'error', error: news.reason }
      : { status: 'done', data: whaleActivity(ticker, { news: rows, owners }), partial: news.status === 'rejected' || own.status === 'rejected' });
    bump();
  }

  async function loadFeed({ refresh = false } = {}) {
    if (feed.status === 'loading' || (feed.status === 'done' && !refresh)) return;
    feed = { ...feed, status: 'loading' };
    bump();
    const res = await Promise.allSettled(Object.values(FEED_QUERIES).map(q => quiver.whaleNews(q, { refresh })));
    const rows = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value.rows);
    const items = whaleFeed(rows);
    feed = { status: res.every(r => r.status === 'rejected') ? 'error' : 'done', items, at: Date.now(), error: res.find(r => r.status === 'rejected')?.reason || null };
    // Ticker → buys in the newest two quarters the feed covers, for chips elsewhere.
    const quarters = [...new Set(items.map(i => i.quarter))].sort().reverse().slice(0, 2);
    feedIndex = new Map();
    for (const i of items) if (quarters.includes(i.quarter) && (i.action === 'buy' || i.action === 'new')) { if (!feedIndex.has(i.ticker)) feedIndex.set(i.ticker, []); feedIndex.get(i.ticker).push(i); }
    bump();
  }

  return {
    load,
    loadFeed,
    get: ticker => byTicker.get(ticker) || null,
    feed: () => feed,
    /** Recent whale buys of a ticker from the whale-wide feed (empty until loadFeed ran). */
    buysOf: ticker => feedIndex.get(ticker) || []
  };
}
