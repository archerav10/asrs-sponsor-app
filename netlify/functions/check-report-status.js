const { queryDatabase, getPlainText } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { recipientsForLocation } = require('./lib/notification-recipients');
const { computeDueDate, statusForDueDate } = require('./lib/report-due-date');
const { computeMarTarget } = require('./lib/mar-period');

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

  const { target, dueDate } = computeMarTarget(lastFinalizedPeriod);
  const targetStr = target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0');
  const isFinalized = lastFinalizedPeriod === targetStr;
  if (isFinalized) return null;

  const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
  if (daysUntilDue > 7) return null;
  return 'MAR Review (' + resident + '): ' + (daysUntilDue < 0 ? 'OVERDUE' : 'due soon');
}

exports.handler = async function (event) {
  const forceRequested = event.queryStringParameters && event.queryStringParameters.force === 'true';
  const secretOk = forceRequested && event.queryStringParameters.secret === process.env.NOTIFICATION_TEST_SECRET && process.env.NOTIFICATION_TEST_SECRET;

  if (!isTriggerDay() && !secretOk) {
    return { statusCode: 200, body: 'Not a trigger day — no action taken. Add ?force=true&secret=... to test.' };
  }

  const results = [];

  for (const location of LOCATIONS) {
    const lines = [];

    const faLast = await mostRecentUpdate(FIRST_AID_DB_ID, location);
    const faStatus = statusForDueDate(faLast, computeDueDate(faLast));
    if (faStatus !== 'green') lines.push('First Aid Supplies: ' + (faStatus === 'red' ? 'OVERDUE' : 'due soon'));

    const fdLast = await mostRecentDrill(location);
    const fdStatus = statusForDueDate(fdLast, computeDueDate(fdLast));
    if (fdStatus !== 'green') lines.push('Fire Drill: ' + (fdStatus === 'red' ? 'OVERDUE' : 'due soon'));

    const esLast = await mostRecentUpdate(EMERGENCY_SUPPLIES_DB_ID, location);
    const esStatus = statusForDueDate(esLast, computeDueDate(esLast));
    if (esStatus !== 'green') lines.push('Emergency Supplies: ' + (esStatus === 'red' ? 'OVERDUE' : 'due soon'));

    const peLast = await mostRecentUpdate(PHYSICAL_ENV_DB_ID, location);
    const peStatus = statusForDueDate(peLast, computeDueDate(peLast));
    if (peStatus !== 'green') lines.push('Physical Environment: ' + (peStatus === 'red' ? 'OVERDUE' : 'due soon'));

    const residents = await marResidentsForLocation(location);
    for (const resident of residents) {
      const line = await marStatusLine(location, resident);
      if (line) lines.push(line);
    }

    if (!lines.length) continue;

    const message = 'ASRS ' + location + ' — reports needing attention:\n' + lines.join('\n');
    const recipients = await recipientsForLocation(location);
    for (const r of recipients) {
      await sendSms(r.phone, message);
    }
    results.push({ location: location, sent: recipients.length, lines: lines.length });
  }

  return { statusCode: 200, body: JSON.stringify({ triggered: true, results: results }) };
};
