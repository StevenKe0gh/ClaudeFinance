/**
 * Company-name handling. Listing names come with share-class boilerplate
 * ("Advanced Micro Devices Inc. Common Stock"); filings come in upper case
 * ("GAMESTOP CORP"). Both are reduced to the name a person would say.
 */

const CLASS_TAIL = /\s*[-–,]?\s*(?:Class [A-Z]\s+)?(?:American Deposit[ao]ry Shares?|Depositary Shares?|ADSs?|ADRs?|Common Stock|Common Shares|Ordinary Shares|Subordinate Voting Shares|Shares of Beneficial Interest|Limited Partnership Units|Units|Warrants?|Rights|Series [A-Z]\b).*$/i;
const LEGAL_TAIL = /[,\s]+(?:(?:and|&)\s+)?(?:Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited|PLC|N\.?V\.?|S\.?A\.?|AG|SE|LLC|L\.?P\.?|Cl\s*[A-Z])$/i;

export function shortCompany(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(CLASS_TAIL, '').trim().replace(/\s*\(The\)$/i, '').trim();
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL_TAIL, '').trim();
  s = s.replace(/[,\s]+$/, '');
  if (s === s.toUpperCase() && /[A-Z]{3}/.test(s)) {
    s = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Usa|Us|Uk|Ag|Nv|Sa|Etf|Reit|Lp)\b/g, m => m.toUpperCase());
  }
  return s;
}

/** Stable hue from a string, for monogram tiles when no logo exists. */
export function hueOf(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function monogram(name, ticker) {
  const words = String(name || ticker || '?').replace(/[^A-Za-z0-9 &]/g, ' ').split(/\s+/).filter(w => w && !/^(the|of|and|&)$/i.test(w));
  if (!words.length) return String(ticker || '?').slice(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : words[0][1] || '')).toUpperCase();
}
