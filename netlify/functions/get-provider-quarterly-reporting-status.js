const { requireSession } = require('./lib/session');
const { findRecordsForResident } = require('./lib/annual-planning');
const { computeQuarterlyReportingForRecord } = require('./lib/quarterly-reporting');
const { worstOf } = require('./lib/report-due-date');

// Read-only, sponsor-facing traffic light — mirrors the current AND prior
// cycle logic in get-quarterly-reporting-oversight.js, but collapses it
// down to one dot per resident since sponsors can't act on this here.
// No lead time on any quarter (see lib/quarterly-reporting.js), so "open
// and incomplete" already means due right now: one such quarter is
// yellow, more than one (they've fallen behind across a quarter
// boundary) is red.
function statusForQuarters(quarters) {
  const openIncomplete = quarters.filter(function (q) { return q.isOpen && q.missingCount > 0; });
  if (!openIncomplete.length) return 'green';
  return openIncomplete.length > 1 ? 'red' : 'yellow';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const results = await Promise.all(residents.map(async function (resident) {
      const records = await findRecordsForResident(session.location, resident);

      const statuses = await Promise.all(records.map(async function (record) {
        const state = await computeQuarterlyReportingForRecord(session.location, resident, record.service, record);
        if (!state.hasCycle) return 'green';
        const allQuarters = state.quarters.concat(state.priorCycle ? state.priorCycle.quarters : []);
        return statusForQuarters(allQuarters);
      }));

      return { resident: resident, status: statuses.length ? worstOf(statuses) : 'green' };
    }));

    return { statusCode: 200, body: JSON.stringify({ residents: results }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
