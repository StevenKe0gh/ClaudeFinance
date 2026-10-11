// German income tax for a single filer (Einzelveranlagung), 2024–2026.
// Pure functions, no DOM: the worksheet page and the tests share this file.
// Estimates for planning a return, not a binding assessment.

export const YEARS = [2024, 2025, 2026];

/** Statutory parameters per year (EStG as amended by the Steuerfortentwicklungsgesetz, Dec 2024). */
export const PARAMS = {
  2024: {
    // § 32a: Grundfreibetrag raised retroactively from 11,604 to 11,784.
    tariff: { gfb: 11784, z2: 17005, a2: 954.8, z3: 66760, a3: 181.19, c3: 991.21, c4: 10636.31, c5: 18971.06 },
    soliFree: 18130, minijob: 538, kmLow: 0.30, kmHigh: 0.38,
    deadlineMandatory: '2025-07-31', deadlineVoluntary: '2028-12-31'
  },
  2025: {
    tariff: { gfb: 12096, z2: 17443, a2: 932.3, z3: 68480, a3: 176.64, c3: 1015.13, c4: 10911.92, c5: 19246.67 },
    soliFree: 19950, minijob: 556, kmLow: 0.30, kmHigh: 0.38,
    deadlineMandatory: '2026-07-31', deadlineVoluntary: '2029-12-31'
  },
  2026: {
    tariff: { gfb: 12348, z2: 17799, a2: 914.51, z3: 69878, a3: 173.1, c3: 1034.87, c4: 11135.63, c5: 19470.38 },
    soliFree: 20350, minijob: 603, kmLow: 0.38, kmHigh: 0.38,
    deadlineMandatory: '2027-07-31', deadlineVoluntary: '2030-12-31'
  }
};

export const CONST = {
  employeeAllowance: 1230,   // Arbeitnehmer-Pauschbetrag
  specialAllowance: 36,      // Sonderausgaben-Pauschbetrag
  saverAllowance: 1000,      // Sparer-Pauschbetrag
  flatRate: 0.25,            // Abgeltungsteuer
  soliRate: 0.055,
  firstDegreeCap: 6000,      // Erstausbildung as Sonderausgaben, § 10 (1) Nr. 7
  homeOfficePerDay: 6, homeOfficeCap: 1260,
  laptopInstantLimit: 952,   // GWG limit 800 € net ≈ 952 € gross; computers may be written off in one year anyway
  otherIncomeLimit: 410      // § 46 (2) Nr. 1: income without wage tax above this makes filing mandatory
};

/** Income tax per § 32a EStG on taxable income (zvE), rounded down to whole euros as the statute does. */
export function incomeTax(zvE, year) {
  const t = PARAMS[year].tariff;
  const x = Math.floor(Math.max(0, zvE));
  let tax;
  if (x <= t.gfb) tax = 0;
  else if (x <= t.z2) { const y = (x - t.gfb) / 10000; tax = (t.a2 * y + 1400) * y; }
  else if (x <= t.z3) { const z = (x - t.z2) / 10000; tax = (t.a3 * z + 2397) * z + t.c3; }
  else if (x <= 277825) tax = 0.42 * x - t.c4;
  else tax = 0.45 * x - t.c5;
  return Math.floor(tax);
}

/** Solidarity surcharge with the exemption threshold and the 11.9 % phase-in. */
export function soli(tax, year) {
  const free = PARAMS[year].soliFree;
  if (tax <= free) return 0;
  return Math.min(tax * CONST.soliRate, (tax - free) * 0.119);
}

const DAY = 864e5;
const d = s => (s ? new Date(s + 'T00:00:00Z') : null);

/** Days of a job that fall inside a calendar year (inclusive), 0 when dates are missing. */
export function daysInYear(from, to, year) {
  const a = d(from), b = d(to);
  if (!a || !b || b < a) return 0;
  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year, 11, 31);
  const s = Math.max(a.getTime(), y0), e = Math.min(b.getTime(), y1);
  return e < s ? 0 : Math.round((e - s) / DAY) + 1;
}

/**
 * Rough monthly wage-tax withholding (tax class I) when the Lohnsteuerbescheinigung
 * is not at hand: the payroll annualises the monthly wage, deducts the allowances
 * and a pension/health allowance (Vorsorgepauschale), and withholds a twelfth.
 */
export function estimateWithholding(monthlyGross, months, year, { socialSecurity = true, church = 0 } = {}) {
  if (!(monthlyGross > 0) || !(months > 0)) return { lst: 0, soli: 0, kist: 0 };
  const annual = monthlyGross * 12;
  const vsp = socialSecurity ? annual * 0.1945 : Math.min(annual * 0.12, 1900);
  const zvE = annual - CONST.employeeAllowance - CONST.specialAllowance - vsp;
  const monthly = incomeTax(zvE, year) / 12;
  const lst = Math.round(monthly * months * 100) / 100;
  return { lst, soli: 0, kist: Math.round(lst * church * 100) / 100 };
}

/** Employee social-security share for an estimate: full rates above 20 h/week, pension only for working students. */
export function estimateSocial(gross, type, hoursPerWeek) {
  if (type !== 'payroll' || !(gross > 0)) return { rv: 0, kv: 0, pv: 0, av: 0 };
  const r = x => Math.round(gross * x * 100) / 100;
  if (hoursPerWeek && hoursPerWeek <= 20) return { rv: r(0.093), kv: 0, pv: 0, av: 0 };
  return { rv: r(0.093), kv: r(0.0815), pv: r(0.023), av: r(0.013) };
}

export const JOB_TYPES = {
  payroll: { label: 'Paid internship on payroll', short: 'Payroll' },
  mandatory: { label: 'Mandatory internship (Pflichtpraktikum) on payroll', short: 'Pflichtpraktikum' },
  minijob: { label: 'Minijob (flat-taxed by employer)', short: 'Minijob' },
  freelance: { label: 'No contract / paid on invoice (freelance)', short: 'No contract' },
  unpaid: { label: 'Unpaid', short: 'Unpaid' }
};

/**
 * One job's contribution to one tax year: actual figures from the
 * Lohnsteuerbescheinigung win over estimates from dates × hours × rate.
 */
export function jobYear(job, year, church) {
  const days = daysInYear(job.from, job.to, year);
  const act = (job.actual && job.actual[year]) || {};
  const has = k => act[k] !== '' && act[k] != null && Number.isFinite(+act[k]);
  const months = days / (365 / 12);
  const estGross = days > 0 ? Math.round((days / 7) * (+job.hoursPerWeek || 0) * (+job.rate || 0) * 100) / 100 : 0;
  const gross = has('gross') ? +act.gross : estGross;
  const out = { id: job.id, employer: job.employer || 'Unnamed', type: job.type, days, months, gross, grossIsActual: has('gross'), monthly: months > 0 ? gross / Math.max(1, months) : 0 };
  if (!(gross > 0) && !days) return null;
  if (job.type === 'payroll' || job.type === 'mandatory') {
    const est = estimateWithholding(months > 0 ? gross / Math.max(1, months) : 0, Math.max(1, Math.round(months)), year, { socialSecurity: job.type === 'payroll', church });
    out.lst = has('lst') ? +act.lst : est.lst;
    out.soli = has('soli') ? +act.soli : est.soli;
    out.kist = has('kist') ? +act.kist : est.kist;
    out.taxIsActual = has('lst');
    const soc = estimateSocial(gross, job.type, +job.hoursPerWeek);
    for (const k of ['rv', 'kv', 'pv', 'av']) out[k] = has(k) ? +act[k] : soc[k];
  } else {
    out.lst = out.soli = out.kist = 0;
    out.rv = out.kv = out.pv = out.av = 0;
  }
  if (job.type === 'freelance') out.expenses = +(act.expenses || 0);
  return out;
}

/**
 * Full estimate for one year.
 * @param {object} state  { profile: { church: 0|0.08|0.09 }, jobs: [...], years: { [year]: { study, costs, capital } } }
 */
export function computeYear(state, year) {
  const P = PARAMS[year];
  const church = +state.profile?.church || 0;
  const y = state.years?.[year] || {};
  const costs = y.costs || {};
  const cap = y.capital || {};
  const study = y.study || 'none';
  const jobs = (state.jobs || []).map(j => jobYear(j, year, church)).filter(Boolean);
  const notes = [];

  // Employment income (Anlage N)
  const payroll = jobs.filter(j => j.type === 'payroll' || j.type === 'mandatory');
  const wage = sum(payroll, j => j.gross);
  const km = +costs.commuteKm || 0, kmDays = +costs.commuteDays || 0;
  const commute = Math.round(kmDays * (Math.min(km, 20) * P.kmLow + Math.max(0, km - 20) * P.kmHigh));
  const homeOffice = Math.min(CONST.homeOfficeCap, (+costs.homeOfficeDays || 0) * CONST.homeOfficePerDay);
  const workTools = +costs.workTools || 0;
  const studyCosts = (+costs.studyFees || 0) + (+costs.studyMaterials || 0) + (+costs.laptop || 0) + (+costs.studyTravel || 0) + (+costs.otherStudy || 0);
  const secondDegree = study === 'second';
  const actualWk = commute + homeOffice + workTools + (secondDegree ? studyCosts : 0);
  const wk = wage > 0 ? Math.max(CONST.employeeAllowance, actualWk) : actualWk;
  const wkUsesAllowance = wage > 0 && actualWk < CONST.employeeAllowance;
  const incomeN = wage - wk;

  // Freelance work without payroll (Anlage G/S + EÜR)
  const free = jobs.filter(j => j.type === 'freelance');
  const freeRevenue = sum(free, j => j.gross);
  const freeExpenses = sum(free, j => j.expenses || 0);
  const incomeFree = freeRevenue - freeExpenses;

  // Special expenses (Sonderausgaben)
  const vorsorge = sum(payroll, j => j.rv + j.kv * 0.96 + j.pv + j.av) + (+costs.healthInsurance || 0);
  const firstDegree = study === 'first' ? Math.min(CONST.firstDegreeCap, studyCosts) : 0;
  const sonder = firstDegree > 0 ? firstDegree : CONST.specialAllowance;

  const gde = incomeN + incomeFree;
  const zvE = Math.max(0, gde - vorsorge - sonder);
  const lossCarry = secondDegree && gde < 0 ? -gde : 0;

  // Capital income: flat tax vs. inclusion at the personal rate (Günstigerprüfung)
  const capIncome = +cap.income || 0;
  const capTaxable = Math.max(0, capIncome - CONST.saverAllowance);
  const flatTax = Math.round(capTaxable * CONST.flatRate * 100) / 100;
  const flatSoli = Math.round(flatTax * CONST.soliRate * 100) / 100;
  const flatKist = Math.round(flatTax * church * 100) / 100;
  const taxExcl = incomeTax(zvE, year);
  const taxIncl = incomeTax(zvE + capTaxable, year);
  const flatTotal = taxExcl + soli(taxExcl, year) + taxExcl * church + flatTax + flatSoli + flatKist;
  const inclTotal = taxIncl + soli(taxIncl, year) + taxIncl * church;
  const guenstiger = capTaxable > 0 && inclTotal < flatTotal - 0.5;
  const est = guenstiger ? taxIncl : taxExcl;
  const due = {
    est, soli: Math.round(soli(est, year) * 100) / 100, kist: Math.round(est * church * 100) / 100,
    capFlat: guenstiger ? 0 : flatTax + flatSoli + flatKist
  };
  due.total = Math.round((due.est + due.soli + due.kist + due.capFlat) * 100) / 100;

  const withheld = {
    lst: sum(payroll, j => j.lst), soli: sum(payroll, j => j.soli), kist: sum(payroll, j => j.kist),
    kapest: +cap.kapest || 0, kapSoli: +cap.soli || 0, kapKist: +cap.kist || 0
  };
  withheld.total = Math.round((withheld.lst + withheld.soli + withheld.kist + withheld.kapest + withheld.kapSoli + withheld.kapKist) * 100) / 100;
  const refund = Math.round((withheld.total - due.total) * 100) / 100;

  // Is filing mandatory?
  const reasons = [];
  if (incomeFree > CONST.otherIncomeLimit) reasons.push(`income without wage tax (${fmt(incomeFree)}) above ${fmt(CONST.otherIncomeLimit)}`);
  const overlapping = payroll.some((a, i) => payroll.some((b, k) => k > i && overlaps(state.jobs.find(j => j.id === a.id), state.jobs.find(j => j.id === b.id))));
  if (overlapping) reasons.push('two payroll employers at the same time (tax class VI)');
  const mandatory = reasons.length > 0;

  // Data still missing
  const missing = [];
  for (const j of state.jobs || []) {
    if (j.type === 'unpaid') continue;
    if (!j.from || !j.to) missing.push(`${j.employer || 'A job'}: start and end dates`);
  }
  for (const j of payroll) if (!j.taxIsActual) missing.push(`${j.employer}: wage tax from the ${year} Lohnsteuerbescheinigung (using an estimate)`);
  if (capIncome === 0 && !cap.none) missing.push(`Broker tax certificate ${year} (Jahressteuerbescheinigung) for capital gains and tax withheld`);
  for (const j of jobs) if (j.type === 'minijob' && j.monthly > P.minijob + 0.5) notes.push(`${j.employer}: about ${fmt(j.monthly)} a month is above the ${fmt(P.minijob)} minijob limit; it was probably taxed as a normal job. Check the payslips.`);

  return {
    year, P, jobs, payroll, free, wage, wk, wkUsesAllowance, commute, homeOffice, workTools, studyCosts, secondDegree,
    incomeN, freeRevenue, freeExpenses, incomeFree, vorsorge, firstDegree, sonder, gde, zvE, lossCarry,
    capIncome, capTaxable, guenstiger, guenstigerSaves: Math.round((flatTotal - inclTotal) * 100) / 100,
    due, withheld, refund, mandatory, reasons, missing: [...new Set(missing)], notes
  };
}

function overlaps(a, b) {
  if (!a || !b || !a.from || !a.to || !b.from || !b.to) return false;
  return a.from <= b.to && b.from <= a.to;
}
function sum(xs, f) { return xs.reduce((s, x) => s + (+f(x) || 0), 0); }
export function fmt(n, cents = false) {
  return (+n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}
