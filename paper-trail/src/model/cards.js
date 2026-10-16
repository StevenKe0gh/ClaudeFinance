import { fmtUSD } from '../core/util.js';

const ROLE = { csuite: 'An executive', officer: 'An officer', director: 'A director', fund: 'A fund', holder: 'A large holder' };

/** One plain line on why a signal ranks: who bought and how much. Used on the front page and in the saved snapshot. */
export function signalLine(s) {
  const out = [];
  const b = (s.insider && s.insider.buyers) || [];
  const m = ((s.congress && s.congress.members) || []).filter(x => !x.washOnly);
  if (b.length === 1) out.push(`${ROLE[b[0].role] || 'An insider'} bought ${fmtUSD(b[0].usd)}`);
  else if (b.length > 1) out.push(`${b.length} insiders bought ${fmtUSD(s.insider.usd)}`);
  const over = m.find(x => x.oversees);
  if (over) out.push(`a member whose committee oversees it bought`);
  else if (m.length === 1) out.push(`a member of Congress bought`);
  else if (m.length > 1) out.push(`${m.length} members of Congress bought`);
  const t = out.join('; ');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
