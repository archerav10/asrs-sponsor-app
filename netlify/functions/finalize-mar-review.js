const { queryDatabase, updatePage, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { computeMarWindow, findPeriodPage, wipeIfWindowJustOpened } = require('./lib/mar-review-state');

const MAR_DB_ID = process.env.MAR_DB_ID;

const EARLIEST_DATE = '1900-01-01';

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
    const submittedItems = body.items || [];
    const allergyInfo = body.allergyInfo;
    const generalNotes = body.generalNotes;
    const deliveryDate = body.deliveryDate;

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

    const authoritative = {}; // id -> { medicationType, itemName }
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
        authoritative[page.id] = {
          medicationType: getPlainText(page.properties['Medication Type']),
          itemName: name
        };
      }
    });

    let periodPage = await findPeriodPage(session.location, targetResident);
    const existingLastFinalized = periodPage ? getPlainText(periodPage.properties['Last Finalized Period']) : null;
    const windowState = computeMarWindow(existingLastFinalized);
    const targetPeriod = windowState.targetPeriod;

    // Same server-side gate as confirm-mar-review — the UI shouldn't even
    // offer a Finalize button before the window opens, but don't rely on
    // that alone.
    if (!windowState.isWindowOpen) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'The ' + targetPeriod + ' review isn\'t open yet. It opens ' + windowState.windowOpenDate.toISOString().slice(0, 10) + '.',
          windowOpenDate: windowState.windowOpenDate.toISOString().slice(0, 10),
          targetPeriod: targetPeriod
        })
      };
    }

    // Defensive: normally get-mar-review/confirm-mar-review already did
    // this the first time the window was touched, but finalize can in
    // principle be the very first request of a new period.
    const wipeResult = await wipeIfWindowJustOpened({
      location: session.location,
      resident: targetResident,
      periodPage: periodPage,
      medicationIds: Object.keys(authoritative),
      deliveryDateId: deliveryDateId,
      windowState: windowState
    });
    periodPage = wipeResult.periodPage;

    const submittedById = {};
    submittedItems.forEach(function (s) { submittedById[s.id] = s; });

    const today = todayISO();
    const uncaptured = [];
    const expired = [];

    Object.keys(authoritative).forEach(function (id) {
      const med = authoritative[id];
      const submitted = submittedById[id];
      const isMissing = submitted ? !!submitted.missing : false;
      const expDate = submitted ? submitted.currentExpDate : '';

      if (!submitted || (!isMissing && !expDate)) {
        uncaptured.push(med.itemName);
        return;
      }
      if (!isMissing && expDate < today) {
        expired.push(med.itemName);
      }
    });

    if (!deliveryDate) {
      uncaptured.push('Medication Delivery Date');
    }

    if (uncaptured.length || expired.length) {
      const parts = [];
      if (uncaptured.length) parts.push(uncaptured.length + ' not captured (' + uncaptured.join(', ') + ')');
      if (expired.length) parts.push(expired.length + ' expired (' + expired.join(', ') + ')');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cannot finalize — ' + parts.join('; ') + '.' })
      };
    }

    // Validation passed — persist everything, same as a draft save.
    const stampedBy = session.name || session.email;
    let updatedCount = 0;

    for (const submitted of submittedItems) {
      const known = authoritative[submitted.id];
      if (!known) continue;

      const isMissing = !!submitted.missing;
      const properties = {
        'Missing': { checkbox: isMissing },
        'Current Exp Date': isMissing
          ? { date: { start: EARLIEST_DATE } }
          : { date: { start: submitted.currentExpDate } },
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
    if (deliveryDateId && deliveryDate) {
      await updatePage(deliveryDateId, {
        'Date Delivered': { date: { start: deliveryDate } },
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      });
    }

    // Update the period tracker so the rolling target advances. This is
    // the permanent historical record (finalized period/date/by) — it no
    // longer owns wiping the working medication data; that happens when
    // the NEXT period's window opens (see lib/mar-review-state.js).
    const periodProperties = {
      'Last Finalized Period': { rich_text: [{ text: { content: targetPeriod } }] },
      'Last Finalized Date': { date: { start: today } },
      'Last Finalized By': { rich_text: [{ text: { content: stampedBy } }] },
      'Last Reviewed Period': { rich_text: [{ text: { content: targetPeriod } }] },
      'Last Reviewed Date': { date: { start: today } },
      'Medications Delivered Date': { date: { start: deliveryDate } }
    };
    await updatePage(periodPage.id, periodProperties);

    return { statusCode: 200, body: JSON.stringify({ success: true, count: updatedCount, finalizedPeriod: targetPeriod, date: today }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
