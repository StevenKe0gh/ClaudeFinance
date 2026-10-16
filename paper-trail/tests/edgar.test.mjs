import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseForm4, form4Index, ownershipXml } from '../src/data/edgar.js';
import { cleanInsider } from '../src/model/clean.js';
import { indexUrl } from '../jobs/edgar.mjs';

// Fixtures follow the SEC's public Form 4 XML schema; names and accession numbers are placeholders.
const sub = readFileSync(new URL('./fixtures/form4-submission.txt', import.meta.url), 'utf8');
const idx = readFileSync(new URL('./fixtures/form-index.idx', import.meta.url), 'utf8');

test('parseForm4 turns a Form 4 submission into Quiver-shaped insider rows', () => {
  const rows = parseForm4(sub, { fileDate: '2026-10-15', accession: '0000000000-26-000001' });
  assert.equal(rows.length, 2, 'two open-market purchases; the option grant is derivative and skipped');
  const [a, b] = rows;
  assert.equal(a.ticker, 'BORR');
  assert.equal(a.owner, 'Troim Tor Olav');
  assert.equal(a.date, '2026-10-13');
  assert.equal(a.file_date, '2026-10-15');
  assert.equal(a.transaction_type, 'P');
  assert.equal(a.acquired_disposed, 'A');
  assert.equal(a.shares, 1500000);
  assert.equal(a.price, 4.9344, 'the footnote marker beside the price is ignored');
  assert.equal(a.shares_owned_after, 38867808);
  assert.equal(a.is_director, true);
  assert.equal(a.is_ten_percent, true, 'a joint filer that holds 10% marks the filing');
  assert.equal(a.ownership, 'I');
  assert.equal(b.shares, 750000, 'thousands separators are tolerated');
});

test('parsed rows go through the same cleaning as Quiver rows', () => {
  const { rows, dropped } = cleanInsider(parseForm4(sub, { fileDate: '2026-10-15' }), { from: '2026-10-01', to: '2026-10-15' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, 'director');
  assert.equal(Math.round(rows[0].value), 7401600);
  assert.equal(Object.values(dropped).reduce((a, b) => a + b, 0), 0);
});

test('parseForm4 ignores anything that is not a Form 4', () => {
  assert.deepEqual(parseForm4('<html>not a filing</html>'), []);
  assert.deepEqual(parseForm4(sub.replace('<documentType>4</documentType>', '<documentType>5</documentType>')), []);
  assert.equal(ownershipXml(sub).trim().startsWith('<?xml'), true);
});

test('form4Index lists each Form 4 once with its date and accession', () => {
  const list = form4Index(idx);
  assert.deepEqual(list.map(f => [f.form, f.cik, f.date, f.accession]), [['4', '0000000001', '2026-10-15', '0000000000-26-000001'], ['4/A', '0000000005', '2026-10-15', '0000000005-26-000002']]);
  assert.equal(list[0].company, 'Example Drilling Ltd');
});

test('indexUrl points at the quarter folder of the daily index', () => {
  assert.equal(indexUrl('2026-10-15'), 'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261015.idx');
});
