import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTickers, parseBillHeadline, releaseAuthor, cleanSummary, cleanFeedItem, stageOf, cleanBill, cleanContract, contractLeaders, policyIndex, crossReference, nameKey, searchTerms, agencyShort } from '../src/model/policy.js';
import { normalizeAnalysis, eventPrompt } from '../src/ai/policy.js';

const feedRow = {
  datetime: '2026-10-10T15:43:26',
  headline: 'Senator Elizabeth Warren introduces S. 5512: Stop Wall Street Looting Act',
  url: 'https://www.quiverquant.com/news/x',
  category: 'legislation_automated',
  summary: 'We have received text from S. 5512: Stop Wall Street Looting Act. This bill was received on 2026-09-24, and currently has 6 cosponsors. Here is a short summary of the bill: The bill would change how private equity funds are taxed. Disclaimer: This is an AI-generated summary.',
  tickers: '{KKR,BLK,BX}',
  image: 'https://www.quiverquant.com/images/W000817_congress.png'
};

test('ticker arrays from the newsfeed parse into lists', () => {
  assert.deepEqual(parseTickers('{KKR,BLK,BX}'), ['KKR', 'BLK', 'BX']);
  assert.deepEqual(parseTickers('{}'), []);
  assert.deepEqual(parseTickers(['XOM', 'CVX']), ['XOM', 'CVX']);
  assert.deepEqual(parseTickers(null), []);
});

test('bill headlines split into sponsor, bill id and title', () => {
  assert.deepEqual(parseBillHeadline(feedRow.headline), { role: 'Senator', sponsor: 'Elizabeth Warren', billId: 'S. 5512', title: 'Stop Wall Street Looting Act' });
  const h = parseBillHeadline('Representative Jack Bergman introduces H.R. 10751: Tribal Oral Health Sovereignty Act');
  assert.equal(h.billId, 'H.R. 10751');
  assert.equal(h.role, 'Representative');
  assert.equal(parseBillHeadline('Press Release: Boebert Praises DOJ'), null);
});

test('feed items keep the summary body, intro date, cosponsors and sponsor id', () => {
  const x = cleanFeedItem(feedRow);
  assert.equal(x.kind, 'bill');
  assert.equal(x.billId, 'S. 5512');
  assert.equal(x.received, '2026-09-24');
  assert.equal(x.cosponsors, 6);
  assert.equal(x.bioguide, 'W000817');
  assert.deepEqual(x.tickers, ['KKR', 'BLK', 'BX']);
  assert.equal(x.summary, 'The bill would change how private equity funds are taxed.');
  const rel = cleanFeedItem({ ...feedRow, headline: 'Press Release: Scott Perry Introduces the 45Q Repeal Act', tickers: '{}', summary: 'Intro. Quiver AI Summary Body text. Disclaimer: This is an AI-generated summary' });
  assert.equal(rel.kind, 'release');
  assert.equal(rel.summary, 'Body text.');
});

test('press release authors stop before the verb', () => {
  assert.equal(releaseAuthor('Press Release: Scott Perry Introduces the 45Q Repeal Act'), 'Scott Perry');
  assert.equal(releaseAuthor('Press Release: Rep. Mike Kelly Issues Statement on Deadly Erie Shooting'), 'Mike Kelly');
  assert.equal(releaseAuthor('Press Release: Boebert Praises DOJ and ATF Guidance'), 'Boebert');
  assert.equal(releaseAuthor('Some other headline'), null);
});

test('stages map onto a five-step track', () => {
  assert.equal(stageOf('Introduced-in-House').step, 1);
  assert.equal(stageOf('Reported-in-Senate').step, 2);
  assert.equal(stageOf('Placed-on-Calendar-Senate').step, 2);
  assert.equal(stageOf('Engrossed-in-Senate').step, 3);
  assert.equal(stageOf('Referred-in-Senate').step, 3);
  assert.equal(stageOf('Enrolled-Bill').step, 4);
  assert.equal(stageOf('Public-Law').step, 5);
});

test('legislation rows become bills with ids and clean titles', () => {
  const b = cleanBill({ congress: '119', number: '1241', type: 's', clean_title: 'S. 1241: Sanctioning Russia Act of 2025', chamber: 'Senate', stage: 'Introduced-in-Senate', date: '2025-04-01', tickers: ['XOM', 'CVX'], summary: 'Text. Relevant Companies None found' });
  assert.equal(b.id, 'S. 1241');
  assert.equal(b.title, 'Sanctioning Russia Act of 2025');
  assert.equal(b.stage.step, 1);
  assert.equal(b.summary, 'Text.');
});

test('awards sum per company and ignore de-obligations', () => {
  const rows = [
    { ticker: 'BAH', recipient: ' BOOZ ALLEN HAMILTON INC ', action_date: '2026-09-17 00:00:00', award_description: 'MISSION IT IGF::OT::IGF', total_dollars_obligated: 192588758.69, funding_agency_name: 'Department of Defense' },
    { ticker: 'BAH', recipient: ' BOOZ ALLEN HAMILTON INC ', action_date: '2026-09-10 00:00:00', award_description: 'ARPA-E support', total_dollars_obligated: 56874905.91, funding_agency_name: 'Department of Energy' },
    { ticker: 'IBM', recipient: ' IBM ', action_date: '2026-09-28 00:00:00', award_description: 'Mainframe', total_dollars_obligated: 130434205.69, funding_agency_name: 'Social Security Administration' },
    { ticker: 'IBM', recipient: ' IBM ', action_date: '2026-09-01 00:00:00', award_description: 'Deobligation', total_dollars_obligated: -5e6, funding_agency_name: 'Social Security Administration' }
  ].map(cleanContract);
  assert.equal(rows[0].desc, 'MISSION IT');
  assert.equal(rows[0].agency, 'Defense');
  const L = contractLeaders(rows);
  assert.deepEqual(L.map(l => l.ticker), ['BAH', 'IBM']);
  assert.equal(L[0].n, 2);
  assert.equal(L[0].agency, 'Defense');
  assert.equal(L[1].n, 1);
  assert.equal(agencyShort('Department of Veterans Affairs'), 'Veterans Affairs');
});

test('the index maps tickers to bills and awards', () => {
  const feed = [cleanFeedItem(feedRow)];
  const awards = [cleanContract({ ticker: 'BLK', recipient: 'BLACKROCK', action_date: '2026-09-01', total_dollars_obligated: 2e7, funding_agency_name: 'Department of the Treasury' })];
  const idx = policyIndex({ feed, awards });
  assert.equal(idx.get('KKR').bills.length, 1);
  assert.equal(idx.get('BLK').contracts.usd, 2e7);
  assert.equal(idx.has('XOM'), false);
});

const sig = (ticker, score, members = [], buyers = []) => ({ ticker, score, tier: score > 30 ? 'A' : 'C', rank: 1, company: '', congress: { members, overseers: members.filter(m => m.oversees).length }, insider: { buyers, usd: 0 } });

test('a sponsor trading a company their bill names ranks first', () => {
  const feed = [cleanFeedItem(feedRow)];
  const rows = crossReference({
    feed,
    awards: [],
    signals: [sig('BLK', 40, [{ name: 'Someone Else', washOnly: false }]), sig('KKR', 12, [{ name: 'Elizabeth Warren', washOnly: false }])],
    congressRows: [{ representative: 'Elizabeth Warren', bioguide_id: 'W000817', ticker: 'KKR', kind: 'buy', amount: '$1,001 - $15,000', traded: '2026-09-20' }],
    held: new Set(['BX'])
  });
  assert.deepEqual(rows.map(r => r.ticker), ['KKR', 'BLK', 'BX']);
  assert.ok(rows[0].why.includes('sponsor'));
  assert.equal(rows[0].sponsorTrades.length, 1);
  assert.deepEqual(rows[2].why, ['held']);
});

test('sponsor names match on first and last name, ignoring initials and suffixes', () => {
  assert.equal(nameKey('Angus S. King Jr.'), nameKey('Angus King'));
  assert.notEqual(nameKey('Mark Kelly'), nameKey('Mike Kelly'));
  assert.equal(nameKey('Fetterman, John'), nameKey('John Fetterman'));
});

test('search terms keep the meaningful words of a question', () => {
  assert.deepEqual(searchTerms('US-Russia diesel deal'), ['Russia', 'diesel']);
  assert.deepEqual(searchTerms('Which companies profit from new tariffs on steel?'), ['tariffs', 'steel']);
});

test('analysis JSON is coerced and malformed entries dropped', () => {
  const a = normalizeAnalysis({
    headline: 'Diesel exports', status: 'rumour', mechanism: 'Refiners sell more.',
    winners: [{ ticker: '$vlo', company: 'Valero', why: 'Exporter', channel: 'direct', confidence: 'high', evidence: 'industry reasoning' }, { ticker: 'not a ticker!' }, { ticker: 'VLO' }],
    losers: [{ ticker: 'VLO' }, { ticker: 'FRO', channel: 'weird', confidence: 'extreme' }],
    bills: ['S. 1241'], watch: ['A treasury license']
  });
  assert.deepEqual(a.winners.map(w => w.ticker), ['VLO']);
  assert.deepEqual(a.losers.map(w => w.ticker), ['FRO']);
  assert.equal(a.losers[0].channel, 'direct');
  assert.equal(a.losers[0].confidence, 'low');
  assert.equal(a.status, 'rumour');
  assert.throws(() => normalizeAnalysis('nope'));
});

test('the event prompt carries the question, the rules and the context', () => {
  const p = eventPrompt({ question: 'US-Russia diesel deal', asOf: '2026-10-11', context: { bills: [{ id: 'S. 1241' }] }, tools: true });
  assert.match(p, /US-Russia diesel deal/);
  assert.match(p, /search_bills/);
  assert.match(p, /industry reasoning/);
  assert.match(p, /"S\. 1241"/);
  assert.doesNotMatch(eventPrompt({ question: 'x', asOf: '2026-10-11', context: {}, tools: false }), /company_exposure/);
});
