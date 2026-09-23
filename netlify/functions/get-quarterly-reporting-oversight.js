const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { DEFAULT_SERVICE, findRecordsForResident } = require('./lib/annual-planning');
const { findRecord, computeQuarterlyReportingForRecord, activeQuarter } = require('./lib/quarterly-reporting');

const MAR_DB_ID = process.env.MAR_DB_ID;

// Same resident enumeration as get-annual-planning-oversight.js — this
// process only exists at all for a resident/service that already has an
// Annual Planning record, so the set of services to show is identical.
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

function quarterSummary(q) {
  return { index: q.index, start: q.start, end: q.end, dueDate: q.dueDate, isOpen: q.isOpen, missingCount: q.missingCount };
}

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
        const planningRecords = await findRecordsForResident(location, resident);
        const byService = {};
        planningRecords.forEach(function (r) { byService[r.service] = r; });

        const servicesToShow = [DEFAULT_SERVICE].concat(
          Object.keys(byService).filter(function (s) { return s !== DEFAULT_SERVICE; }).sort()
        ).filter(function (s) { return byService[s]; });

        const services = await Promise.all(servicesToShow.map(async function (service) {
          const record = byService[service];
          const state = await computeQuarterlyReportingForRecord(location, resident, service, record);
          const active = state.hasCycle ? activeQuarter(state.quarters) : null;
          return {
            service: service,
            hasCycle: state.hasCycle,
            quarters: state.quarters.map(quarterSummary),
            activeQuarterIndex: active ? active.index : null,
            activeQuarterDueDate: active ? active.dueDate : null
          };
        }));

        return { resident: resident, services: services };
      }));

      return { location: location, residents: residents.filter(function (r) { return r.services.length; }) };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
