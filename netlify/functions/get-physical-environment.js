const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID; // f65e9956-bfe5-4e81-8612-cf533d345796

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    const result = await queryDatabase(PHYSICAL_ENV_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });

    const allRows = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        itemType: getPlainText(page.properties['Item Type']), // "Checklist" | "Expiration Date" | "Numeric Reading"
        present: getPlainText(page.properties['Present']),
        currentExpDate: getPlainText(page.properties['Current Exp Date']),
        numericValue: page.properties['Numeric Value'] && page.properties['Numeric Value'].number !== null
          ? page.properties['Numeric Value'].number
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
