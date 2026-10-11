import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeTax, soli, daysInYear, computeYear, jobYear, PARAMS, YEARS } from '../src/tax.mjs';

test('no tax up to the basic allowance', () => {
  assert.equal(incomeTax(11784, 2024), 0);
  assert.equal(incomeTax(12096, 2025), 0);
  assert.equal(incomeTax(12348, 2026), 0);
  assert.ok(incomeTax(11800, 2024) > 0);
});

test('the tariff is continuous at every zone boundary', () => {
  for (const y of YEARS) {
    const t = PARAMS[y].tariff;
    for (const b of [t.z2, t.z3, 277825]) {
      const below = incomeTax(b, y), above = incomeTax(b + 1, y);
      assert.ok(above - below >= 0 && above - below <= 1, `${y} at ${b}: ${below} → ${above}`);
    }
  }
});

test('known values', () => {
  // 2025, zvE 15,000: y = 0.2904 → (932.30·y + 1400)·y = 485.18 → 485
  assert.equal(incomeTax(15000, 2025), 485);
  // 2024 top of zone 2 equals the zone-3 constant
  assert.equal(incomeTax(17005, 2024), 991);
  assert.equal(soli(1000, 2025), 0);
});

test('days of a job are split across years', () => {
  assert.equal(daysInYear('2024-12-01', '2025-01-31', 2024), 31);
  assert.equal(daysInYear('2024-12-01', '2025-01-31', 2025), 31);
  assert.equal(daysInYear('2024-12-01', '2025-01-31', 2026), 0);
  assert.equal(daysInYear('', '2025-01-31', 2025), 0);
});

test('a student with a summer internship below the allowance gets all wage tax back', () => {
  const state = {
    profile: { church: 0 },
    jobs: [{ id: 'a', employer: 'Acme', type: 'payroll', from: '2025-06-01', to: '2025-08-31', hoursPerWeek: 40, rate: 15, actual: { 2025: { gross: 7800, lst: 310, soli: 0, kist: 0, rv: 725, kv: 636, pv: 179, av: 101 } } }],
    years: { 2025: { study: 'first', capital: { none: true } } }
  };
  const r = computeYear(state, 2025);
  assert.equal(r.wage, 7800);
  assert.equal(r.due.total, 0);
  assert.equal(r.refund, 310);
  assert.equal(r.mandatory, false);
});

test('freelance income above 410 € makes the return mandatory and is taxed only above the allowance', () => {
  const state = {
    profile: { church: 0 },
    jobs: [{ id: 'f', employer: 'Strategybridge', type: 'freelance', from: '2024-03-01', to: '2024-04-30', hoursPerWeek: 20, rate: 15 }],
    years: { 2024: { study: 'first', capital: { none: true } } }
  };
  const r = computeYear(state, 2024);
  assert.ok(r.freeRevenue > 2500 && r.freeRevenue < 2700, String(r.freeRevenue));
  assert.equal(r.mandatory, true);
  assert.equal(r.due.total, 0);
});

test('capital gains tax is refunded through the Günstigerprüfung when income is low', () => {
  const state = { profile: { church: 0 }, jobs: [], years: { 2025: { study: 'first', capital: { income: 4000, kapest: 750, soli: 41.25, kist: 0 } } } };
  const r = computeYear(state, 2025);
  assert.equal(r.guenstiger, true);
  assert.equal(r.due.total, 0);
  assert.equal(r.refund, 791.25);
});

test('a master student records unused study costs as a loss carry-forward', () => {
  const state = { profile: { church: 0 }, jobs: [], years: { 2024: { study: 'second', costs: { studyFees: 600, laptop: 900 }, capital: { none: true } } } };
  const r = computeYear(state, 2024);
  assert.equal(r.lossCarry, 1500);
  assert.equal(r.refund, 0);
});

test('estimates fill in when the Lohnsteuerbescheinigung is missing', () => {
  const j = jobYear({ id: 'x', employer: 'X', type: 'payroll', from: '2026-01-01', to: '2026-03-31', hoursPerWeek: 40, rate: 15 }, 2026, 0);
  assert.ok(j.gross > 7500 && j.gross < 8000);
  assert.ok(j.lst > 0, 'withholding estimated');
  assert.equal(j.taxIsActual, false);
});
