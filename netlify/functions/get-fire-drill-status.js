const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const FIRE_DRILL_DB_ID = process.env.FIRE_DRILL_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    const result = await queryDatabase(FIRE_DRILL_DB_ID, {
      property: 'Location',
      select: { equals: session.location }
    });

    const dates = (result.results || [])
      .map(function (page) { return getPlainText(page.properties['Drill Date/Time']); })
      .filter(Boolean)
      .map(function (d) { return d.slice(0, 10); }) // date-only for comparison/display
      .sort();

    const lastReviewed = dates.length ? dates[dates.length - 1] : null;

    return { statusCode: 200, body: JSON.stringify({ location: session.location, lastReviewed: lastReviewed }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
