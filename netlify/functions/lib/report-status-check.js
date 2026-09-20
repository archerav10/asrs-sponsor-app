const { queryDatabase, getPlainText } = require('./notion');
const { sendSms } = require('./twilio');
const { recipientsForLocation } = require('./notification-recipients');
const { computeDueDate, statusForDueDate, computeSupplyDueDate, statusForSupplyDueDate } = require('./report-due-date');
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
function isTriggerDay(now) {
  now = now || new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const day7 = new Date(endOfMonth); day7.setDate(day7.getDate() - 7);
  const day2 = new Date(endOfMonth); day2.setDate(day2.getDate() - 2);
  return now.getDate() === 1 || isSameCalendarDay(now, day7) || isSameCalendarDay(now, day2);
}

function formatDueInfo(dueDate, now) {
  now = now || new Date();
  const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
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

// First Aid Supplies and Emergency Supplies need item-level expiration
// data, not just the most recent "Last Updated Date" — see
// computeSupplyDueDate in report-due-date.js.
async function supplyInfoForLocation(dbId, location) {
  const result = await queryDatabase(dbId, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const rows = result.results || [];
  const dates = rows
    .map(function (p) { return getPlainText(p.properties['Last Updated Date']); })
    .filter(Boolean).sort();
  const items = rows.map(function (p) {
    return {
      tracksExpiration: getPlainText(p.properties['Tracks Expiration']),
      currentExpDate: getPlainText(p.properties['Current Exp Date'])
    };
  });
  return { lastReviewed: dates.length ? dates[dates.length - 1] : null, items: items };
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

async function marStatusLine(location, resident, now) {
  const periodResult = await queryDatabase(MAR_PERIODS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const periodPage = (periodResult.results || [])[0];
  const lastFinalizedPeriod = periodPage ? getPlainText(periodPage.properties['Last Finalized Period']) : null;

  const { targetPeriod, dueDate } = computeMarTarget(lastFinalizedPeriod, now);
  const isFinalized = lastFinalizedPeriod === targetPeriod;
  if (isFinalized) return null;

  const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
  if (daysUntilDue > 7) return null;
  return 'MAR Review (' + resident + '): ' + formatDueInfo(dueDate, now);
}

// options: { dryRun: boolean, ignoreTriggerDay: boolean, asOf: "YYYY-MM-DD" }
// dryRun -> compose everything but never call sendSms; messages are
// returned instead so a caller can display "what would have gone out."
// ignoreTriggerDay -> skip the "is today a checkpoint" gate for the
// month-anchored reports below (used by the manual test endpoint; the
// real scheduled function never sets this).
// asOf -> simulate running this on a different calendar day, so you can
// preview a "due soon" or "overdue" state without waiting for it or
// needing data that's actually impossible to construct for today (due
// dates always land on a month-end, so "due soon" only exists in the
// ~8 days around an actual month boundary).
//
// First Aid Supplies and Emergency Supplies are NOT gated by
// isTriggerDay — their due dates now come from item expiration dates
// (see computeSupplyDueDate), which can fall on any day of the month,
// not just a month boundary, so they're evaluated on every run of this
// function (the underlying cron already runs daily). That does mean an
// admin can get a same-day SMS again tomorrow if a supply is still
// sitting in the yellow/red window — there's no once-per-stage dedup
// here the way MAR's reminders have.
async function runReportStatusCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const monthCheckpoint = options.ignoreTriggerDay || isTriggerDay(now);

  const results = [];

  for (const location of LOCATIONS) {
    const lines = [];

    const faInfo = await supplyInfoForLocation(FIRST_AID_DB_ID, location);
    const faDue = computeSupplyDueDate(faInfo.items);
    const faStatus = statusForSupplyDueDate(faInfo.lastReviewed, faDue, now);
    if (faStatus !== 'green') {
      lines.push('First Aid Supplies: ' + (faDue ? formatDueInfo(faDue, now) : 'never reviewed — needs an initial check'));
    }

    const esInfo = await supplyInfoForLocation(EMERGENCY_SUPPLIES_DB_ID, location);
    const esDue = computeSupplyDueDate(esInfo.items);
    const esStatus = statusForSupplyDueDate(esInfo.lastReviewed, esDue, now);
    if (esStatus !== 'green') {
      lines.push('Emergency Supplies: ' + (esDue ? formatDueInfo(esDue, now) : 'never reviewed — needs an initial check'));
    }

    if (monthCheckpoint) {
      const fdLast = await mostRecentDrill(location);
      const fdDue = computeDueDate(fdLast, now);
      const fdStatus = statusForDueDate(fdLast, fdDue, now);
      if (fdStatus !== 'green') lines.push('Fire Drill: ' + formatDueInfo(fdDue, now));

      const peLast = await mostRecentUpdate(PHYSICAL_ENV_DB_ID, location);
      const peDue = computeDueDate(peLast, now);
      const peStatus = statusForDueDate(peLast, peDue, now);
      if (peStatus !== 'green') lines.push('Physical Environment: ' + formatDueInfo(peDue, now));

      const residents = await marResidentsForLocation(location);
      for (const resident of residents) {
        const line = await marStatusLine(location, resident, now);
        if (line) lines.push(line);
      }
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

  return { triggered: true, monthCheckpoint: monthCheckpoint, dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, results: results };
}

module.exports = { runReportStatusCheck, isTriggerDay };
