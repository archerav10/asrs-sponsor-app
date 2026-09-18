const { queryDatabase, updatePage, createPage, getPlainText } = require('./notion');
const { sendSms } = require('./twilio');
const { recipientsForLocation } = require('./notification-recipients');
const { computeMarWindow, findPeriodPage, MAR_PERIODS_DB_ID } = require('./mar-review-state');

const MAR_DB_ID = process.env.MAR_DB_ID;
const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function periodLabel(periodStr) {
  const parts = periodStr.split('-');
  return MONTH_NAMES[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

function formatDateShort(date) {
  return MONTH_NAMES[date.getMonth()].slice(0, 3) + ' ' + date.getDate() + ', ' + date.getFullYear();
}

async function residentsForLocation(location) {
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

function buildMessage(location, resident, stage, windowState) {
  const monthLabel = periodLabel(windowState.targetPeriod);
  if (stage.name === 'overdue') {
    return 'ASRS ' + location + ' — MAR REVIEW MISSED: ' + resident + '\n' +
      monthLabel + ' medications were not finalized by the deadline (' + formatDateShort(windowState.dueDate) + ').';
  }
  return 'ASRS ' + location + ' — MAR Review Reminder: ' + resident + '\n' +
    monthLabel + ' medications review is due in ' + stage.daysUntilDue + ' day' + (stage.daysUntilDue === 1 ? '' : 's') +
    ' (' + formatDateShort(windowState.dueDate) + ') and has not been finalized.';
}

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// The three reminder checkpoints — anchored to exact calendar dates
// (mirrors lib/report-status-check.js's isTriggerDay) rather than a live
// "days until due" count, so a cron run a few hours off midnight can't
// push the comparison to the wrong side of a day boundary. The 7-day
// checkpoint lands on windowOpenDate itself (dueDate minus 7, by
// definition); the 2-day checkpoint is dueDate minus 2; "overdue" is
// simply the 1st of the new month. Each stage's dedupe flag lives on the
// period tracker so it resets naturally once the target period advances.
function stageForToday(now, windowState) {
  if (isSameCalendarDay(now, windowState.windowOpenDate)) {
    return { name: '7-day', flagProperty: 'Reminder 7 Day Sent Period', daysUntilDue: 7 };
  }
  const day2 = new Date(windowState.dueDate);
  day2.setDate(day2.getDate() - 2);
  if (isSameCalendarDay(now, day2)) {
    return { name: '2-day', flagProperty: 'Reminder 2 Day Sent Period', daysUntilDue: 2 };
  }
  // "1st of the new month" alone isn't enough — on an on-schedule
  // location, the 1st is also the day the target rolls forward to a
  // period that's a full month from being due (not overdue at all). Only
  // fire once the due date has actually passed.
  if (now.getDate() === 1 && now > windowState.dueDate) {
    return { name: 'overdue', flagProperty: 'Reminder Overdue Sent Period' };
  }
  return null;
}

// options: { dryRun: boolean, asOf: "YYYY-MM-DD" }
async function runMarReminderCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const results = [];

  for (const location of LOCATIONS) {
    const residents = await residentsForLocation(location);

    for (const resident of residents) {
      const periodPage = await findPeriodPage(location, resident);
      const lastFinalizedPeriod = periodPage ? getPlainText(periodPage.properties['Last Finalized Period']) : null;
      const windowState = computeMarWindow(lastFinalizedPeriod, now);

      if (windowState.targetPeriod === lastFinalizedPeriod) continue; // already finalized — nothing to remind about

      const stage = stageForToday(now, windowState);
      if (!stage) continue;

      const alreadySent = periodPage ? getPlainText(periodPage.properties[stage.flagProperty]) : '';
      if (alreadySent === windowState.targetPeriod) continue; // dedupe — already sent for this period

      const message = buildMessage(location, resident, stage, windowState);
      const recipients = (await recipientsForLocation(location)).filter(function (r) { return r.role === 'admin'; });

      if (options.dryRun) {
        results.push({
          location: location,
          resident: resident,
          stage: stage.name,
          message: message,
          recipients: recipients.map(function (r) { return r.name + ' (' + r.role + ', ' + r.phone + ')'; })
        });
        continue;
      }

      for (const r of recipients) {
        await sendSms(r.phone, message);
      }

      const flagProps = {};
      flagProps[stage.flagProperty] = { rich_text: [{ text: { content: windowState.targetPeriod } }] };
      if (periodPage) {
        await updatePage(periodPage.id, flagProps);
      } else {
        await createPage(MAR_PERIODS_DB_ID, Object.assign({
          'Period Title': { title: [{ text: { content: location + ' - ' + resident } }] },
          'Location': { select: { name: location } },
          'Resident Initials': { rich_text: [{ text: { content: resident } }] },
          'Active': { checkbox: true }
        }, flagProps));
      }

      results.push({ location: location, resident: resident, stage: stage.name, sent: recipients.length });
    }
  }

  return { dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, results: results };
}

module.exports = { runMarReminderCheck };
