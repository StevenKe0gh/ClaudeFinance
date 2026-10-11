import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFinanzfluss, mergeTransactions, eur, pct } from '../src/model/finanzfluss.js';
import { analyzeTrades, detectPlans } from '../src/model/trades.js';
import { resolveInstrument, shortInstrument } from '../src/model/instruments.js';
import { shortCompany, monogram } from '../src/core/names.js';

// Synthetic page text in the Finanzfluss copy format (no real account data).
const PAGE = `
Portfolios & Konten
Beispiel Depot
10.000,00€
3,10%
Einstandswert: 8.000,00€
Positionen (3)
Name
Aktueller Kurs
Aktueller Wert
Einstiegswert
Kursgewinn
Allokation
Dividende

Example World UCITS ETF (Acc)
ETF
50,00€
0,10%
6.000,00€
120 St. zu 50,00€
4.800,00€
⌀ 40,00€
1.200,00€
25,00%
60,00%

Acme Robotics
Aktie
100,00€
1,20%
3.000,00€
30 St. zu 100,00€
3.300,00€
⌀ 110,00€
-300,00€
9,09%
30,00%
4,50€

iShares Physical Silver ETC
ETF
20,00€
0,30%
1.000,00€
50 St. zu 20,00€
1.250,00€
⌀ 25,00€
-250,00€
20,00%
10,00%
Buchungen
12 Käufe
3 Verkäufe
1 Dividenden
Datum
Name
Kurs
Steuern
Gesamtbetrag
Kauf
01.09.2026
Example World UCITS ETF (Acc)
ETF
49,00€
2,04 St.
-
100,00€
Verkauf
20.08.2026
Acme Robotics
Aktie
90,00€
5 St.
12,30€
450,00€
Dividende
15.08.2026
Acme Robotics
Aktie
4,50€
-
4,50€
Kauf
10.08.2026
Acme Robotics
Aktie
95,00€
5 St.
475,00€
Kauf
01.08.2026
Example World UCITS ETF (Acc)
ETF
48,00€
2,08 St.
-
100,00€
Reverse Split
01.07.2026
Old Corp
Aktie
-
10:1
-
-
Kauf
01.07.2026
Example World UCITS ETF (Acc)
ETF
47,50€
2,1 St.
-
100,00€
Elemente pro Seite
1-7 von 7
Kennzahlen
Investiertes Kapital
8.000,00€
Kursgewinn
12,50%
1.000,00€
TWROR
3,10%
IZF
7,20%
* Cash
[512,30€](https://example.com)
`;

test('German number formats', () => {
  assert.equal(eur('28.224,70€'), 28224.7);
  assert.equal(eur('-398,06€'), -398.06);
  assert.equal(pct('0,04%'), 0.04);
  assert.equal(eur('n/a'), null);
});

test('parses positions, signs and optional dividends', () => {
  const { positions } = parseFinanzfluss(PAGE);
  assert.equal(positions.length, 3);
  const acme = positions[1];
  assert.equal(acme.name, 'Acme Robotics');
  assert.equal(acme.qty, 30);
  assert.equal(acme.avg, 110);
  assert.equal(acme.gain, -300);
  assert.equal(acme.gainPct, -9.09); // % is unsigned on the page; the sign follows the € gain
  assert.equal(acme.dividends, 4.5);
  assert.equal(positions[2].dividends, 0);
  assert.equal(positions.reduce((s, p) => s + p.alloc, 0), 100);
});

test('parses transactions with and without dash placeholders', () => {
  const { transactions: t } = parseFinanzfluss(PAGE);
  assert.equal(t.length, 7);
  const sell = t.find(x => x.kind === 'sell');
  assert.deepEqual([sell.price, sell.qty, sell.tax, sell.total], [90, 5, 12.3, 450]);
  const noDash = t.find(x => x.kind === 'buy' && x.name === 'Acme Robotics');
  assert.deepEqual([noDash.price, noDash.qty, noDash.tax, noDash.total], [95, 5, 0, 475]);
  assert.equal(t.find(x => x.kind === 'dividend').total, 4.5);
  assert.equal(t.find(x => x.kind === 'split').ratio, '10:1');
});

test('parses key figures, including markdown links', () => {
  const { summary: s } = parseFinanzfluss(PAGE);
  assert.equal(s.depotValue, 10000);
  assert.equal(s.costBasis, 8000);
  assert.equal(s.twror, 3.1);
  assert.equal(s.irr, 7.2);
  assert.equal(s.unrealized, 1000);
  assert.equal(s.cash, 512.3);
  assert.equal(s.txTotal, 7);
});

test('merging pastes dedupes transactions', () => {
  const { transactions: t } = parseFinanzfluss(PAGE);
  const r = mergeTransactions(t.slice(0, 4), t);
  assert.equal(r.all.length, 7);
  assert.equal(r.added, 3);
  assert.ok(r.all[0].date >= r.all[r.all.length - 1].date);
});

test('detects monthly savings plans', () => {
  const { transactions: t } = parseFinanzfluss(PAGE);
  const plans = detectPlans(t.filter(x => x.kind === 'buy'));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, 'Example World UCITS ETF (Acc)');
  assert.equal(plans[0].count, 3);
  assert.equal(plans[0].day, 1);
});

test('trade review finds the short losing round trip, the laggard and the plan', () => {
  const { transactions: t, positions, summary } = parseFinanzfluss(PAGE);
  const a = analyzeTrades(t, positions, { asOf: '2026-09-10', summary, resolve: (n, ty) => resolveInstrument(n, { assetType: ty }) });
  const keys = a.findings.map(f => f.key);
  assert.ok(keys.includes('plans'));
  assert.ok(keys.includes('quicklosses'));
  assert.ok(keys.includes('losers'));
  assert.ok(keys.includes('core'));
  const trip = a.roundTrips.find(r => r.name === 'Acme Robotics');
  assert.equal(trip.pnl, -25);
  assert.equal(trip.days, 10);
  assert.equal(a.stats.taxes, 12.3);
});

test('instrument resolution and short names', () => {
  assert.equal(resolveInstrument('Marvell Technology').ticker, 'MRVL');
  assert.equal(resolveInstrument('Commerzbank').us, false);
  assert.equal(resolveInstrument('iShares Physical Gold ETC').kind, 'etc');
  assert.equal(resolveInstrument('Leverage Shares -3x Short MicroStrategy (MSTR) ETP').kind, 'leveraged');
  assert.equal(resolveInstrument('Foo', { overrides: { Foo: { ticker: 'FOO' } } }).ticker, 'FOO');
  assert.equal(shortInstrument('State Street SPDR MSCI World UCITS ETF (Acc)'), 'SPDR MSCI World');
  assert.equal(shortInstrument('SANDISK CORP.'), 'Sandisk');
});

test('company names and monograms', () => {
  assert.equal(shortCompany('Advanced Micro Devices Inc. Common Stock'), 'Advanced Micro Devices');
  assert.equal(shortCompany('Eli Lilly and Company Common Stock'), 'Eli Lilly');
  assert.equal(shortCompany('Walt Disney Company (The) Common Stock'), 'Walt Disney');
  assert.equal(shortCompany('GAMESTOP CORP'), 'Gamestop');
  assert.equal(monogram('Redwood Trust', 'RWT'), 'RT');
});
