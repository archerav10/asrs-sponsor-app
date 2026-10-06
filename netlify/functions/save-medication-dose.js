const { requireSession } = require('./lib/session');
const {
  resolveMedicationDayOptions,
  isSlotLogged,
  isSlotOpenNow,
  logScheduledDose,
  TIME_SLOTS,
  SLOT_START_LABEL
} = require('./lib/medication-administration');

// Logs one or more scheduled doses for the same resident/date in a
// single request — lets the provider app stage several checked-off
// doses (e.g. all of today's AM meds) and submit them together instead
// of a round trip per tap. Validates every dose against a freshly-
// resolved day-walk BEFORE writing any of them, so a batch either all
// lands or none of it does, rather than leaving a partial mix if one
// entry turns out to be invalid. The date/slot/medication combination
// is re-validated server-side — never trusted from the client — same
// "can't skip a day" enforcement save-daily-progress-note.js applies to
// its own outstandingDates.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const body = JSON.parse(event.body || '{}');
    const requestedResident = body.resident;
    const resident = requestedResident && residents.indexOf(requestedResident) !== -1 ? requestedResident : residents[0];
    if (!resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
    }

    const doses = Array.isArray(body.doses) ? body.doses : [];
    if (!doses.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No doses to log.' }) };
    }

    const normalized = doses.map(function (d) {
      return {
        medicationId: d.medicationId,
        slot: d.slot,
        status: d.status, // Given | Refused | Held
        reason: typeof d.reason === 'string' ? d.reason.trim().slice(0, 2000) : ''
      };
    });

    for (const d of normalized) {
      if (TIME_SLOTS.indexOf(d.slot) === -1) {
        return { statusCode: 400, body: JSON.stringify({ error: 'That is not a valid time of day.' }) };
      }
      if (['Given', 'Refused', 'Held'].indexOf(d.status) === -1) {
        return { statusCode: 400, body: JSON.stringify({ error: 'That is not a valid status.' }) };
      }
      if (d.status !== 'Given' && !d.reason) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A reason is required for Refused or Held.' }) };
      }
    }

    const options = await resolveMedicationDayOptions(session.location, resident);
    const date = options.outstandingDates.indexOf(body.date) !== -1 ? body.date : options.outstandingDates[0];
    if (date !== body.date) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That day isn’t available to log doses for.' }) };
    }

    const medsForDay = options.medicationsByDate[date] || { regularMeds: [] };
    const logsForDay = options.logsByDate[date] || [];

    // Validate every dose up front (medication exists/scheduled for that
    // slot, slot's opened yet if this is today, not already logged —
    // including against an earlier entry in this SAME batch, since
    // logsForDay won't reflect those until after they're actually
    // written below) before writing any of them.
    const resolvedMedications = [];
    const seen = {};
    for (const d of normalized) {
      const medication = medsForDay.regularMeds.find(function (m) { return m.id === d.medicationId; });
      if (!medication) {
        return { statusCode: 400, body: JSON.stringify({ error: 'That medication is not an active scheduled medication for this resident.' }) };
      }
      if (medication.timesOfDay.indexOf(d.slot) === -1) {
        return { statusCode: 400, body: JSON.stringify({ error: medication.itemName + ' is not scheduled for ' + d.slot + '.' }) };
      }
      if (!isSlotOpenNow(d.slot, date, options.today, options.nowHour)) {
        return { statusCode: 400, body: JSON.stringify({ error: d.slot + ' doses open at ' + SLOT_START_LABEL[d.slot] + '.' }) };
      }
      const key = medication.itemName + '|' + d.slot;
      if (isSlotLogged(logsForDay, medication.itemName, d.slot) || seen[key]) {
        return { statusCode: 409, body: JSON.stringify({ error: medication.itemName + ' (' + d.slot + ') is already logged for that day.' }) };
      }
      seen[key] = true;
      resolvedMedications.push(medication);
    }

    const givenBy = session.name || session.email;
    for (let i = 0; i < normalized.length; i++) {
      const d = normalized[i];
      await logScheduledDose(session.location, resident, date, resolvedMedications[i], d.slot, d.status, d.reason, givenBy);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, date: date, count: normalized.length }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
