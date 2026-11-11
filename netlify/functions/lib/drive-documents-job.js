const { encryptToken, decryptToken } = require('./crypto');
const { queryDatabaseAll, getPlainText } = require('./notion');
const annualPlanning = require('./annual-planning');
const staffTraining = require('./staff-training');

// The nightly Drive check: picks up hand-placed documents for every
// resident and staff member, so the oversight boards, the Compliance tab
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
  const summary = { annualPlanning: { checked: 0, added: 0, failed: 0 }, staffTraining: { checked: 0, added: 0, failed: 0 } };

  const records = await queryDatabaseAll(annualPlanning.ANNUAL_PLANNING_DB_ID, { property: 'Active', checkbox: { equals: true } });
  for (const page of records) {
    const label = getPlainText(page.properties['Location']) + ' ' + getPlainText(page.properties['Resident Initials']);
    try {
      const r = await annualPlanning.syncFromDrive(annualPlanning.recordFromPage(page), now);
      if (r.checked) summary.annualPlanning.checked++;
      summary.annualPlanning.added += r.added.length;
      r.added.forEach(function (a) { console.log('Annual Planning ' + label + ': ' + a.label + ' ← ' + a.file); });
    } catch (e) {
      summary.annualPlanning.failed++;
      console.error('Annual Planning Drive check failed for ' + label, e);
    }
  }

  const requirements = (await staffTraining.loadRequirements({ fresh: true })).requirements;
  for (const member of await staffTraining.allActiveStaff()) {
    if (!member.trainingFolderUrl) continue;
    try {
      const r = await staffTraining.syncFromDrive(member, requirements, now);
      if (r.checked) summary.staffTraining.checked++;
      summary.staffTraining.added += r.added.length;
      r.added.forEach(function (a) { console.log('Staff Training ' + member.location + ' ' + member.name + ': ' + a.label + ' (' + a.date + ') ← ' + a.file); });
    } catch (e) {
      summary.staffTraining.failed++;
      console.error('Staff Training Drive check failed for ' + member.location + ' ' + member.name, e);
    }
  }
  return summary;
}

module.exports = { startJob, readJobTicket, runDriveCheck };
