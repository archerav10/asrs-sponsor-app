const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const MAR_DB_ID = process.env.MAR_DB_ID; // 7dbf6757-dd9b-4c7c-ad78-168c745ed555

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    if (!residents.length) {
      return { statusCode: 200, body: JSON.stringify({ location: session.location, residents: [], medications: [], allergyInfo: null, generalNotes: null }) };
    }

    const residentFilter = residents.length === 1
      ? { property: 'Resident Initials', rich_text: { equals: residents[0] } }
      : { or: residents.map(function (r) { return { property: 'Resident Initials', rich_text: { equals: r } }; }) };

    const result = await queryDatabase(MAR_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } },
        residentFilter
      ]
    });

    const allRows = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        residentInitials: getPlainText(page.properties['Resident Initials']),
        dosage: getPlainText(page.properties['Dosage']),
        frequency: getPlainText(page.properties['Frequency']),
        purpose: getPlainText(page.properties['Purpose']),
        medicationType: getPlainText(page.properties['Medication Type']), // Regular | PRN | Info
        currentExpDate: getPlainText(page.properties['Current Exp Date']),
        quantity: getPlainText(page.properties['Quantity']),
        missing: getPlainText(page.properties['Missing']),
        notes: getPlainText(page.properties['Notes']),
        lastUpdatedBy: getPlainText(page.properties['Last Updated By']),
        lastUpdatedDate: getPlainText(page.properties['Last Updated Date'])
      };
    });

    // Pull the special Info rows (Allergy Info banner, General Notes) out of
    // the medication list — same pattern as "General Notes" in other reports.
    const allergyRow = allRows.find(function (r) { return r.itemName === 'Allergy Info'; });
    const generalNotesRow = allRows.find(function (r) { return r.itemName === 'General Notes'; });
    const medications = allRows
      .filter(function (r) { return r.medicationType !== 'Info'; })
      .sort(function (a, b) {
        // Group by resident, then alphabetically by drug name within each.
        if (a.residentInitials !== b.residentInitials) return a.residentInitials.localeCompare(b.residentInitials);
        return a.itemName.localeCompare(b.itemName);
      });

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        residents: residents,
        medications: medications,
        allergyInfo: allergyRow ? { id: allergyRow.id, notes: allergyRow.notes } : null,
        generalNotes: generalNotesRow ? { id: generalNotesRow.id, notes: generalNotesRow.notes } : null
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
