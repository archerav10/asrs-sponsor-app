const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID; // 13467800-fa4f-420b-9fac-77204750b36c

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    const result = await queryDatabase(FIRST_AID_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });

    const items = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        tracksExpiration: getPlainText(page.properties['Tracks Expiration']),
        currentExpDate: getPlainText(page.properties['Current Exp Date']),
        notes: getPlainText(page.properties['Notes']),
        lastUpdatedBy: getPlainText(page.properties['Last Updated By']),
        lastUpdatedDate: getPlainText(page.properties['Last Updated Date'])
      };
    }).sort(function (a, b) { return a.itemName.localeCompare(b.itemName); });

    return { statusCode: 200, body: JSON.stringify({ location: session.location, items: items }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
