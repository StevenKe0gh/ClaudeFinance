#!/usr/bin/env node
// The final `jobs/status` document, with the run's state decided by rule
// rather than by hand.
//
//   node jobs/status.mjs --started <epoch ms> --steps /tmp/pt/steps.json --out /tmp/pt/status.json
//
// --steps  [{ key, status, detail }] in the order the steps ran.
// Writes { state, startedAt, finishedAt, steps, message } to --out.

import { readFileSync, writeFileSync } from 'node:fs';

export const STEP_KEYS = ['quiver', 'holdings', 'quotes', 'prices', 'logos', 'track', 'policy', 'brief'];
export const STEP_STATUS = ['ok', 'skipped', 'blocked', 'error'];

/**
 * `ok` when every step is ok or skipped; `error` when the brief failed;
 * otherwise `partial`. With no filings the brief is skipped on purpose, so
 * a failed `quiver` step alone makes the run partial. The message names
 * what failed or was blocked, from the steps' own details.
 */
export function finalStatus(steps, { startedAt, finishedAt = Date.now() } = {}) {
  for (const s of steps) {
    if (!STEP_KEYS.includes(s.key)) throw new Error(`unknown step "${s.key}"; use one of ${STEP_KEYS.join(', ')}`);
    if (!STEP_STATUS.includes(s.status)) throw new Error(`step "${s.key}" has status "${s.status}"; use one of ${STEP_STATUS.join(', ')}`);
  }
  const bad = steps.filter(s => s.status === 'error' || s.status === 'blocked');
  const brief = steps.find(s => s.key === 'brief');
  const state = brief && brief.status === 'error' ? 'error' : bad.length ? 'partial' : 'ok';
  const message = bad.length
    ? bad.map(s => `${s.key} ${s.status}${s.detail ? `: ${s.detail}` : ''}`).join('; ')
    : 'All steps finished.';
  return { state, startedAt: +startedAt || finishedAt, finishedAt, steps: steps.map(({ key, status, detail }) => ({ key, status, detail: detail || '' })), message };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const steps = JSON.parse(readFileSync(arg('--steps'), 'utf8'));
  const doc = finalStatus(steps, { startedAt: arg('--started') });
  writeFileSync(arg('--out'), JSON.stringify(doc, null, 1));
  console.log(`${doc.state}: ${doc.message}`);
}
