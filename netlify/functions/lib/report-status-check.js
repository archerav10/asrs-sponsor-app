const { queryDatabase, getPlainText } = require('./notion');
const { sendSms } = require('./twilio');
const { recipientsForLocation } = require('./notification-recipients');
const { computeDueDate, statusForDueDate } = require('./report-due-date');
const { computeMarTarget } = require('./mar-period');

const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;
const FIRE_DRILL_DB_ID = process.env.FIRE_DRILL_DB_ID;
const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID;
const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID;
const MAR_DB_ID = process.env.MAR_DB_ID;
const MAR_PERIODS_DB_ID = process.env.MAR_PERIODS_DB_ID;

const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Checkpoints are anchored to the actual end of the current calendar
// month: 7 days out, 2 days out, and the 1st of the (next) month.
function isTriggerDay() {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const day7 = new Date(endOfMonth); day7.setDate(day7.getDate() - 7);
  const day2 = new Date(endOfMonth); day2.setDate(day2.getDate() - 2);
  return now.getDate() === 1 || isSameCalendarDay(now, day7) || isSameCalendarDay(now, day2);
}

function formatDueInfo(dueDate) {
  const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
  const dateStr = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (daysUntilDue < 0) {
    return 'OVERDUE since ' + dateStr;
  }
  return 'due in ' + daysUntilDue + ' day' + (daysUntilDue === 1 ? '' : 's') + ' (' + dateStr + ')';
}

async function mostRecentUpdate(dbId, location) {
  const result = await queryDatabase(dbId, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const dates = (result.results || [])
    .map(function (p) { return getPlainText(p.properties['Last Updated Date']); })
    .filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

async function mostRecentDrill(location) {
  const result = await queryDatabase(FIRE_DRILL_DB_ID, {
    property: 'Location', select: { equals: location }
  });
  const dates = (result.results || [])
    .map(function (p) { return getPlainText(p.properties['Drill Date/Time']); })
    .filter(Boolean).map(function (d) { return d.slice(0, 10); }).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

async function marResidentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const set = new Set();
  (result.results || []).forEach(function (p) {
    const initials = getPlainText(p.properties['Resident Initials']);
    if (initials) set.add(initials);
  });
  return Array.from(set);
}

async function marStatusLine(location, resident) {
  const periodResult = await queryDatabase(MAR_PERIODS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const periodPage = (periodResult.results || [])[0];
  const lastFinalizedPeriod = periodPage ? getPlainText(periodPage.properties['Last Finalized Period']) : null;

  const { targetPeriod, dueDate } = computeMarTarget(lastFinalizedPeriod);
  const isFinalized = lastFinalizedPeriod === targetPeriod;
  if (isFinalized) return null;

  const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
  if (daysUntilDue > 7) return null;
  return 'MAR Review (' + resident + '): ' + formatDueInfo(dueDate);
}

// options: { dryRun: boolean, ignoreTriggerDay: boolean }
// dryRun -> compose everything but never call sendSms; messages are
// returned instead so a caller can display "what would have gone out."
// ignoreTriggerDay -> skip the "is today a checkpoint" gate (used by the
// manual test endpoint; the real scheduled function never sets this).
async function runReportStatusCheck(options) {
  options = options || {};
  if (!options.ignoreTriggerDay && !isTriggerDay()) {
    return { triggered: false, reason: 'Not a trigger day.', results: [] };
  }

  const results = [];

  for (const location of LOCATIONS) {
    const lines = [];

    const faLast = await mostRecentUpdate(FIRST_AID_DB_ID, location);
    const faDue = computeDueDate(faLast);
    const faStatus = statusForDueDate(faLast, faDue);
    if (faStatus !== 'green') lines.push('First Aid Supplies: ' + formatDueInfo(faDue));

    const fdLast = await mostRecentDrill(location);
    const fdDue = computeDueDate(fdLast);
    const fdStatus = statusForDueDate(fdLast, fdDue);
    if (fdStatus !== 'green') lines.push('Fire Drill: ' + formatDueInfo(fdDue));

    const esLast = await mostRecentUpdate(EMERGENCY_SUPPLIES_DB_ID, location);
    const esDue = computeDueDate(esLast);
    const esStatus = statusForDueDate(esLast, esDue);
    if (esStatus !== 'green') lines.push('Emergency Supplies: ' + formatDueInfo(esDue));

    const peLast = await mostRecentUpdate(PHYSICAL_ENV_DB_ID, location);
    const peDue = computeDueDate(peLast);
    const peStatus = statusForDueDate(peLast, peDue);
    if (peStatus !== 'green') lines.push('Physical Environment: ' + formatDueInfo(peDue));

    const residents = await marResidentsForLocation(location);
    for (const resident of residents) {
      const line = await marStatusLine(location, resident);
      if (line) lines.push(line);
    }

    if (!lines.length) continue;

    const message = 'ASRS ' + location + ' — reports needing attention:\n' + lines.join('\n');
    const recipients = await recipientsForLocation(location);

    if (options.dryRun) {
      results.push({ location: location, message: message, recipients: recipients.map(function (r) { return r.name + ' (' + r.role + ', ' + r.phone + ')'; }) });
    } else {
      for (const r of recipients) {
        await sendSms(r.phone, message);
      }
      results.push({ location: location, sent: recipients.length, lines: lines.length });
    }
  }

  return { triggered: true, dryRun: !!options.dryRun, results: results };
}

module.exports = { runReportStatusCheck, isTriggerDay };
