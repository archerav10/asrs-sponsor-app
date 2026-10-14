const { requireSession } = require('./lib/session');
const { findRecordsForResident, computeAnnualPlanningWindow } = require('./lib/annual-planning');
const { worstOf } = require('./lib/report-due-date');
const { annualStatus } = require('./lib/compliance');

// Read-only, sponsor-facing traffic light — no steps, no folder link, no
// finalize action. Sponsors see only whether each of their residents is on
// track (green), in its 6-week window (yellow), or overdue (red) — the
// same rule as My Home's Compliance (lib/compliance.js); the actual
// Annual Planning workflow stays on the admin dashboard.
function statusForWindow(windowState) {
  if (!windowState.hasCycle) return 'green';
  return annualStatus(windowState).status;
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
      const statuses = records.map(function (record) {
        return statusForWindow(computeAnnualPlanningWindow(record));
      });
      return { resident: resident, status: statuses.length ? worstOf(statuses) : 'green' };
    }));

    return { statusCode: 200, body: JSON.stringify({ residents: results }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
