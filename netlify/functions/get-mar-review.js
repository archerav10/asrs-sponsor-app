const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const MAR_DB_ID = process.env.MAR_DB_ID;
const MAR_PERIODS_DB_ID = process.env.MAR_PERIODS_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const allResidents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    // A specific resident can be requested (for the per-resident Home
    // buttons/screen) — but it must actually belong to this session.
    const requestedResident = event.queryStringParameters && event.queryStringParameters.resident;
    const residents = requestedResident && allResidents.indexOf(requestedResident) !== -1
      ? [requestedResident]
      : allResidents;

    if (!residents.length) {
      return { statusCode: 200, body: JSON.stringify({ location: session.location, residents: [], medications: [], allergyInfo: null, generalNotes: null, deliveryDate: null, period: null }) };
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
        dateDelivered: getPlainText(page.properties['Date Delivered']),
        quantity: getPlainText(page.properties['Quantity']),
        missing: getPlainText(page.properties['Missing']),
        notes: getPlainText(page.properties['Notes']),
        lastUpdatedBy: getPlainText(page.properties['Last Updated By']),
        lastUpdatedDate: getPlainText(page.properties['Last Updated Date'])
      };
    });

    const allergyRow = allRows.find(function (r) { return r.itemName === 'Allergy Info'; });
    const generalNotesRow = allRows.find(function (r) { return r.itemName === 'General Notes'; });
    const deliveryDateRow = allRows.find(function (r) { return r.itemName === 'Medication Delivery Date'; });
    const medications = allRows
      .filter(function (r) { return r.medicationType !== 'Info'; })
      .sort(function (a, b) {
        if (a.residentInitials !== b.residentInitials) return a.residentInitials.localeCompare(b.residentInitials);
        return a.itemName.localeCompare(b.itemName);
      });

    // Period tracker: one row per Location x Resident set (using the
    // first resident on the account — matches how the rest of this
    // report is scoped for now).
    let period = null;
    const periodResult = await queryDatabase(MAR_PERIODS_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Resident Initials', rich_text: { equals: residents[0] } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });
    const periodPage = (periodResult.results || [])[0];
    if (periodPage) {
      period = {
        lastFinalizedPeriod: getPlainText(periodPage.properties['Last Finalized Period']),
        lastFinalizedDate: getPlainText(periodPage.properties['Last Finalized Date']),
        lastFinalizedBy: getPlainText(periodPage.properties['Last Finalized By'])
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        residents: residents,
        medications: medications,
        allergyInfo: allergyRow ? { id: allergyRow.id, notes: allergyRow.notes } : null,
        generalNotes: generalNotesRow ? { id: generalNotesRow.id, notes: generalNotesRow.notes } : null,
        deliveryDate: deliveryDateRow ? { id: deliveryDateRow.id, date: deliveryDateRow.dateDelivered } : null,
        period: period
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
