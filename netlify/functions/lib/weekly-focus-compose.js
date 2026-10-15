const wf = require('./weekly-focus');

// Shared checks for the Compose screen's endpoints.

const MAX_FIELD = 2000;

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

// This week plus the next three — far enough ahead to plan, and the
// Tuesday dates the send job actually looks for.
function weekOptions(now) {
  const thisWeek = wf.weekOfFor(now);
  return [0, 1, 2, 3].map(function (i) {
    const weekOf = wf.addDaysISO(thisWeek, 7 * i);
    return { weekOf: weekOf, label: (i === 0 ? 'This week' : i === 1 ? 'Next week' : 'Week') + ' of ' + wf.formatWeekLabel(weekOf) };
  });
}

// Active sponsors at the admin's granted locations, by Notion page ID.
async function sponsorsFor(session) {
  const granted = new Set(session.grantedLocations || []);
  return (await wf.activeSponsors())
    .filter(function (s) { return granted.has(s.location); })
    .sort(function (a, b) { return a.location.localeCompare(b.location) || a.name.localeCompare(b.name); });
}

function requireAdmin(session) {
  if (session.accountType !== 'admin-dashboard') throw httpError(403, 'Not authorized for the admin dashboard.');
}

function cleanText(v) {
  return String(v == null ? '' : v).trim().slice(0, MAX_FIELD);
}

// Normalizes the posted message fields.
function readFields(body) {
  return {
    quote: cleanText(body.quote),
    quoteAuthor: cleanText(body.quoteAuthor),
    focusTitle: cleanText(body.focusTitle),
    focusMessage: cleanText(body.focusMessage),
    checklist: (Array.isArray(body.checklist) ? body.checklist : []).map(cleanText).filter(Boolean).slice(0, 3)
  };
}

module.exports = { httpError, weekOptions, sponsorsFor, requireAdmin, readFields };
