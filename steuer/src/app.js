// Worksheet UI. Depends on tax.mjs (inlined before this file by build.mjs).

const KEY = 'steuer.worksheet.v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtDate = s => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '');
const de = (n, cents = true) => (+n || 0).toLocaleString('de-DE', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

function blank() {
  return {
    v: 1,
    profile: { church: 0 },
    jobs: [{ id: uid(), employer: 'Strategybridge', type: 'freelance', from: '', to: '', hoursPerWeek: '', rate: 15, actual: {} }],
    years: Object.fromEntries(YEARS.map(y => [y, { study: 'first', costs: {}, capital: {} }])),
    updatedAt: 0
  };
}
function normalise(s) {
  const b = blank();
  if (!s || s.v !== 1) return b;
  s.profile = { ...b.profile, ...(s.profile || {}) };
  s.jobs = Array.isArray(s.jobs) ? s.jobs : [];
  s.years = { ...b.years, ...(s.years || {}) };
  for (const y of YEARS) s.years[y] = { study: 'first', costs: {}, capital: {}, ...(s.years[y] || {}) };
  return s;
}

let state = (() => { try { return normalise(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return blank(); } })();
let year = 2025;
let dbRef = null;
let saveState = 'local';
let writing = Promise.resolve();
let saveTimer = 0;

function save() {
  state.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: keep in memory */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!dbRef) { setSaved(); return; }
    const snap = JSON.parse(JSON.stringify(state));
    writing = writing.then(() => dbRef.set(snap)).then(() => { saveState = 'saved'; setSaved(); }).catch(() => { saveState = 'error'; setSaved(); });
  }, 700);
}
function setSaved() {
  const el = $('#saved');
  if (el) el.textContent = saveState === 'saved' ? `Saved to your account · ${new Date(state.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : saveState === 'error' ? 'Could not save to your account; kept in this browser' : 'Kept in this browser';
}

/* ---------- Rendering ---------- */
function render() {
  renderTabs();
  renderInputs();
  renderResult();
}
function renderLive() {
  renderTabs();
  renderResult();
  for (const j of state.jobs) { const c = $(`#chips-${j.id}`); if (c) c.innerHTML = jobChips(j); }
}

function renderTabs() {
  const totals = YEARS.map(y => computeYear(state, y));
  const past = totals.filter(r => r.year < 2026);
  const refund = past.reduce((s, r) => s + r.refund, 0);
  $('#hero').innerHTML = `<div class="label">Estimated refund 2024 + 2025</div><div class="v ${refund < 0 ? 'pay' : ''}">${esc(fmt(refund))}</div><div class="s">${totals[2].refund ? `2026 so far: ${esc(fmt(totals[2].refund))} · file from January 2027` : 'File 2024 and 2025 now; 2026 from January 2027'}</div>`;
  $('#tabs').innerHTML = totals.map(r => `<button class="tab" role="tab" type="button" data-year="${r.year}" aria-selected="${r.year === year}">${r.year}${r.year === 2026 ? ' (running)' : ''}<span class="amt">${esc(fmt(r.refund))}</span></button>`).join('');
}

function jobYears(j) { return YEARS.filter(y => daysInYear(j.from, j.to, y) > 0); }
function jobChips(j) {
  const parts = [];
  if (j.type !== 'unpaid' && (!j.from || !j.to)) parts.push(`<span class="chip warn">Add start and end dates</span>`);
  for (const y of jobYears(j)) {
    const r = jobYear(j, y, +state.profile.church || 0);
    if (!r) continue;
    const hours = (r.days / 7) * (+j.hoursPerWeek || 0);
    parts.push(`<span class="chip">${y}: ${r.grossIsActual ? '' : '≈ '}${esc(fmt(r.gross))}${hours && !r.grossIsActual ? ` · ${Math.round(hours)} h` : ''}${r.lst ? ` · tax ${r.taxIsActual ? '' : '≈ '}${esc(fmt(r.lst))}` : ''}</span>`);
  }
  return parts.join('');
}

function jobCard(j) {
  const types = Object.entries(JOB_TYPES).map(([k, t]) => `<option value="${k}" ${j.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  const ys = jobYears(j);
  const payroll = j.type === 'payroll' || j.type === 'mandatory';
  const lstFields = y => {
    const a = (j.actual && j.actual[y]) || {};
    const f = (k, label, hint = '') => `<div class="field"><label for="a-${j.id}-${y}-${k}">${label}</label><input type="number" step="0.01" min="0" id="a-${j.id}-${y}-${k}" data-job="${j.id}" data-y="${y}" data-a="${k}" value="${esc(a[k] ?? '')}" placeholder="from line">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    if (payroll) return `<div class="yearbox"><div class="label">${y} · Lohnsteuerbescheinigung</div><div class="fields">${f('gross', 'Gross wage (line 3)')}${f('lst', 'Wage tax (line 4)')}${f('soli', 'Soli (line 5)')}${f('kist', 'Church tax (line 6)')}${f('rv', 'Pension, your share (line 23a)')}${f('kv', 'Health, your share (line 25)')}${f('pv', 'Care, your share (line 26)')}${f('av', 'Unemployment (line 27)')}</div></div>`;
    if (j.type === 'freelance') return `<div class="yearbox"><div class="label">${y} · actual figures</div><div class="fields">${f('gross', 'Amount received', 'if different from hours × rate')}${f('expenses', 'Business expenses', 'laptop share, travel, software')}</div></div>`;
    return '';
  };
  return `<div class="job" data-card="${j.id}">
    <div class="head"><input aria-label="Employer" value="${esc(j.employer)}" data-job="${j.id}" data-f="employer" placeholder="Company"><button class="btn ghost sm" type="button" data-del="${j.id}" aria-label="Remove ${esc(j.employer || 'job')}">Remove</button></div>
    <div class="fields">
      <div class="field wide"><label for="t-${j.id}">How it was paid</label><select id="t-${j.id}" data-job="${j.id}" data-f="type">${types}</select></div>
      <div class="field"><label for="f-${j.id}">From</label><input type="date" id="f-${j.id}" data-job="${j.id}" data-f="from" value="${esc(j.from)}" min="2024-01-01" max="2026-12-31"></div>
      <div class="field"><label for="to-${j.id}">To</label><input type="date" id="to-${j.id}" data-job="${j.id}" data-f="to" value="${esc(j.to)}" min="2024-01-01" max="2026-12-31"></div>
      <div class="field"><label for="h-${j.id}">Hours per week</label><input type="number" min="0" max="60" step="0.5" id="h-${j.id}" data-job="${j.id}" data-f="hoursPerWeek" value="${esc(j.hoursPerWeek)}"></div>
      <div class="field"><label for="r-${j.id}">€ per hour</label><input type="number" min="0" step="0.01" id="r-${j.id}" data-job="${j.id}" data-f="rate" value="${esc(j.rate)}"></div>
    </div>
    <div class="chips" id="chips-${j.id}">${jobChips(j)}</div>
    ${(payroll || j.type === 'freelance') && ys.length ? `<details ${ys.some(y => j.actual?.[y]?.lst || j.actual?.[y]?.gross) ? 'open' : ''}><summary>${payroll ? 'Exact figures from the Lohnsteuerbescheinigung (replaces the estimate)' : 'Exact amounts received and expenses'}</summary>${ys.map(lstFields).join('')}</details>` : ''}
    ${j.type === 'freelance' ? `<p class="xs muted">No contract and no payslip means no wage tax was withheld. The money still counts as income (Anlage G or S with an EÜR). Above 410 € a year the return becomes mandatory, but below the basic allowance no tax is due.</p>` : ''}
    ${j.type === 'minijob' ? `<p class="xs muted">Minijobs are usually flat-taxed by the employer (2 %) and do not appear in your return. If your payslips show wage tax under tax class I, choose “Paid internship on payroll”.</p>` : ''}
  </div>`;
}

function renderInputs() {
  const y = state.years[year];
  const c = y.costs || {};
  const cap = y.capital || {};
  const num = (k, label, hint = '', src = 'cost', val = c[k]) => `<div class="field"><label for="${src}-${k}">${label}</label><input type="number" min="0" step="0.01" id="${src}-${k}" data-${src}="${k}" value="${esc(val ?? '')}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  $('#inputs').innerHTML = `
    <section class="card"><header><span class="step">1</span><h2>Your internships</h2><span class="grow"></span><button class="btn primary sm" type="button" id="add-job">+ Add internship</button></header>
      <p class="small muted">Enter every job since January 2024 once. Dates decide which tax year the money belongs to. Without the Lohnsteuerbescheinigung the page estimates gross pay from hours × rate and the tax withheld from a tax-class-I payroll.</p>
      ${state.jobs.length ? state.jobs.map(jobCard).join('') : '<p class="empty">No internships yet.</p>'}
    </section>
    <section class="card"><header><span class="step">2</span><h2>Studies and work costs in ${year}</h2></header>
      <div class="field wide"><span class="label">What were you studying in ${year}?</span>
        <div class="seg" role="group" aria-label="Study status">${[['first', 'Bachelor (first degree)'], ['second', 'Master or second degree'], ['none', 'Not enrolled']].map(([k, l]) => `<button type="button" data-study="${k}" aria-pressed="${y.study === k}">${l}</button>`).join('')}</div>
        <span class="hint">${y.study === 'second' ? 'Second degree: study costs are business expenses (Werbungskosten). What your income does not absorb is carried forward as a loss into your first working years.' : y.study === 'first' ? 'First degree: study costs count as special expenses up to 6.000 € but only reduce tax in the same year; nothing carries forward.' : 'Not enrolled: study costs are ignored.'}</span></div>
      <div class="fields">
        ${num('studyFees', 'Semester fees', 'Semesterbeitrag, tuition')}
        ${num('studyMaterials', 'Books and materials')}
        ${num('laptop', 'Laptop and IT', 'share used for study or work')}
        ${num('studyTravel', 'Travel to university', 'costs or 0,30 €/km')}
        ${num('otherStudy', 'Other study costs', 'courses, exam fees')}
        ${num('healthInsurance', 'Own health insurance paid', 'student insurance, if not via parents')}
      </div>
      <div class="label">Commuting to internships</div>
      <div class="fields">
        ${num('commuteKm', 'Distance, one way (km)')}
        ${num('commuteDays', 'Days you went in')}
        ${num('homeOfficeDays', 'Home-office days', '6 € a day, up to 210 days')}
        ${num('workTools', 'Work equipment', 'bought for the internship')}
      </div>
    </section>
    <section class="card"><header><span class="step">3</span><h2>Investments in ${year}</h2></header>
      <p class="small muted">Your broker withholds 25 % flat tax on gains above your Freistellungsauftrag. With income this low you can ask for your personal rate instead (Günstigerprüfung) and get most or all of it back. The figures are on the broker's Jahressteuerbescheinigung (Scalable Capital: app → Profile → Documents → Tax).</p>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-cap="none" ${cap.none ? 'checked' : ''}> No investment income in ${year}</label>
      ${cap.none ? '' : `<div class="fields">
        ${num('income', 'Capital income', 'Höhe der Kapitalerträge (gains + dividends)', 'cap', cap.income)}
        ${num('kapest', 'Kapitalertragsteuer withheld', '', 'cap', cap.kapest)}
        ${num('soli', 'Soli withheld', '', 'cap', cap.soli)}
        ${num('kist', 'Church tax withheld', '', 'cap', cap.kist)}
      </div>`}
    </section>
    <section class="card"><header><span class="step">4</span><h2>About you</h2><span class="grow"></span><span class="saved" id="saved"></span></header>
      <div class="field wide"><span class="label">Church tax</span>
        <div class="seg" role="group" aria-label="Church tax">${[[0, 'Not a member'], [0.08, '8 % (Bavaria, Baden-Württemberg)'], [0.09, '9 % (other states)']].map(([v, l]) => `<button type="button" data-church="${v}" aria-pressed="${(+state.profile.church || 0) === v}">${l}</button>`).join('')}</div></div>
    </section>`;
  setSaved();
}

function renderResult() {
  const r = computeYear(state, year);
  const max = Math.max(1, r.withheld.total, r.due.total);
  const pay = r.refund < 0;
  const est = r.payroll.some(j => !j.taxIsActual);
  const deadline = year === 2026 ? 'File from January 2027' : r.mandatory ? `Filing required · deadline was ${fmtDate(r.P.deadlineMandatory)}` : `Voluntary · file by ${fmtDate(r.P.deadlineVoluntary)}`;
  const calcRows = [
    ['Wages (Anlage N)', r.wage],
    r.wage || r.wk ? [`− Work expenses${r.wkUsesAllowance ? ' (allowance 1.230 €)' : ''}`, -r.wk, true] : null,
    r.freeRevenue ? ['Freelance income, no contract', r.freeRevenue] : null,
    r.freeExpenses ? ['− Business expenses', -r.freeExpenses, true] : null,
    ['= Total income', r.gde],
    r.vorsorge ? ['− Insurance contributions', -r.vorsorge, true] : null,
    [`− Special expenses${r.firstDegree ? ' (first-degree costs)' : ' (allowance)'}`, -r.sonder, true],
    ['= Taxable income', r.zvE],
    [`Basic allowance ${year}`, r.P.tariff.gfb, true],
    r.capIncome ? [`Capital income${r.guenstiger ? ' (taxed at your rate)' : ' (25 % flat tax)'}`, r.capIncome] : null
  ].filter(Boolean);
  $('#result').innerHTML = `
    <section class="card">
      <header><h2>${year}${year === 2026 ? ' so far' : ''}</h2><span class="grow"></span><span class="label">${pay ? 'Estimated payment' : 'Estimated refund'}</span></header>
      <div class="big"><span class="v ${pay ? 'pay' : ''}">${esc(fmt(Math.abs(r.refund)))}</span>${est ? '<span class="pill must">estimate until you enter the Lohnsteuerbescheinigung</span>' : ''}</div>
      <div class="status"><span class="pill ${r.mandatory ? 'must' : 'ok'}">${esc(deadline)}</span>${r.guenstiger ? `<span class="pill ok">Günstigerprüfung saves ${esc(fmt(r.guenstigerSaves))}</span>` : ''}${r.lossCarry ? `<span class="pill ok">Loss carried forward ${esc(fmt(r.lossCarry))}</span>` : ''}</div>
      ${r.mandatory ? `<p class="small muted">Mandatory because of ${esc(r.reasons.join(' and '))}. ${year < 2026 ? 'The deadline has passed. File now; when the result is a refund or no tax, the Finanzamt charges no late fee.' : ''}</p>` : ''}
      <div class="bars" role="img" aria-label="Tax withheld ${esc(fmt(r.withheld.total))}, tax due ${esc(fmt(r.due.total))}">
        <div class="bar-row"><span>Already paid</span><span class="track"><i class="w" style="width:${(100 * r.withheld.total) / max}%"></i></span><span class="num">${esc(fmt(r.withheld.total, true))}</span></div>
        <div class="bar-row"><span>Actually due</span><span class="track"><i class="d" style="width:${(100 * r.due.total) / max}%"></i></span><span class="num">${esc(fmt(r.due.total, true))}</span></div>
      </div>
      <table class="calc"><tbody>${calcRows.map(([l, v, sub]) => `<tr class="${sub ? 'sub' : ''}${l.startsWith('= Taxable') ? ' tot' : ''}"><td>${esc(l)}</td><td>${esc(fmt(v))}</td></tr>`).join('')}</tbody></table>
      ${r.missing.length ? `<div><div class="label" style="margin-bottom:6px">Still needed</div><ul class="list todo">${r.missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      ${r.notes.length ? `<ul class="list note">${r.notes.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="card"><header><h2>ELSTER, field by field</h2><span class="grow"></span><button class="btn sm" type="button" id="copy-all">Copy all</button></header>
      <div class="note-box"><b>Fastest route</b><span>In Mein ELSTER open “Einkommensteuererklärung ${year}” and use <b>Belegabruf</b> (vorausgefüllte Steuererklärung): your employers' Lohnsteuerbescheinigungen and insurance data arrive pre-filled. Then check them against the values below and add the rest.</span></div>
      ${elster(r)}
    </section>`;
}

function elster(r) {
  const row = (label, value, opts = {}) => {
    const v = typeof value === 'number' ? de(value, opts.cents !== false) : String(value);
    return `<div class="row"><span>${esc(label)}${opts.note ? `<em>${esc(opts.note)}</em>` : ''}</span><span class="val ${opts.est ? 'est' : ''}" title="${opts.est ? 'Estimate: replace with your document' : ''}">${esc(v)}</span><button class="copy" type="button" data-copy="${esc(v)}" aria-label="Copy ${esc(label)}">Copy</button></div>`;
  };
  const forms = [];
  forms.push(`<div class="form"><h3>Hauptvordruck (ESt 1 A)<span class="why">personal data and the account for the refund</span></h3>${row('Steuerliche Identifikationsnummer', 'from your Steuer-ID letter')}${row('Bankverbindung (IBAN) for the refund', 'your IBAN')}${row('Einzelveranlagung', 'yes')}</div>`);
  for (const j of r.payroll) {
    forms.push(`<div class="form"><h3>Anlage N · ${esc(j.employer)}<span class="why">${j.taxIsActual ? 'from the Lohnsteuerbescheinigung' : 'estimated: replace with the Lohnsteuerbescheinigung'}</span></h3>
      ${row('Bruttoarbeitslohn', j.gross, { est: !j.grossIsActual })}
      ${row('Einbehaltene Lohnsteuer', j.lst, { est: !j.taxIsActual })}
      ${row('Einbehaltener Solidaritätszuschlag', j.soli, { est: !j.taxIsActual })}
      ${row('Einbehaltene Kirchensteuer', j.kist, { est: !j.taxIsActual })}</div>`);
  }
  const wk = [];
  if (r.commute) wk.push(row('Wege zur ersten Tätigkeitsstätte: Arbeitstage', +(state.years[r.year].costs.commuteDays || 0), { cents: false }), row('Entfernung (km, einfach)', +(state.years[r.year].costs.commuteKm || 0), { cents: false, note: `= ${fmt(r.commute)} commuting allowance` }));
  if (r.homeOffice) wk.push(row('Tagespauschale Homeoffice: Tage', Math.round(r.homeOffice / 6), { cents: false }));
  if (r.workTools) wk.push(row('Arbeitsmittel', r.workTools));
  if (r.secondDegree && r.studyCosts) wk.push(row('Fortbildungskosten (Zweitstudium)', r.studyCosts, { note: 'fees, books, laptop, travel to university' }));
  if (wk.length) forms.push(`<div class="form"><h3>Anlage N · Werbungskosten<span class="why">${r.wkUsesAllowance ? `below the 1.230 € allowance, which applies anyway` : 'above the allowance: enter them'}</span></h3>${wk.join('')}</div>`);
  if (r.payroll.some(j => j.rv || j.kv)) forms.push(`<div class="form"><h3>Anlage Vorsorgeaufwand<span class="why">usually pre-filled from the Lohnsteuerbescheinigung</span></h3>${row('Arbeitnehmeranteil Rentenversicherung', r.payroll.reduce((s, j) => s + j.rv, 0), { est: r.payroll.some(j => !j.taxIsActual) })}${row('Arbeitnehmeranteil Kranken- und Pflegeversicherung', r.payroll.reduce((s, j) => s + j.kv + j.pv, 0), { est: r.payroll.some(j => !j.taxIsActual) })}${+state.years[r.year].costs.healthInsurance ? row('Eigene Beiträge zur Krankenversicherung (Studenten)', +state.years[r.year].costs.healthInsurance) : ''}</div>`);
  if (r.firstDegree) forms.push(`<div class="form"><h3>Anlage Sonderausgaben<span class="why">first degree</span></h3>${row('Aufwendungen für die eigene erstmalige Berufsausbildung', r.firstDegree)}</div>`);
  if (r.capIncome) {
    const cap = state.years[r.year].capital;
    forms.push(`<div class="form"><h3>Anlage KAP<span class="why">${r.guenstiger ? 'taxed at your personal rate' : 'checks the flat tax and your allowance'}</span></h3>
      ${row('Zeile 4: Antrag auf Günstigerprüfung', r.guenstiger ? '1 (ja)' : 'leave empty', { note: r.guenstiger ? `saves about ${fmt(r.guenstigerSaves)}` : 'your rate is not lower than 25 %' })}
      ${r.guenstiger ? '' : row('Zeile 5: Überprüfung des Steuereinbehalts', '1 (ja)', { note: 'so unused Sparer-Pauschbetrag is credited' })}
      ${row('Zeile 7: Kapitalerträge (inländische Bank)', +cap.income || 0)}
      ${row('Zeile 16: In Anspruch genommener Sparer-Pauschbetrag', 'see certificate', { note: 'the amount your broker already applied' })}
      ${row('Kapitalertragsteuer (Steuerabzugsbeträge)', +cap.kapest || 0)}
      ${row('Solidaritätszuschlag', +cap.soli || 0)}
      ${row('Kirchensteuer zur Kapitalertragsteuer', +cap.kist || 0)}</div>`);
  }
  if (r.free.length) forms.push(`<div class="form"><h3>Anlage G (or S) and Anlage EÜR<span class="why">${esc(r.free.map(j => j.employer).join(', '))}, no contract</span></h3>
    ${row('EÜR: Betriebseinnahmen', r.freeRevenue)}
    ${row('EÜR: Betriebsausgaben', r.freeExpenses)}
    ${row('Gewinn (Anlage G, Zeile 4, or Anlage S)', r.incomeFree)}
    ${row('Umsatzsteuer: Kleinunternehmer (§ 19 UStG)', 'yes', { note: 'revenue far below the threshold' })}</div>`);
  if (r.lossCarry) forms.push(`<div class="form"><h3>Verlustfeststellung<span class="why">Master's costs not absorbed by income</span></h3>${row('Antrag auf Feststellung des verbleibenden Verlustvortrags', 'tick in the Hauptvordruck')}${row('Expected loss carried forward', r.lossCarry)}</div>`);
  return forms.join('');
}

/* ---------- Events ---------- */
function setPath(t) {
  const v = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.job) {
    const j = state.jobs.find(x => x.id === t.dataset.job);
    if (!j) return false;
    if (t.dataset.a) { j.actual = j.actual || {}; j.actual[t.dataset.y] = { ...(j.actual[t.dataset.y] || {}), [t.dataset.a]: v }; }
    else j[t.dataset.f] = v;
    return t.dataset.f === 'type' || t.dataset.f === 'from' || t.dataset.f === 'to';
  }
  if (t.dataset.cost) { state.years[year].costs = { ...state.years[year].costs, [t.dataset.cost]: v }; return false; }
  if (t.dataset.cap) { state.years[year].capital = { ...state.years[year].capital, [t.dataset.cap]: v }; return t.dataset.cap === 'none'; }
  return false;
}
document.addEventListener('input', ev => {
  const t = ev.target;
  if (!t.matches('[data-job],[data-cost],[data-cap]') || t.type === 'checkbox' || t.tagName === 'SELECT') return;
  setPath(t);
  save();
  renderLive();
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (!t.matches('[data-job],[data-cost],[data-cap]')) return;
  const structural = setPath(t);
  save();
  if (structural) render(); else renderLive();
});
document.addEventListener('click', async ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.year) { year = +b.dataset.year; render(); return; }
  if (b.id === 'add-job') { state.jobs.push({ id: uid(), employer: '', type: 'payroll', from: '', to: '', hoursPerWeek: 40, rate: 15, actual: {} }); save(); render(); const inputs = document.querySelectorAll('.job .head input'); inputs[inputs.length - 1]?.focus(); return; }
  if (b.dataset.del) { state.jobs = state.jobs.filter(j => j.id !== b.dataset.del); save(); render(); return; }
  if (b.dataset.study) { state.years[year].study = b.dataset.study; save(); render(); return; }
  if (b.dataset.church != null) { state.profile.church = +b.dataset.church; save(); render(); return; }
  if (b.dataset.copy != null || b.id === 'copy-all') {
    const text = b.id === 'copy-all'
      ? [...document.querySelectorAll('#result .form')].map(f => `${f.querySelector('h3').firstChild.textContent}\n${[...f.querySelectorAll('.row')].map(r => `  ${r.firstElementChild.firstChild.textContent}: ${r.querySelector('.val').textContent}`).join('\n')}`).join('\n\n')
      : b.dataset.copy;
    try { await navigator.clipboard.writeText(text); const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = old; }, 1200); }
    catch { const r = document.createRange(); const target = b.id === 'copy-all' ? $('#result') : b.previousElementSibling; r.selectNodeContents(target); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
});

/* ---------- Boot ---------- */
render();
(async () => {
  const C = window.claude;
  if (!C || typeof C.use !== 'function') return;
  const [db, user] = await Promise.all([C.use('db').catch(() => null), C.use('user').catch(() => null)]);
  if (!db || !user) return;
  const id = await user.id().catch(() => null);
  if (!id) return;
  dbRef = db.doc(`data/users/${id}/steuer`);
  let first = true;
  dbRef.onSnapshot(snap => {
    const remote = snap.exists ? normalise(snap.data()) : null;
    if (first) {
      first = false;
      if (remote && remote.updatedAt > (state.updatedAt || 0)) { state = remote; saveState = 'saved'; render(); }
      else if (state.updatedAt) { saveState = 'saved'; save(); }
      else { saveState = 'saved'; setSaved(); }
      return;
    }
    if (remote && remote.updatedAt > state.updatedAt && !document.activeElement?.matches('input,select')) { state = remote; render(); }
  }, () => { saveState = 'error'; setSaved(); });
})();
