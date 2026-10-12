import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, estimate, availability, notBuyable, doubtful } from '../src/model/brokers.js';

const info = (o = {}) => ({ listed: true, name: '', sector: '', industry: '', quiverName: '', capM: null, ...o });

test('funds, ETFs, SPACs, lenders and partnerships are told apart from companies', () => {
  assert.equal(classify(info({ name: 'Bluerock Private Real Estate Fund' })), 'fund');
  assert.equal(classify(info({ name: 'Pimco High Income Fund', sector: 'Finance', industry: 'Finance/Investors Services' })), 'fund');
  assert.equal(classify(info({ name: 'The Gabelli Healthcare & Wellness Trust', sector: 'Finance', industry: 'Finance/Investors Services' })), 'trust');
  assert.equal(classify(info({ name: 'Redwood Trust', sector: 'Real Estate', industry: 'Real Estate Investment Trusts' })), 'stock');
  assert.equal(classify(info({ listed: false, quiverName: 'SPDR S&P 500 ETF TRUST' })), 'etf');
  assert.equal(classify(info({ name: 'Blackstone Secured Lending Fund' })), 'bdc');
  assert.equal(classify(info({ name: 'Ares Acquisition Corporation III' })), 'spac');
  assert.equal(classify(info({ name: 'Enterprise Products Partners', sector: 'Utilities', industry: 'Natural Gas Distribution' })), 'partnership');
  assert.equal(classify(info({ listed: false, name: '' })), 'unlisted');
  assert.equal(classify(info({ name: 'LendingClub' })), 'stock');
  assert.equal(classify(info({ name: 'GameStop', sector: 'Consumer Discretionary' })), 'stock');
});

test('German brokers carry listed companies above a small-cap floor; Revolut mostly large caps', () => {
  assert.equal(estimate('traderepublic', 'stock', 12754).status, 'likely');
  assert.equal(estimate('scalable', 'stock', 442).status, 'likely');
  assert.equal(estimate('scalable', 'stock', 120).status, 'maybe');
  assert.equal(estimate('scalable', 'stock', 12).status, 'unlikely');
  assert.equal(estimate('scalable', 'stock', null).status, 'maybe');
  assert.equal(estimate('revolut', 'stock', 50000).status, 'likely');
  assert.equal(estimate('revolut', 'stock', 3000).status, 'maybe');
  assert.equal(estimate('revolut', 'stock', 800).status, 'unlikely');
  assert.equal(estimate('revolut', 'unlisted', null).status, 'no');
  assert.equal(estimate('traderepublic', 'fund', 900).status, 'no');
  assert.match(estimate('scalable', 'etf', null).reason, /PRIIPs/);
});

test('the best broker decides, and confirmations beat estimates', () => {
  const i = info({ name: 'Mid Co', capM: 3000 });
  let a = availability('MID', { use: ['revolut', 'scalable'], marks: {}, info: i });
  assert.equal(a.status, 'likely');
  assert.equal(a.best, 'scalable');
  assert.equal(a.per.revolut.status, 'maybe');
  a = availability('MID', { use: ['scalable', 'traderepublic'], marks: { MID: { scalable: false, traderepublic: false } }, info: i });
  assert.equal(a.status, 'no');
  assert.ok(notBuyable(a));
  a = availability('FND', { use: ['scalable'], marks: { FND: { scalable: true } }, info: info({ name: 'Some Income Fund' }) });
  assert.equal(a.status, 'yes');
  assert.equal(a.per.scalable.confirmed, true);
  assert.ok(!doubtful(a));
});
