const { queryDatabase, updatePage, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const MAR_DB_ID = process.env.MAR_DB_ID;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');
    const submittedItems = body.items || [];   // [{ id, currentExpDate?, missing?, quantity? }]
    const allergyInfo = body.allergyInfo;      // string, optional
    const generalNotes = body.generalNotes;    // string, optional

    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!residents.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
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

    const authoritative = {};
    let allergyId = null;
    let generalNotesId = null;
    (result.results || []).forEach(function (page) {
      const name = getPlainText(page.properties['Item Name']);
      if (name === 'Allergy Info') {
        allergyId = page.id;
      } else if (name === 'General Notes') {
        generalNotesId = page.id;
      } else {
        authoritative[page.id] = { medicationType: getPlainText(page.properties['Medication Type']) };
      }
    });

    const stampedBy = session.name || session.email;
    const today = todayISO();
    let updatedCount = 0;

    for (const submitted of submittedItems) {
      const known = authoritative[submitted.id];
      if (!known) continue; // not this resident's medication — ignore

      const isMissing = !!submitted.missing;
      const properties = {
        'Missing': { checkbox: isMissing },
        'Current Exp Date': isMissing || !submitted.currentExpDate ? { date: null } : { date: { start: submitted.currentExpDate } },
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      };

      if (known.medicationType === 'PRN' && submitted.quantity !== undefined) {
        properties['Quantity'] = { rich_text: [{ text: { content: submitted.quantity } }] };
      }

      await updatePage(submitted.id, properties);
      updatedCount++;
    }

    if (allergyId && allergyInfo !== undefined) {
      await updatePage(allergyId, {
        'Notes': { rich_text: [{ text: { content: allergyInfo } }] },
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      });
    }
    if (generalNotesId && generalNotes !== undefined) {
      await updatePage(generalNotesId, {
        'Notes': { rich_text: [{ text: { content: generalNotes } }] },
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, count: updatedCount, date: today }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
