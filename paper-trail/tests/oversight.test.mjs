import test from 'node:test';
import assert from 'node:assert/strict';
import { createOversight, themesOf, companyThemes, memberSeats } from '../src/model/oversight.js';
import { buildSignals, DEFAULT_MODEL } from '../src/model/score.js';

// Synthetic roster: one Armed Services member (ranking on a subcommittee), one Agriculture member.
const COMMITTEES = {
  committees: {
    HSAS: ['House Armed Services', 'house'],
    HSAS25: ['House Armed Services: Tactical Air and Land Forces', 'house'],
    HSAG: ['House Agriculture', 'house'],
    HSRU: ['House Rules', 'house']
  },
  members: {
    X000001: [['HSAS', ''], ['HSAS25', 'ranking']],
    X000002: [['HSAG', ''], ['HSRU', 'chair']]
  }
};
const COMPANIES = {
  DEFN: { sector: 'Industrials', industry: 'Military/Government/Technical' },
  BANK: { sector: 'Finance', industry: 'Major Banks' },
  SEED: { sector: 'Consumer Staples', industry: 'Farming/Seeds/Milling' }
};
const oversight = createOversight({ committees: COMMITTEES, companyOf: t => COMPANIES[t] || null });

test('subcommittees inherit their parent committee themes unless mapped', () => {
  assert.deepEqual(themesOf('HSAS25'), ['defense']);
  assert.deepEqual(themesOf('HSIF14'), ['health']);
  assert.deepEqual(themesOf('HSRU'), []);
});

test('company themes come from NASDAQ sector and industry', () => {
  assert.deepEqual(companyThemes('Industrials', 'Aerospace'), ['defense', 'space']);
  assert.ok(companyThemes('Finance', 'Major Banks').includes('banking'));
  assert.deepEqual(companyThemes('Finance', 'Blank Checks'), []);
  assert.ok(companyThemes('Health Care', 'Biotechnology: Pharmaceutical Preparations').includes('health'));
});

test('oversight matches a member to companies their committees cover', () => {
  const hit = oversight('DEFN', 'X000001');
  assert.equal(hit.theme, 'defense');
  assert.equal(hit.leader, true);
  assert.equal(hit.committee, 'House Armed Services: Tactical Air and Land Forces');
  assert.equal(hit.seats.length, 2);
  assert.equal(oversight('BANK', 'X000001'), null);
  assert.equal(oversight('SEED', 'X000002').theme, 'agriculture');
  // A chair seat on a committee without jurisdiction does not count.
  assert.equal(oversight('DEFN', 'X000002'), null);
  assert.equal(oversight('DEFN', null), null);
  assert.deepEqual(memberSeats(COMMITTEES, 'X000002').map(s => s.id), ['HSAG', 'HSRU']);
});

test('an overseeing member outranks an otherwise identical purchase', () => {
  const row = (ticker, rep, bioguide) => ({ ticker, representative: rep, bioguide_id: bioguide, party: 'D', chamber: 'House', kind: 'buy', transaction: 'Purchase', amount: '$15,001 - $50,000', mid: 32500, traded: '2026-10-01', filed: '2026-10-05', lagDays: 4, wash: false, owner: null });
  const sigs = buildSignals({
    insiderBuys: [],
    congressRows: [row('DEFN', 'Overseer', 'X000001'), row('BANK', 'Bystander', 'X000003')],
    asOf: '2026-10-09', windowDays: 30, model: DEFAULT_MODEL, oversight
  });
  const by = Object.fromEntries(sigs.map(s => [s.ticker, s]));
  assert.ok(by.DEFN.score > by.BANK.score + 10, `${by.DEFN.score} vs ${by.BANK.score}`);
  assert.equal(by.DEFN.rank, 1);
  const flag = by.DEFN.flags.find(f => f.id === 'oversight');
  assert.ok(flag && /ranking member on House Armed Services/.test(flag.detail));
  assert.equal(by.DEFN.congress.members[0].oversees.theme, 'defense');
  assert.equal(by.BANK.flags.find(f => f.id === 'oversight'), undefined);
});

test('scoring without an oversight lookup still works', () => {
  const sigs = buildSignals({ insiderBuys: [], congressRows: [], asOf: '2026-10-09', windowDays: 30, model: DEFAULT_MODEL });
  assert.deepEqual(sigs, []);
});
