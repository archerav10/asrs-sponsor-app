const { requireSession } = require('./lib/session');
const { medicationsForResidentOnDate, logPrnDose, isoDate } = require('./lib/medication-administration');

// Logs an as-needed dose, always "now" — no date/slot picking, no
// day-walk gating (PRN doses are never part of what makes a scheduled
// day "complete"). A reason is always required, since there's no
// physician-ordered time this was expected at — the reason is the only
// record of why it was given.
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
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '';
    if (!reason) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A reason is required for an as-needed dose.' }) };
    }

    const medications = await medicationsForResidentOnDate(session.location, resident, isoDate(new Date()));
    const medication = medications.find(function (m) { return m.id === medicationId && m.medicationType === 'PRN'; });
    if (!medication) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That medication is not an active as-needed medication for this resident today.' }) };
    }

    const givenBy = session.name || session.email;
    await logPrnDose(session.location, resident, medication, reason, givenBy);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
