const { queryDatabase, getPlainText } = require('./notion');
const { sendSms } = require('./twilio');
const { recipientsForLocation } = require('./notification-recipients');
const { DEFAULT_SERVICE, findRecordsForResident, computeAnnualPlanningWindow } = require('./annual-planning');
const { computeQuarters } = require('./quarterly-reporting');

const MAR_DB_ID = process.env.MAR_DB_ID;
const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

function todayISO(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

// Same MAR-based resident enumeration duplicated in every scheduled
// check that needs one (report-status-check.js, mar-alert-check.js,
// admin-digest-check.js) — kept self-contained per file, same as those.
async function residentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const set = new Set();
  (result.results || []).forEach(function (page) {
    const initials = getPlainText(page.properties['Resident Initials']);
    if (initials) set.add(initials);
  });
  return Array.from(set).sort();
}

// Texts admins (never sponsors — filtered to role === 'admin' below) the
// instant an Annual Planning or Quarterly Reporting window opens, rather
// than waiting for the Friday digest. Both events land on one specific,
// deterministic calendar day (computeWindowOpenDate / a quarter's
// dueDate), so a daily run just checks "does that day equal today" — no
// separate "already sent" bookkeeping needed, since each date can only
// ever equal today once.
//
// options: { dryRun: boolean, asOf: "YYYY-MM-DD" }
async function runWindowOpenedAlertCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const today = todayISO(now);
  const results = [];

  for (const location of LOCATIONS) {
    const residents = await residentsForLocation(location);

    const perResident = await Promise.all(residents.map(async function (resident) {
      const records = await findRecordsForResident(location, resident);
      const byService = {};
      records.forEach(function (r) { byService[r.service] = r; });

      const perService = Object.keys(byService).map(function (service) {
        const record = byService[service];
        const label = resident + (service === DEFAULT_SERVICE ? '' : ' (' + service + ')');
        const serviceLines = [];

        const apWindow = computeAnnualPlanningWindow(record, now);
        if (apWindow.hasCycle && !apWindow.isFinalizedForTarget) {
          const openISO = apWindow.windowOpenDate.toISOString().slice(0, 10);
          if (openISO === today) {
            const dueISO = apWindow.dueDate.toISOString().slice(0, 10);
            serviceLines.push('Annual Planning OPEN: ' + label + ' — due ' + dueISO);
          }
        }

        // Pure date math, no Notion query — a quarter's open/due date is
        // fully determined by record.effectiveDate, so there's no need to
        // also fetch its 4 report items just to compare a date string.
        if (record && record.effectiveDate) {
          computeQuarters(record.effectiveDate).forEach(function (q) {
            if (q.dueDate === today) {
              serviceLines.push('Quarterly Reporting OPEN: ' + label + ' — Q' + q.index + ' (' + q.start + ' to ' + q.end + ')');
            }
          });
        }

        return serviceLines;
      });

      return [].concat.apply([], perService);
    }));

    const lines = [].concat.apply([], perResident);
    if (!lines.length) continue;

    const recipients = (await recipientsForLocation(location)).filter(function (r) { return r.role === 'admin'; });
    if (!recipients.length) continue;

    const message = 'ASRS ' + location + ' — PROCESS OPENED:\n' + lines.join('\n');

    if (options.dryRun) {
      results.push({ location: location, message: message, recipients: recipients.map(function (r) { return r.name + ' (' + r.phone + ')'; }) });
    } else {
      for (const r of recipients) {
        await sendSms(r.phone, message);
      }
      results.push({ location: location, sent: recipients.length, lines: lines.length });
    }
  }

  return { dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, results: results };
}

module.exports = { runWindowOpenedAlertCheck };
