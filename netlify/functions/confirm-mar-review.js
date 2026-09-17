const { queryDatabase, updatePage, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const MAR_DB_ID = process.env.MAR_DB_ID;

// If a medication is marked Missing, it can't have a real expiration date —
// but we still want SOME date on the row (rather than blank) so it always
// sorts/reads as maximally overdue rather than being confused with "not
// yet looked at." This sentinel is never a value a person would enter.
const EARLIEST_DATE = '1900-01-01';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Draft save: persists whatever is currently on screen, incomplete or
// not. No validation here — that's finalize-mar-review's job.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');
    const submittedItems = body.items || [];   // [{ id, currentExpDate?, missing?, quantity? }]
    const allergyInfo = body.allergyInfo;
    const generalNotes = body.generalNotes;
    const deliveryDate = body.deliveryDate;    // single date for the whole report, or undefined

    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!residents.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
    }
    const requestedResident = body.resident;
    const targetResident = requestedResident && residents.indexOf(requestedResident) !== -1 ? requestedResident : residents[0];
    const residentFilter = { property: 'Resident Initials', rich_text: { equals: targetResident } };

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
    let deliveryDateId = null;
    (result.results || []).forEach(function (page) {
      const name = getPlainText(page.properties['Item Name']);
      if (name === 'Allergy Info') {
        allergyId = page.id;
      } else if (name === 'General Notes') {
        generalNotesId = page.id;
      } else if (name === 'Medication Delivery Date') {
        deliveryDateId = page.id;
      } else {
        authoritative[page.id] = { medicationType: getPlainText(page.properties['Medication Type']) };
      }
    });

    const stampedBy = session.name || session.email;
    const today = todayISO();
    let updatedCount = 0;

    for (const submitted of submittedItems) {
      const known = authoritative[submitted.id];
      if (!known) continue;

      const isMissing = !!submitted.missing;
      const properties = {
        'Missing': { checkbox: isMissing },
        'Current Exp Date': isMissing
          ? { date: { start: EARLIEST_DATE } }
          : (submitted.currentExpDate ? { date: { start: submitted.currentExpDate } } : { date: null }),
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
    if (deliveryDateId && deliveryDate !== undefined) {
      await updatePage(deliveryDateId, {
        'Date Delivered': deliveryDate ? { date: { start: deliveryDate } } : { date: null },
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
