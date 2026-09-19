const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { loadCurrentRecord } = require('./lib/annual-planning');

const MAR_DB_ID = process.env.MAR_DB_ID;

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

// Read-only status board, same shape as get-mar-review-oversight.js: for
// every resident at every location the admin is granted, where their
// Annual Planning cycle stands right now.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const grantedLocations = session.grantedLocations || [];

    const locations = await Promise.all(grantedLocations.map(async function (location) {
      const residentInitialsList = await residentsForLocation(location);

      const residents = await Promise.all(residentInitialsList.map(async function (resident) {
        const { record, windowState } = await loadCurrentRecord(location, resident);

        return {
          resident: resident,
          hasCycle: windowState.hasCycle,
          targetEffectiveDate: windowState.targetEffectiveDate,
          dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
          windowOpenDate: windowState.windowOpenDate ? windowState.windowOpenDate.toISOString().slice(0, 10) : null,
          isWindowOpen: windowState.isWindowOpen,
          isFinalizedForTarget: windowState.isFinalizedForTarget,
          finalizedDate: record ? record.finalizedDate : ''
        };
      }));

      return { location: location, residents: residents };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
