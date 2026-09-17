const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID; // 2512e571-d0fb-4937-8594-646da323a734

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    const result = await queryDatabase(EMERGENCY_SUPPLIES_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });

    const allRows = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        tracksExpiration: getPlainText(page.properties['Tracks Expiration']),
        present: getPlainText(page.properties['Present']),
        currentExpDate: getPlainText(page.properties['Current Exp Date']),
        quantity: page.properties['Quantity'] && page.properties['Quantity'].number !== null
          ? page.properties['Quantity'].number
          : null,
        notes: getPlainText(page.properties['Notes']),
        lastUpdatedBy: getPlainText(page.properties['Last Updated By']),
        lastUpdatedDate: getPlainText(page.properties['Last Updated Date'])
      };
    });

    const generalNotesRow = allRows.find(function (r) { return r.itemName === 'General Notes'; });
    const items = allRows
      .filter(function (r) { return r.itemName !== 'General Notes'; })
      .sort(function (a, b) { return a.itemName.localeCompare(b.itemName); });

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        items: items,
        generalNotes: generalNotesRow ? { id: generalNotesRow.id, notes: generalNotesRow.notes } : null
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
