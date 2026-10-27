const { requireSession } = require('./lib/session');
const { loadRequirements, staffListForLocation, staffTrainingStatus } = require('./lib/staff-training');

const TIME_ZONE = 'America/New_York';

// Data for the ASRS-450-01 Training Status Report
// (admin-dashboard/training-report.html): one location's active staff as
// columns, every requirement that applies to at least one of them as
// rows, in checklist order (annual items first, then intake). Each cell
// is { state, date } where state is missing / overdue / soon / current /
// na (doesn't apply to that person's role) and date is the next due date
// for renewing items or the completion date for one-time items.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const location = (event.queryStringParameters || {}).location;
    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const requirements = (await loadRequirements({ fresh: true })).requirements;
    const staffList = await staffListForLocation(location);
    const statuses = await Promise.all(staffList.map(function (member) {
      return staffTrainingStatus(location, member, requirements);
    }));

    const staff = staffList.map(function (member, i) {
      const cells = {};
      statuses[i].steps.forEach(function (s) {
        cells[s.key] = { state: s.state, date: s.expDate || s.completedDate || '' };
      });
      return { name: member.name, role: member.role, roleSet: member.roleSet, cells: cells };
    });

    const rows = requirements.filter(function (req) {
      return staffList.some(function (m) { return req.appliesTo.indexOf(m.role) !== -1; });
    }).map(function (req) {
      return { key: req.key, label: req.label, part: req.part, section: req.section, renewYears: req.renewYears };
    });

    const runDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    return { statusCode: 200, body: JSON.stringify({ location: location, runDate: runDate, rows: rows, staff: staff }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
