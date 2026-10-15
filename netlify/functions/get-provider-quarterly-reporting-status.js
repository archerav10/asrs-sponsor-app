const { requireSession } = require('./lib/session');
const { findRecordsForResident } = require('./lib/annual-planning');
const { computeQuarterlyReportingForRecord } = require('./lib/quarterly-reporting');
const { worstOf } = require('./lib/report-due-date');
const { quarterlyStatusForState } = require('./lib/compliance');

// Read-only, sponsor-facing traffic light — mirrors the current AND prior
// cycle logic in get-quarterly-reporting-oversight.js, but collapses it
// down to one dot per resident since sponsors can't act on this here.
// A quarter's reports are due 15 days after it ends: yellow in the last
// 7 of those days, red after (the same rule as My Home's Compliance).

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
        // Same rule as My Home's Compliance (lib/compliance.js): each
        // quarter is due 15 days after it ends, yellow in the last 7.
        return worstOf(quarterlyStatusForState(state).map(function (q) { return q.status; }));
      }));

      return { resident: resident, status: statuses.length ? worstOf(statuses) : 'green' };
    }));

    return { statusCode: 200, body: JSON.stringify({ residents: results }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
