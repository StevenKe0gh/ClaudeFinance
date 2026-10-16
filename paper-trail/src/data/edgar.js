/**
 * SEC EDGAR Form 4 (insider transactions) without a data vendor. Turns the
 * public filings into the same rows the Quiver insider feed gives, so the
 * model and views work unchanged on either source.
 *
 * Pure functions, no network: jobs/edgar.mjs does the fetching.
 */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));

/** Inner text of the first <tag>, or of its <value> child when it has one. */
function field(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return null;
  const v = /<value>([\s\S]*?)<\/value>/.exec(m[1]);
  return unescape((v ? v[1] : m[1]).trim());
}
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
const flag = v => v === '1' || /^true$/i.test(String(v || ''));
const num = v => (v == null || v === '' ? null : +String(v).replace(/,/g, ''));

/** The <ownershipDocument> inside a full submission text file, or the XML itself. */
export function ownershipXml(text) {
  const s = String(text || '');
  const m = /<XML>([\s\S]*?)<\/XML>/i.exec(s);
  const xml = m ? m[1] : s;
  return /<ownershipDocument[\s>]/.test(xml) ? xml : null;
}

/**
 * Non-derivative transactions of one Form 4 as Quiver-shaped insider rows:
 * { ticker, date, file_date, owner, transaction_type, acquired_disposed,
 *   shares, price, shares_owned_after, officer_title, is_director,
 *   is_officer, is_ten_percent, ownership, form, accession }.
 */
export function parseForm4(text, { fileDate = null, accession = null } = {}) {
  const xml = ownershipXml(text);
  if (!xml) return [];
  const form = field(xml, 'documentType');
  if (form !== '4' && form !== '4/A') return [];
  const issuer = blocks(xml, 'issuer')[0] || '';
  const ticker = String(field(issuer, 'issuerTradingSymbol') || '').trim().toUpperCase();
  const owners = blocks(xml, 'reportingOwner');
  const rel = owners.map(o => blocks(o, 'reportingOwnerRelationship')[0] || '');
  const owner = owners.length ? field(owners[0], 'rptOwnerName') : null;
  const title = rel.map(r => field(r, 'officerTitle')).find(Boolean) || null;
  const base = {
    ticker: ticker && ticker !== 'NONE' && ticker !== 'N/A' ? ticker : null,
    file_date: fileDate,
    owner,
    officer_title: title,
    is_director: rel.some(r => flag(field(r, 'isDirector'))),
    is_officer: rel.some(r => flag(field(r, 'isOfficer'))),
    is_ten_percent: rel.some(r => flag(field(r, 'isTenPercentOwner'))),
    form,
    accession
  };
  return blocks(xml, 'nonDerivativeTransaction').map(t => ({
    ...base,
    date: String(field(t, 'transactionDate') || '').slice(0, 10),
    transaction_type: field(t, 'transactionCode'),
    acquired_disposed: field(t, 'transactionAcquiredDisposedCode'),
    shares: num(field(t, 'transactionShares')),
    price: num(field(t, 'transactionPricePerShare')),
    shares_owned_after: num(field(t, 'sharesOwnedFollowingTransaction')),
    ownership: field(t, 'directOrIndirectOwnership')
  }));
}

/**
 * Form 4 filings listed in an EDGAR daily form index (form.YYYYMMDD.idx):
 * [{ form, company, cik, date, path, accession }], one per filing (the
 * index lists a filing once for the issuer and once for each owner).
 */
export function form4Index(text) {
  const out = [];
  const seen = new Set();
  let body = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!body) { body = /^-{20,}/.test(line); continue; }
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 5) continue;
    const [form] = cols;
    if (form !== '4' && form !== '4/A') continue;
    const path = cols.at(-1), date = cols.at(-2), cik = cols.at(-3);
    if (seen.has(path)) continue;
    seen.add(path);
    const d = date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const acc = /(\d{10}-\d{2}-\d{6})\.txt$/.exec(path);
    out.push({ form, company: cols.slice(1, -3).join(' '), cik, date: d, path, accession: acc ? acc[1] : null });
  }
  return out;
}
