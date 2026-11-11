const { encryptToken, decryptToken } = require('./crypto');
const { queryDatabaseAll, getPlainText } = require('./notion');
const annualPlanning = require('./annual-planning');
const staffTraining = require('./staff-training');
const quarterly = require('./quarterly-reporting');
const medical = require('./medical-appointments');
const intake = require('./sponsor-intake');

// The nightly Drive check: picks up hand-placed documents for every
// resident, staff member and open intake (Annual Planning, Quarterly
// Reporting, Medical, Staff Training, Intake), so the oversight boards, the Compliance tab
// and the weekly digest are current even for people nobody opened that
// day. (Opening a person's screen also checks their folder right away.)
// Scheduled functions get only 30 seconds, so check-drive-documents.js
// hands the work to drive-documents-background (15 minutes) with a
// short-lived encrypted ticket, the same way Weekly Focus does.
const JOB_KIND = 'drive-documents-job';

async function startJob(siteUrl) {
  const base = (siteUrl || process.env.URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('No site URL to start the Drive check on.');
  const res = await fetch(base + '/.netlify/functions/drive-documents-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: encryptToken({ kind: JOB_KIND }, 10 * 60) })
  });
  if (res.status !== 202 && !res.ok) throw new Error('Could not start the Drive check (HTTP ' + res.status + ').');
  return { started: true };
}

function readJobTicket(ticket) {
  const payload = decryptToken(ticket || '');
  if (payload.kind !== JOB_KIND) throw new Error('Not a Drive check ticket.');
  return payload;
}

// One person's failure (a moved folder, a Drive hiccup) never stops the
// rest; it's counted and logged.
async function runDriveCheck(now) {
  const summary = {};
  ['annualPlanning', 'quarterlyReporting', 'staffTraining', 'medical', 'intake'].forEach(function (k) {
    summary[k] = { checked: 0, added: 0, failed: 0 };
  });
  function tally(area, label, r) {
    if (r.checked) summary[area].checked++;
    summary[area].added += r.added.length;
    r.added.forEach(function (a) { console.log(area + ' ' + label + ': ' + a.label + (a.date ? ' (' + a.date + ')' : '') + ' ← ' + a.file); });
  }
  function failed(area, label, e) {
    summary[area].failed++;
    console.error(area + ' Drive check failed for ' + label, e);
  }

  const records = await queryDatabaseAll(annualPlanning.ANNUAL_PLANNING_DB_ID, { property: 'Active', checkbox: { equals: true } });
  for (const page of records) {
    const location = getPlainText(page.properties['Location']);
    const resident = getPlainText(page.properties['Resident Initials']);
    const record = annualPlanning.recordFromPage(page);
    const label = location + ' ' + resident + ' (' + record.service + ')';
    try {
      tally('annualPlanning', label, await annualPlanning.syncFromDrive(record, now));
    } catch (e) { failed('annualPlanning', label, e); }
    try {
      tally('quarterlyReporting', label, await quarterly.syncFromDrive(location, resident, record.service, record, now));
    } catch (e) { failed('quarterlyReporting', label, e); }
  }

  const requirements = (await staffTraining.loadRequirements({ fresh: true })).requirements;
  for (const member of await staffTraining.allActiveStaff()) {
    if (!member.trainingFolderUrl) continue;
    const label = member.location + ' ' + member.name;
    try {
      tally('staffTraining', label, await staffTraining.syncFromDrive(member, requirements, now));
    } catch (e) { failed('staffTraining', label, e); }
  }

  // Residents are whoever has a medication on file, as everywhere else.
  const marPages = await queryDatabaseAll(process.env.MAR_DB_ID, {
    and: [
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const residents = {};
  marPages.forEach(function (page) {
    const location = getPlainText(page.properties['Location']);
    const resident = getPlainText(page.properties['Resident Initials']);
    if (location && resident) residents[location + '|' + resident] = { location: location, resident: resident };
  });
  for (const key of Object.keys(residents).sort()) {
    const r = residents[key];
    const label = r.location + ' ' + r.resident;
    try {
      const fullName = await medical.residentFullNameFor(r.location, r.resident);
      if (!fullName) continue;
      const appointments = await medical.appointmentsForResident(r.location, r.resident);
      tally('medical', label, await medical.syncFromDrive(r.location, r.resident, fullName, appointments, now));
    } catch (e) { failed('medical', label, e); }
  }

  const checklists = {};
  for (const one of await intake.listIntakes()) {
    try {
      checklists[one.process] = checklists[one.process] || await intake.loadChecklist({ process: one.process });
      tally('intake', one.name, await intake.syncFromDrive(one, checklists[one.process], await intake.itemsForIntake(one.id), now));
    } catch (e) { failed('intake', one.name, e); }
  }
  return summary;
}

module.exports = { startJob, readJobTicket, runDriveCheck };
