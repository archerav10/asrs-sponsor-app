const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const SERIOUS_INCIDENT_DB_ID = process.env.SERIOUS_INCIDENT_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    // Note: unlike the newer report databases, Location here is a plain
    // text field (this database predates the select-based convention
    // used elsewhere in this app), so it's filtered as rich_text.
    const result = await queryDatabase(SERIOUS_INCIDENT_DB_ID, {
      property: 'Location', rich_text: { equals: session.location }
    });

    const incidents = (result.results || []).map(function (page) {
      return {
        id: page.id,
        name: getPlainText(page.properties['Name']),
        dateOfIncident: getPlainText(page.properties['Date of Incident']),
        status: getPlainText(page.properties['Status'])
      };
    }).sort(function (a, b) {
      return (b.dateOfIncident || '').localeCompare(a.dateOfIncident || '');
    });

    return { statusCode: 200, body: JSON.stringify({ location: session.location, incidents: incidents }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
