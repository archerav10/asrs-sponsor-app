const { requireSession } = require('./lib/session');
const { findResidentsForLocation, listVersions } = require('./lib/daily-progress-notes');

// Self-service question-version management: lists every resident who
// already has a template at this location (for the picker) and, when a
// specific resident is requested, that resident's full version history —
// each version's effective/termination dates and its question set, oldest
// first, so the admin can see exactly what changed and when.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const params = event.queryStringParameters || {};
    const location = params.location;
    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const residents = await findResidentsForLocation(location);
    let versions = [];
    if (params.resident) {
      versions = await listVersions(location, params.resident);
    }
    const residentFullName = versions.length && versions[versions.length - 1].questions.length
      ? versions[versions.length - 1].questions[0].residentFullName
      : '';

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        residents: residents,
        resident: params.resident || null,
        residentFullName: residentFullName,
        versions: versions.map(function (v) {
          return {
            effectiveDate: v.effectiveDate,
            terminationDate: v.terminationDate,
            questions: v.questions.map(function (q) {
              return { key: q.key, text: q.text, type: q.type, checklistItems: q.checklistItems, order: q.order };
            })
          };
        })
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
