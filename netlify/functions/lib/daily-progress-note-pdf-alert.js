const { findUnrenderedSignedCovers } = require('./daily-progress-notes');
const { sendSms } = require('./twilio');
const { routineRecipientsForLocation } = require('./notification-recipients');

// How many nights a signed note's PDF can fail to upload before it's
// worth texting an admin about. generate-daily-progress-note-pdfs.js
// already retries every night on its own, so this exists purely to
// catch a PERSISTENT failure (the Zap broke, ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL
// got unset, etc.) rather than firing on a note's very first attempt,
// which hasn't even run yet the night it's signed.
const STALE_DAYS = 2;

function todayISO(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

function daysSince(dateStr, today) {
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(today + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// options: { dryRun: boolean, asOf: "YYYY-MM-DD" }
// Texts admins (never sponsors — filtered to role === 'admin', same as
// window-opened-alert-check.js) when a signed Daily Progress Note has
// gone STALE_DAYS+ without its PDF successfully uploading — grouped one
// message per location. Fires every day the failure persists rather
// than just once (same "keep nagging until it's fixed" convention
// mar-alert-check.js uses for missing/expired medications) — there's no
// separate dedup state to track and reset once it's resolved.
async function runDailyProgressNotePdfFailureCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const today = todayISO(now);

  const covers = await findUnrenderedSignedCovers();
  const stale = covers.filter(function (c) {
    const signedDate = (c.signedAt || '').slice(0, 10);
    return !!signedDate && daysSince(signedDate, today) >= STALE_DAYS;
  });

  if (!stale.length) {
    return { dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, staleCount: 0, results: [] };
  }

  const byLocation = {};
  stale.forEach(function (c) {
    if (!byLocation[c.location]) byLocation[c.location] = [];
    byLocation[c.location].push(c.residentInitials + ' — ' + c.date);
  });

  const results = [];
  for (const location of Object.keys(byLocation)) {
    const lines = byLocation[location];
    const recipients = (await routineRecipientsForLocation(location)).filter(function (r) { return r.role === 'admin'; });
    if (!recipients.length) continue;

    const message = 'ASRS ' + location + ' — Daily Progress Note PDF upload has FAILED ' + STALE_DAYS + '+ nights in a row for:\n' +
      lines.join('\n') + '\nCheck the Zapier connection.';

    if (options.dryRun) {
      results.push({ location: location, message: message, recipients: recipients.map(function (r) { return r.name + ' (' + r.phone + ')'; }) });
    } else {
      for (const r of recipients) {
        await sendSms(r.phone, message);
      }
      results.push({ location: location, sent: recipients.length, lines: lines.length });
    }
  }

  return { dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, staleCount: stale.length, results: results };
}

module.exports = { runDailyProgressNotePdfFailureCheck, STALE_DAYS };
