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

    const allRows = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        tracksExpiration: getPlainText(page.properties['Tracks Expiration']),
        present: getPlainText(page.properties['Present']),
        currentExpDate: getPlainText(page.properties['Current Exp Date']),
        notes: getPlainText(page.properties['Notes']),
        lastUpdatedBy: getPlainText(page.properties['Last Updated By']),
        lastUpdatedDate: getPlainText(page.properties['Last Updated Date'])
      };
    });

    // "General Notes" is a special row (one per location) that holds the
    // end-of-report free-text notes, not a checklist item — pull it out
    // and return it separately.
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
