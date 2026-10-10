/**
 * Maps broker instrument names (as Finanzfluss shows them) to listings.
 * Quiver only covers US-listed companies, so each instrument is marked as
 * US (ticker usable for insider/Congress data) or not. ETFs and ETCs get
 * their issuer's logo. Unknown names fall back to an exact company-name
 * match in the US directory; the user can override any mapping.
 */
const RULES = [
  // Funds and commodities
  [/^state street spdr|^spdr/i, { kind: 'etf', logo: 'STT', label: 'SPDR' }],
  [/^ishares physical (gold|silver|platinum|palladium)/i, { kind: 'etc', logo: 'BLK', label: 'iShares' }],
  [/^ishares/i, { kind: 'etf', logo: 'BLK', label: 'iShares' }],
  [/^amundi/i, { kind: 'etf', label: 'Amundi' }],
  [/^vaneck/i, { kind: 'etf', label: 'VanEck' }],
  [/^global x/i, { kind: 'etf', label: 'Global X' }],
  [/^xtrackers/i, { kind: 'etf', label: 'Xtrackers' }],
  [/^vanguard/i, { kind: 'etf', label: 'Vanguard' }],
  [/leverage shares|\b-?\d+x\b|\bshort\b|\blong\b/i, { kind: 'leveraged' }],
  [/factor|zertifikat|optionsschein|turbo|knock/i, { kind: 'derivative' }],
  [/ucits etf|\betf\b/i, { kind: 'etf' }],
  [/\betc\b|\betp\b/i, { kind: 'etc' }],
  // US listings and ADRs
  [/^marvell/i, { ticker: 'MRVL' }],
  [/^citigroup/i, { ticker: 'C' }],
  [/^micron/i, { ticker: 'MU' }],
  [/^(eli )?lilly/i, { ticker: 'LLY' }],
  [/^amd$|^advanced micro/i, { ticker: 'AMD' }],
  [/^take-two/i, { ticker: 'TTWO' }],
  [/^pbf energy/i, { ticker: 'PBF' }],
  [/^arm holdings/i, { ticker: 'ARM' }],
  [/^novartis/i, { ticker: 'NVS' }],
  [/^lumentum/i, { ticker: 'LITE' }],
  [/^(walt )?disney/i, { ticker: 'DIS' }],
  [/^bloom energy/i, { ticker: 'BE' }],
  [/^silicon lab/i, { ticker: 'SLAB' }],
  [/^sandisk/i, { ticker: 'SNDK' }],
  [/^kenvue/i, { ticker: 'KVUE' }],
  [/^novo-?nordisk/i, { ticker: 'NVO' }],
  [/^beyond meat/i, { ticker: 'BYND' }],
  [/^valero/i, { ticker: 'VLO' }],
  [/^comcast/i, { ticker: 'CMCSA' }],
  [/^microvision/i, { ticker: 'MVIS' }],
  [/^nvidia/i, { ticker: 'NVDA' }],
  [/^apple/i, { ticker: 'AAPL' }],
  [/^microsoft/i, { ticker: 'MSFT' }],
  [/^alphabet/i, { ticker: 'GOOGL' }],
  [/^amazon/i, { ticker: 'AMZN' }],
  [/^meta platforms/i, { ticker: 'META' }],
  [/^tesla/i, { ticker: 'TSLA' }],
  // European listings (no Quiver coverage; ADR logos where available)
  [/^commerzbank/i, { local: 'CBK', logo: 'CRZBY', country: 'DE' }],
  [/^unicredit/i, { local: 'UCG', logo: 'UNCRY', country: 'IT' }],
  [/^vonovia/i, { local: 'VNA', logo: 'VONOY', country: 'DE' }],
  [/^glencore/i, { local: 'GLEN', logo: 'GLNCY', country: 'GB' }],
  [/^otp bank/i, { local: 'OTP', logo: 'OTPGF', country: 'HU' }],
  [/^uniper/i, { local: 'UN0', logo: 'UNPRF', country: 'DE' }],
  [/^mitsubishi heavy/i, { local: '7011', logo: 'MHVYF', country: 'JP' }],
  [/^raiffeisen/i, { local: 'RBI', logo: 'RAIFY', country: 'AT' }],
  [/^schneider electric/i, { local: 'SU', logo: 'SBGSY', country: 'FR' }],
  [/^wizz air/i, { local: 'WIZZ', logo: 'WZZZY', country: 'GB' }],
  [/^easyjet/i, { local: 'EZJ', logo: 'ESYJY', country: 'GB' }]
];

const norm = s => String(s || '').toLowerCase().replace(/\b(inc|corp|corporation|co|plc|ag|se|sa|nv|holdings?|group|class [a-z]|adr|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
let reverse = null;
function reverseIndex(directory) {
  if (reverse) return reverse;
  const counts = new Map();
  reverse = new Map();
  for (const [t, row] of Object.entries(directory.t)) {
    const k = norm(row[0]);
    counts.set(k, (counts.get(k) || 0) + 1);
    reverse.set(k, t);
  }
  for (const [k, n] of counts) if (n > 1) reverse.delete(k); // ambiguous names
  return reverse;
}

/**
 * @returns {{kind:'stock'|'etf'|'etc'|'leveraged'|'derivative', ticker:string|null, us:boolean, logo:string|null, label?:string, local?:string, country?:string}}
 */
export function resolveInstrument(name, { assetType = null, directory = null, overrides = {} } = {}) {
  const o = overrides[name];
  if (o) return { kind: o.kind || 'stock', ticker: o.ticker || null, us: !!o.ticker, logo: o.ticker || o.logo || null, ...o };
  const base = { kind: assetType === 'ETF' ? 'etf' : assetType && /Zertifikat|Optionsschein|Derivat/.test(assetType) ? 'derivative' : 'stock', ticker: null, us: false, logo: null };
  for (const [re, info] of RULES) {
    if (!re.test(name)) continue;
    if (info.ticker) return { ...base, kind: 'stock', ...info, us: true, logo: info.logo || info.ticker };
    if (info.local) return { ...base, kind: 'stock', ...info, us: false };
    return { ...base, ...info };
  }
  if (base.kind === 'stock' && directory) {
    const t = reverseIndex(directory).get(norm(name));
    if (t) return { ...base, ticker: t, us: true, logo: t };
  }
  return base;
}

/** "State Street SPDR MSCI World UCITS ETF (Acc)" → "SPDR MSCI World"; "SANDISK CORP." → "Sandisk". */
export function shortInstrument(name) {
  let s = String(name || '')
    .replace(/\b(UCITS|ETF|ETC|ETP)\b/g, '')
    .replace(/\((Acc|Dist|DE|D|C)\)/gi, '')
    .replace(/^State Street\s+/i, '')
    .replace(/^iShares\s+(Core\s+)?/i, '')
    .replace(/\s+(PLC|Corp\.?|Inc\.?|AG|SE|A|ADR|B|Holdings)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s === s.toUpperCase() && /[A-Z]{4}/.test(s)) s = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
  return s || String(name || '');
}

export const KIND_LABEL = { stock: 'Stock', etf: 'ETF', etc: 'ETC', leveraged: 'Leveraged', derivative: 'Derivative' };
