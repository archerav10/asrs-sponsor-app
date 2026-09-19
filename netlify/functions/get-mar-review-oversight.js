const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { computeMarWindow, findPeriodPage } = require('./lib/mar-review-state');

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

// Read-only status board: for every location the admin is granted, every
// resident's current MAR Review window state. No writes happen here —
// admins still go through the provider app, logged in with that specific
// location's password, to actually save or finalize a review.
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

    // Independent per-location and per-resident lookups, run in parallel
    // rather than the sequential-loop pattern the scheduled SMS checks use
    // elsewhere — those run as background jobs with a much longer budget;
    // this is a synchronous page load, and an admin with several locations
    // times several residents each could otherwise rack up enough serial
    // Notion round-trips to hit Netlify's function timeout.
    const locations = await Promise.all(grantedLocations.map(async function (location) {
      const residentInitialsList = await residentsForLocation(location);

      const residents = await Promise.all(residentInitialsList.map(async function (resident) {
        const periodPage = await findPeriodPage(location, resident);
        const lastFinalizedPeriod = periodPage ? getPlainText(periodPage.properties['Last Finalized Period']) : null;
        const windowState = computeMarWindow(lastFinalizedPeriod);

        return {
          resident: resident,
          targetPeriod: windowState.targetPeriod,
          dueDate: windowState.dueDate.toISOString().slice(0, 10),
          windowOpenDate: windowState.windowOpenDate.toISOString().slice(0, 10),
          isWindowOpen: windowState.isWindowOpen,
          lastFinalizedPeriod: lastFinalizedPeriod || '',
          lastFinalizedDate: periodPage ? getPlainText(periodPage.properties['Last Finalized Date']) : '',
          lastReviewedPeriod: periodPage ? getPlainText(periodPage.properties['Last Reviewed Period']) : '',
          lastReviewedDate: periodPage ? getPlainText(periodPage.properties['Last Reviewed Date']) : ''
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
