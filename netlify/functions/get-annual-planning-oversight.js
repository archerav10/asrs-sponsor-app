const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { SERVICES, DEFAULT_SERVICE, findRecordsForResident, computeAnnualPlanningWindow } = require('./lib/annual-planning');

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

function windowSummary(record, windowState) {
  return {
    hasCycle: windowState.hasCycle,
    targetEffectiveDate: windowState.targetEffectiveDate,
    dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
    windowOpenDate: windowState.windowOpenDate ? windowState.windowOpenDate.toISOString().slice(0, 10) : null,
    isWindowOpen: windowState.isWindowOpen,
    isFinalizedForTarget: windowState.isFinalizedForTarget,
    finalizedDate: record ? record.finalizedDate : ''
  };
}

// Read-only status board, same shape as get-mar-review-oversight.js: for
// every resident at every location the admin is granted, where their
// Annual Planning cycle stands right now. A resident always gets a
// DEFAULT_SERVICE (Congregate Residential) entry, since that's how
// residents are scoped everywhere else in this app; any OTHER service
// only shows up once a record for it already exists, alongside the list
// of services that don't yet — so the client can offer "add a service"
// without guessing. Deliberately doesn't roll a stale finalized record
// forward here (that only happens on the detail screen, same as MAR's
// oversight board never triggers its own wipe) — this is read-only.
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
        const records = await findRecordsForResident(location, resident);
        const byService = {};
        records.forEach(function (r) { byService[r.service] = r; });

        const servicesToShow = [DEFAULT_SERVICE].concat(
          Object.keys(byService).filter(function (s) { return s !== DEFAULT_SERVICE; }).sort()
        );

        const services = servicesToShow.map(function (service) {
          const record = byService[service] || null;
          const windowState = computeAnnualPlanningWindow(record);
          return Object.assign({ service: service }, windowSummary(record, windowState));
        });

        const availableToAdd = SERVICES.filter(function (s) { return servicesToShow.indexOf(s) === -1; });

        return { resident: resident, services: services, availableToAdd: availableToAdd };
      }));

      return { location: location, residents: residents };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations, defaultService: DEFAULT_SERVICE }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
