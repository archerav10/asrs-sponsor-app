const { requireSession } = require('./lib/session');
const {
  resolveMedicationDayOptions,
  isSlotLogged,
  logScheduledDose,
  TIME_SLOTS
} = require('./lib/medication-administration');

// Logs one scheduled dose. The date/slot/medication combination is
// re-validated server-side against a freshly-resolved day-walk — never
// trusted from the client — same "can't skip a day" enforcement
// save-daily-progress-note.js applies to its own outstandingDates.
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

    const medicationId = body.medicationId;
    const slot = body.slot;
    const status = body.status; // Given | Refused | Held
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '';

    if (TIME_SLOTS.indexOf(slot) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That is not a valid time of day.' }) };
    }
    if (['Given', 'Refused', 'Held'].indexOf(status) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That is not a valid status.' }) };
    }
    if (status !== 'Given' && !reason) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A reason is required for Refused or Held.' }) };
    }

    const options = await resolveMedicationDayOptions(session.location, resident);
    const date = options.outstandingDates.indexOf(body.date) !== -1 ? body.date : options.outstandingDates[0];
    if (date !== body.date) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That day isn’t available to log doses for.' }) };
    }

    const medication = options.regularMeds.find(function (m) { return m.id === medicationId; });
    if (!medication) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That medication is not an active scheduled medication for this resident.' }) };
    }
    if (medication.timesOfDay.indexOf(slot) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That medication is not scheduled for that time of day.' }) };
    }

    const logsForDay = options.logsByDate[date] || [];
    if (isSlotLogged(logsForDay, medication.itemName, slot)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This dose is already logged for that day.' }) };
    }

    const givenBy = session.name || session.email;
    await logScheduledDose(session.location, resident, date, medication, slot, status, reason, givenBy);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: date }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
