const { DEFAULT_SERVICE, findRecordsForResident, computeAnnualPlanningWindow } = require('./annual-planning');
const { computeQuarterlyReportingForRecord } = require('./quarterly-reporting');
const { loadRequirements, staffListForLocation, staffTrainingStatus } = require('./staff-training');
const { appointmentsForResident, computeMedicalCompliance, residentsForLocation } = require('./medical-appointments');
const { supplyInfoForLocation, mostRecentDrill, mostRecentUpdate } = require('./report-status-check');
const { computeDueDate, statusForDueDate, computeSupplyDueDate, statusForSupplyDueDate } = require('./report-due-date');

const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;
const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID;
const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID;

// "My Home's Compliance": one green/yellow/red light per area for a
// sponsor's home, built on the same data and helpers each area's own
// screen uses, so the lights here never disagree with them. The rules:
//
//   Residents' Medical   Physical, Dental, Labwork, TB Test: due 12 months
//                        after the last one; yellow 30 days before; red
//                        when overdue or none on file.
//   Annual Planning      yellow once the 6-week window opens (the screen
//                        unlocks); red once past due; red if a resident
//                        has no Annual Planning on file at all.
//   Quarterly Reporting  each quarter's reports are due 15 days after the
//                        quarter ends; yellow in the 7 days before that.
//   Training & Cert.     yellow 30 days before an item expires; red when
//                        expired or any item has never been completed.
//   First Aid, Emergency Supplies, Physical Environment, Fire Drill
//                        unchanged from the Home screen's own lights.
//
// An area that can't be checked (a lookup failed) reads "unknown" rather
// than failing the whole card, and doesn't count toward the overall light.

const QUARTERLY_DAYS_AFTER_END = 15;
const QUARTERLY_YELLOW_DAYS = 7;

function todayISO(now) { return (now || new Date()).toISOString().slice(0, 10); }

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmt(iso) {
  if (!iso) return '';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function dateISO(d) {
  // Local-midnight Dates from the older helpers -> calendar date.
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function worst(statuses) {
  if (statuses.indexOf('red') !== -1) return 'red';
  if (statuses.indexOf('yellow') !== -1) return 'yellow';
  return 'green';
}

function area(key, label, details, emptyText) {
  const statuses = details.map(function (d) { return d.status; });
  const status = details.length ? worst(statuses) : 'green';
  const rank = { red: 0, yellow: 1 };
  const flagged = details.filter(function (d) { return d.status !== 'green'; })
    .sort(function (a, b) { return rank[a.status] - rank[b.status]; });
  let summary;
  if (!details.length) summary = emptyText || 'Nothing to check';
  else if (details.length === 1 && details[0].label === label) summary = details[0].text.charAt(0).toUpperCase() + details[0].text.slice(1);
  else if (!flagged.length) summary = 'All current';
  else summary = flagged.slice(0, 2).map(function (d) { return d.label + ': ' + d.text; }).join(' · ') + (flagged.length > 2 ? ' · +' + (flagged.length - 2) + ' more' : '');
  return { key: key, label: label, status: status, summary: summary, details: details };
}

function unknownArea(key, label, err) {
  console.error('Compliance check failed for ' + label, err);
  return { key: key, label: label, status: 'unknown', summary: 'Couldn’t check right now', details: [] };
}

async function safe(key, label, fn) {
  try { return await fn(); } catch (e) { return unknownArea(key, label, e); }
}

// ---- Residents' Medical ----
async function medicalArea(location, residents, now) {
  const details = [];
  await Promise.all(residents.map(async function (resident) {
    const result = computeMedicalCompliance(await appointmentsForResident(location, resident), now);
    result.items.forEach(function (item) {
      let text;
      if (item.state === 'missing') text = 'none on file';
      else if (item.state === 'overdue') text = 'overdue since ' + fmt(item.dueDate);
      else if (item.state === 'dueSoon') text = 'due ' + fmt(item.dueDate);
      else text = 'current until ' + fmt(item.dueDate);
      details.push({ label: resident + ' · ' + item.label, status: item.status, text: text });
    });
  }));
  return area('medical', "Residents' Medical", details, 'No residents assigned');
}

// ---- Annual Planning ----
function annualStatus(windowState, now) {
  if (!windowState.hasCycle) return { status: 'red', text: 'not set up yet' };
  if (windowState.isFinalizedForTarget) return { status: 'green', text: 'finalized' };
  if (!windowState.isWindowOpen) return { status: 'green', text: 'opens ' + fmt(dateISO(windowState.windowOpenDate)) };
  const due = dateISO(windowState.dueDate);
  if (todayISO(now) > due) return { status: 'red', text: 'overdue since ' + fmt(due) };
  return { status: 'yellow', text: 'due ' + fmt(due) };
}

async function annualArea(location, residents, now) {
  const details = [];
  await Promise.all(residents.map(async function (resident) {
    const records = await findRecordsForResident(location, resident);
    if (!records.length) {
      details.push({ label: resident, status: 'red', text: 'no Annual Planning on file' });
      return;
    }
    records.forEach(function (record) {
      const s = annualStatus(computeAnnualPlanningWindow(record, now), now);
      const service = record.service && record.service !== DEFAULT_SERVICE ? ' · ' + record.service : '';
      details.push({ label: resident + service, status: s.status, text: s.text });
    });
  }));
  return area('annual', 'Annual Planning', details, 'No residents assigned');
}

// ---- Quarterly Reporting ----
// One quarter's light: nothing owed until it ends; then due 15 days
// after its last day, yellow in the final 7 days, red once past due.
function quarterStatus(q, now) {
  if (!q.isOpen || q.missingCount === 0) return null;
  const due = addDaysISO(q.end, QUARTERLY_DAYS_AFTER_END);
  const today = todayISO(now);
  if (today > due) return { status: 'red', text: 'Q' + q.index + ' overdue since ' + fmt(due) };
  if (today >= addDaysISO(due, -QUARTERLY_YELLOW_DAYS)) return { status: 'yellow', text: 'Q' + q.index + ' due ' + fmt(due) };
  return { status: 'green', text: 'Q' + q.index + ' due ' + fmt(due) };
}

function quarterlyStatusForState(state, now) {
  if (!state.hasCycle) return [];
  return state.quarters.concat(state.priorCycle ? state.priorCycle.quarters : [])
    .map(function (q) { return quarterStatus(q, now); })
    .filter(Boolean);
}

async function quarterlyArea(location, residents, now) {
  const details = [];
  await Promise.all(residents.map(async function (resident) {
    const records = await findRecordsForResident(location, resident);
    await Promise.all(records.map(async function (record) {
      const state = await computeQuarterlyReportingForRecord(location, resident, record.service, record);
      const service = record.service && record.service !== DEFAULT_SERVICE ? ' · ' + record.service : '';
      const owed = quarterlyStatusForState(state, now);
      if (!state.hasCycle) return; // Annual Planning reports this
      if (!owed.length) {
        details.push({ label: resident + service, status: 'green', text: 'nothing due' });
      } else {
        owed.forEach(function (o) { details.push({ label: resident + service, status: o.status, text: o.text }); });
      }
    }));
  }));
  return area('quarterly', 'Quarterly Reporting', details, 'Nothing due yet');
}

// ---- Training & Certification ----
async function trainingArea(location, now) {
  const requirements = (await loadRequirements()).requirements;
  const staff = await staffListForLocation(location);
  const details = await Promise.all(staff.map(async function (member) {
    const w = (await staffTrainingStatus(location, member, requirements, now)).window;
    const due = w.dueDate ? dateISO(w.dueDate) : '';
    if (w.isOverdue) return { label: member.name, status: 'red', text: 'expired ' + fmt(due) };
    if (w.missingCount > 0) {
      return { label: member.name, status: 'red', text: w.missingCount + ' of ' + w.totalCount + ' items not completed' };
    }
    if (w.isDueSoon) return { label: member.name, status: 'yellow', text: 'next item due ' + fmt(due) };
    return { label: member.name, status: 'green', text: due ? 'current until ' + fmt(due) : 'current' };
  }));
  return area('training', 'Training & Certification', details, 'No staff on file');
}

// ---- The four monthly reports (same rules as the Home screen lights) ----
function monthlyDetail(label, lastReviewed, dueDate, status) {
  let text;
  if (!lastReviewed) text = 'never completed';
  else if (!dueDate) text = 'reviewed ' + fmt(lastReviewed) + ', nothing expiring';
  else text = 'last done ' + fmt(lastReviewed) + ' · due ' + fmt(dateISO(dueDate));
  return area(label.key, label.name, [{ label: label.name, status: status, text: text }]);
}

async function supplyArea(key, name, dbId, location, now) {
  const info = await supplyInfoForLocation(dbId, location);
  const due = computeSupplyDueDate(info.items);
  return monthlyDetail({ key: key, name: name }, info.lastReviewed, due, statusForSupplyDueDate(info.lastReviewed, due, now));
}

async function physicalArea(location, now) {
  const last = await mostRecentUpdate(PHYSICAL_ENV_DB_ID, location);
  const due = computeDueDate(last, now);
  return monthlyDetail({ key: 'physical', name: 'Physical Environment' }, last, due, statusForDueDate(last, due, now));
}

async function fireDrillArea(location, now) {
  const last = await mostRecentDrill(location);
  const due = computeDueDate(last, now);
  return monthlyDetail({ key: 'fireDrill', name: 'Fire Drill' }, last, due, statusForDueDate(last, due, now));
}

// residents: the sponsor's residents (initials).
async function homeCompliance(location, residents, now) {
  now = now || new Date();
  const areas = await Promise.all([
    safe('medical', "Residents' Medical", function () { return medicalArea(location, residents, now); }),
    safe('annual', 'Annual Planning', function () { return annualArea(location, residents, now); }),
    safe('quarterly', 'Quarterly Reporting', function () { return quarterlyArea(location, residents, now); }),
    safe('training', 'Training & Certification', function () { return trainingArea(location, now); }),
    safe('firstAid', 'First Aid Kit Supplies', function () { return supplyArea('firstAid', 'First Aid Kit Supplies', FIRST_AID_DB_ID, location, now); }),
    safe('emergency', 'Emergency Supplies', function () { return supplyArea('emergency', 'Emergency Supplies', EMERGENCY_SUPPLIES_DB_ID, location, now); }),
    safe('physical', 'Physical Environment', function () { return physicalArea(location, now); }),
    safe('fireDrill', 'Fire Drill', function () { return fireDrillArea(location, now); })
  ]);
  const known = areas.filter(function (a) { return a.status !== 'unknown'; });
  const counts = { green: 0, yellow: 0, red: 0, unknown: 0 };
  areas.forEach(function (a) { counts[a.status]++; });
  return { overall: worst(known.map(function (a) { return a.status; })), counts: counts, areas: areas };
}

// Compliance is by location (each home is its own location, with up to
// two residents): the residents are everyone active at the location, the
// same list the Medical tab, MAR Review and Annual Planning use (a
// resident appears once they have a medication on file), not the
// Resident Initials on any one sponsor's row. The Sponsor App's My Home's
// Compliance and the admin dashboard's Compliance tab both call this, so
// they always match.
async function locationCompliance(location, now) {
  const residents = await residentsForLocation(location);
  const result = await homeCompliance(location, residents, now);
  return Object.assign({ location: location, residents: residents }, result);
}

function parseResidents(residentInitials) {
  return (residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

module.exports = { homeCompliance, locationCompliance, parseResidents, annualStatus, quarterStatus, quarterlyStatusForState, worst };
