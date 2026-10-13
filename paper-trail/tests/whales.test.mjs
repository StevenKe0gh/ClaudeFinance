import test from 'node:test';
import assert from 'node:assert/strict';
import { WHALES, whaleOf, parseFundHeadline, parseMoves, parseHoldingsUpdate, whaleActivity, whaleFeed, quarterKey } from '../src/model/whales.js';

test('ten funds plus Berkshire, matched by their 13F filer names', () => {
  assert.equal(WHALES.length, 11);
  assert.equal(whaleOf('BERKSHIRE HATHAWAY INC').id, 'berkshire');
  assert.equal(whaleOf('BERKSHIRE HATHAWAY (BRK.B)'), null, 'the stock is not the fund');
  assert.equal(whaleOf('Pershing Square Capital Management, L.P.').id, 'pershing');
  assert.equal(whaleOf('VIKING GLOBAL INVESTORS LP').id, 'viking');
  assert.equal(whaleOf('JPMORGAN CHASE & CO'), null);
});

test('fund-update headlines parse into actions', () => {
  assert.deepEqual(parseFundHeadline('Fund Update: BERKSHIRE HATHAWAY INC added 8,091,570 shares of CHEVRON ($CVX) to their portfolio'), { fund: 'BERKSHIRE HATHAWAY INC', action: 'buy', ticker: 'CVX', shares: 8091570, usd: null });
  assert.deepEqual(parseFundHeadline('Fund Update: BERKSHIRE HATHAWAY INC opened a $907.9M position in $LLYVK stock'), { fund: 'BERKSHIRE HATHAWAY INC', action: 'new', ticker: 'LLYVK', shares: null, usd: 907.9e6 });
  assert.deepEqual(parseFundHeadline('Fund Update: New $2.1B $MSFT stock position opened by Pershing Square Capital Management, L.P.'), { fund: 'Pershing Square Capital Management, L.P.', action: 'new', ticker: 'MSFT', shares: null, usd: 2.1e9 });
  assert.equal(parseFundHeadline('Fund Update: 2,998,214 IRIS ENERGY (IREN) shares added to Situational Awareness LP portfolio').fund, 'Situational Awareness LP');
  assert.equal(parseFundHeadline('Why AMD Stock Is Down Today'), null);
});

const SUMMARY = "Mirova US LLC has opened a new $145.1M position in $AMD , per a new SEC 13F filing. This disclosure reflects the funds' holdings for the 06-30-2026 report period. Here are some of the largest recent moves: JPMORGAN CHASE & CO added 40,309,233 shares (+inf%) to their portfolio in Q2 2026, for an estimated $23,416,036,542 VIKING GLOBAL INVESTORS LP removed 3,742,191 shares (-100.0%) from their portfolio in Q1 2026, for an estimated $742,918,468 APPALOOSA LP added 1,000,000 shares (+25.0%) to their portfolio in Q2 2026, for an estimated $580,000,000 FMR LLC removed 10 shares (-2.0%) from…";

test('the largest-moves list parses, including exits and new positions', () => {
  const m = parseMoves(SUMMARY);
  assert.equal(m.length, 3);
  assert.deepEqual(m[0], { fund: 'JPMORGAN CHASE & CO', action: 'new', shares: 40309233, pct: Infinity, quarter: '2026Q2', usd: 23416036542 });
  assert.equal(m[1].fund, 'VIKING GLOBAL INVESTORS LP');
  assert.equal(m[1].action, 'exit');
  assert.equal(m[2].action, 'buy');
  assert.equal(quarterKey('Q1 2026'), '2026Q1');
});

test('activity for a ticker keeps whales only and adds 13F holders', () => {
  const a = whaleActivity('AMD', {
    news: [{ headline: 'Fund Update: New $145.1M $AMD stock position opened by Mirova US LLC', tickers: '{AMD}', summary: SUMMARY, datetime: '2026-08-14T12:03:45' }],
    owners: [{ owner_name: 'BERKSHIRE HATHAWAY INC', shares: 5e6, date: '2026-06-30', form_type: null }, { owner_name: 'Su Lisa', shares: 3e6, date: '2026-09-01', form_type: '4' }, { owner_name: 'VANGUARD GROUP INC', shares: 1e8, date: '2026-06-30', form_type: null }]
  });
  assert.deepEqual(a.moves.map(m => [m.whale.id, m.action, m.quarter]), [['appaloosa', 'buy', '2026Q2'], ['viking', 'exit', '2026Q1']]);
  assert.deepEqual(a.holders.map(h => h.whale.id), ['berkshire']);
});

test('the whale feed lists newest buys with value from the summary', () => {
  const f = whaleFeed([
    { headline: 'Fund Update: BERKSHIRE HATHAWAY INC added 8,091,570 shares of CHEVRON ($CVX) to their portfolio', summary: "holdings for the 12-31-2025 report period. Here are some of the largest recent moves: BERKSHIRE HATHAWAY INC added 8,091,570 shares (+6.6%) to their portfolio in Q4 2025, for an estimated $1,233,236,183 NORGES BANK added 1 shares (+1.0%) to their portfolio in Q4 2025, for an estimated $1", datetime: '2026-02-17T21:21:56' },
    { headline: 'Fund Update: 210,569 BERKSHIRE HATHAWAY (BRK.B) shares added to Himalaya Capital Management LLC portfolio', summary: 'holdings for the 06-30-2026 report period.', datetime: '2026-08-14' }
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].ticker, 'CVX');
  assert.equal(f[0].usd, 1233236183);
  assert.equal(f[0].pct, 6.6);
  assert.equal(f[0].quarter, '2025Q4');
});

const RENTEC = "RENAISSANCE TECHNOLOGIES LLC just filed a portfolio update. This disclosure reflects the funds' holdings for the 06-30-2026 report period. Per our estimates, the largest stock moves were: A decrease of -1,951,406 shares of $MU (~ $2,252,488,432 ). This was a decrease of ~90% from their previous position. A decrease of -794,588 shares of $SNDK (~ $1,806,678,573 ). This was a decrease of ~99.6% from their previous position. An addition of 1,769,780 shares of $META (~ $996,899,376) . This was an increase of ~698% over their previous position. An addition of 2,995,840 shares of $CRWD (~ $571,561,334) . This was an increase of ~inf% over their previous position.";

test('fund holdings updates list the fund\'s own moves', () => {
  const u = parseHoldingsUpdate('Fund Update: RENAISSANCE TECHNOLOGIES LLC Just Disclosed New Holdings', RENTEC);
  assert.equal(u.fund, 'RENAISSANCE TECHNOLOGIES LLC');
  assert.equal(u.quarter, '2026Q2');
  assert.deepEqual(u.moves.map(m => [m.ticker, m.action]), [['MU', 'sell'], ['SNDK', 'exit'], ['META', 'buy'], ['CRWD', 'new']]);
  assert.equal(u.moves[0].usd, 2252488432);
  const asWhale = [{ headline: 'Fund Update: Pershing Square Capital Management, L.P. Just Disclosed New Holdings', summary: RENTEC, tickers: '{MU, SNDK, META, CRWD}', datetime: '2026-08-14' }];
  assert.deepEqual(whaleActivity('META', { news: asWhale }).moves.map(m => [m.whale.id, m.action]), [['pershing', 'buy']]);
  assert.equal(whaleFeed(asWhale).length, 4);
});
