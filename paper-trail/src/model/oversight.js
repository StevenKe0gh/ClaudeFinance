/**
 * Committee oversight: does a member of Congress sit on a committee (or
 * subcommittee) whose jurisdiction covers the company's industry? A member
 * who buys shares in a company their committee regulates, funds or
 * investigates has the clearest information edge in the congressional data.
 *
 * Industry comes from the NASDAQ classification in the company directory;
 * committee seats from src/data/committees.json. The mapping below is
 * deliberately conservative: a committee counts only for industries at the
 * core of its jurisdiction.
 */

/** Industry themes, matched on NASDAQ sector and industry labels. */
export const THEMES = {
  defense: { label: 'defense and aerospace contractors', test: (s, i) => /Military|Aerospace|Ordnance/.test(i) },
  banking: { label: 'banks, insurers and financial firms', test: (s, i) => s === 'Finance' && !/Blank Checks|Real Estate|Trusts Except/.test(i) },
  housing: { label: 'housing and real estate', test: (s, i) => s === 'Real Estate' || /Homebuilding|^Real Estate$/.test(i) },
  health: { label: 'health care, drugs and medical devices', test: (s, i) => s === 'Health Care' || /Accident &Health|Managed Health|Drug Stores/.test(i) },
  energy: { label: 'energy and utilities', test: (s, i) => s === 'Energy' || s === 'Utilities' || /Oil|Natural Gas|Coal|Power Generation|Electric Utilities/.test(i) },
  tech: { label: 'technology', test: (s, i) => s === 'Technology' || /Computer|Software|Semiconductor|EDP Services/.test(i) },
  telecom: { label: 'telecom and media', test: (s, i) => s === 'Telecommunications' || /Broadcasting|Cable|Telecommunications Equipment|Movies|Publishing|Newspapers/.test(i) },
  transport: { label: 'transportation', test: (s, i) => /Air Freight|Airline|Railroads|Trucking|Marine Transportation|Transportation Services|Integrated Freight|Other Transportation|Auto Manufacturing|Motor Vehicles/.test(i) },
  agriculture: { label: 'agriculture and food', test: (s, i) => /Farming|Agricultural|Meat|Packaged Foods|Specialty Foods|Beverages|Tobacco|Food Distributors|Forest Products/.test(i) },
  resources: { label: 'mining and natural resources', test: (s, i) => /Mining|Precious Metals|Other Metals|Steel|Aluminum|Oil & Gas Production|Forest Products/.test(i) },
  infrastructure: { label: 'construction and infrastructure', test: (s, i) => /Engineering & Construction|Water Sewer|Building Materials|Construction\/Ag Equipment|Water Supply|Environmental Services|Pollution Control/.test(i) },
  space: { label: 'space and aviation', test: (s, i) => /Aerospace/.test(i) }
};

/**
 * Committee or subcommittee id (thomas id) → themes. A subcommittee without
 * its own entry inherits its parent committee's themes.
 */
export const COMMITTEE_THEMES = {
  // House
  HSAG: ['agriculture'],
  HSAS: ['defense'],
  HSBA: ['banking', 'housing'],
  HSIF: ['health', 'energy', 'telecom', 'tech'],
  HSIF03: ['energy'], HSIF14: ['health'], HSIF16: ['telecom', 'tech'], HSIF17: ['tech', 'transport'], HSIF18: ['energy', 'resources'],
  HSII: ['resources', 'energy'],
  HLIG: ['defense', 'tech'],
  HSPW: ['transport', 'infrastructure'],
  HSSY: ['space', 'tech', 'energy'],
  HSVR: ['health'],
  HSWM02: ['health'],
  HSHM: ['tech'],
  HSJU: ['tech'],
  HSZS: ['tech', 'defense'],
  HSAP: [],
  HSAP01: ['agriculture', 'health'], HSAP02: ['defense'], HSAP10: ['energy'], HSAP06: ['resources', 'energy'], HSAP07: ['health'],
  HSAP18: ['defense'], HSAP19: ['tech', 'space'], HSAP20: ['transport', 'housing'], HSAP23: ['banking'],
  // Senate
  SSAF: ['agriculture'],
  SSAS: ['defense'],
  SSBK: ['banking', 'housing'],
  SSCM: ['telecom', 'tech', 'transport', 'space'],
  SSCM33: ['space', 'transport'], SSCM34: ['telecom'], SSCM35: ['tech'], SSCM38: ['transport', 'energy'],
  SSEG: ['energy', 'resources'],
  SSEV: ['infrastructure', 'energy'],
  SSFI: ['health'], SSFI10: ['health'], SSFI12: ['energy', 'resources', 'infrastructure'],
  SSHR: ['health'],
  SPAG: ['health'],
  SLIN: ['defense', 'tech'],
  SSVA: ['health'],
  SSJU: ['tech'],
  SSAP: [],
  SSAP01: ['agriculture', 'health'], SSAP02: ['defense'], SSAP22: ['energy'], SSAP17: ['resources', 'energy'], SSAP18: ['health'],
  SSAP19: ['defense'], SSAP16: ['tech', 'space'], SSAP24: ['transport', 'housing'], SSAP23: ['banking']
};

export function themesOf(id) {
  if (id in COMMITTEE_THEMES) return COMMITTEE_THEMES[id];
  const parent = id.slice(0, 4);
  return id.length > 4 && parent in COMMITTEE_THEMES ? COMMITTEE_THEMES[parent] : [];
}

/** Themes a company falls under, from its NASDAQ sector and industry. */
export function companyThemes(sector, industry) {
  return Object.entries(THEMES).filter(([, t]) => t.test(sector || '', industry || '')).map(([k]) => k);
}

/**
 * @param {{committees:{committees:Object<string,[string,string]>, members:Object<string,[string,string][]>}, companyOf:(t:string)=>({sector:string,industry:string}|null)}} deps
 * @returns {(ticker:string, bioguide:string|null) => null | {id:string, committee:string, theme:string, themeLabel:string, leader:boolean, role:string, seats:{id:string, committee:string, role:string}[]}}
 */
export function createOversight({ committees, companyOf }) {
  const C = committees?.committees || {};
  const M = committees?.members || {};
  const cache = new Map();
  return function oversight(ticker, bioguide) {
    if (!ticker || !bioguide || !M[bioguide]) return null;
    const key = `${ticker}|${bioguide}`;
    if (cache.has(key)) return cache.get(key);
    const co = companyOf(ticker);
    const themes = co ? companyThemes(co.sector, co.industry) : [];
    let out = null;
    if (themes.length) {
      const seats = [];
      for (const [id, role] of M[bioguide]) {
        const hit = themesOf(id).find(t => themes.includes(t));
        if (hit && C[id]) seats.push({ id, committee: C[id][0], role, theme: hit });
      }
      if (seats.length) {
        // Report the most telling seat: leadership first, then the full committee over a subcommittee.
        seats.sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.id.length - b.id.length);
        const best = seats[0];
        out = { id: best.id, committee: best.committee, theme: best.theme, themeLabel: THEMES[best.theme].label, leader: seats.some(s => s.role === 'chair' || s.role === 'ranking'), role: best.role, seats };
      }
    }
    cache.set(key, out);
    return out;
  };
}

/** All committee seats for one member, full committees first. */
export function memberSeats(committees, bioguide) {
  const C = committees?.committees || {};
  return ((committees?.members || {})[bioguide] || [])
    .filter(([id]) => C[id])
    .map(([id, role]) => ({ id, committee: C[id][0], role, themes: themesOf(id) }))
    .sort((a, b) => a.id.length - b.id.length || a.committee.localeCompare(b.committee));
}
