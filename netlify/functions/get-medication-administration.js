const { requireSession } = require('./lib/session');
const { resolveMedicationDayOptions, isSlotLogged, TIME_SLOTS } = require('./lib/medication-administration');

// Per-resident detail for the Give Medications screen. Mirrors
// get-daily-progress-note.js's shape: resolveMedicationDayOptions does
// all the day-walk/strictness work, this just picks the requested (or
// default) date out of whatever it returns and shapes the response.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const params = event.queryStringParameters || {};
    const requestedResident = params.resident;
    const resident = requestedResident && residents.indexOf(requestedResident) !== -1 ? requestedResident : residents[0];
    if (!resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
    }

    const options = await resolveMedicationDayOptions(session.location, resident);
    const date = params.date && options.outstandingDates.indexOf(params.date) !== -1 ? params.date : options.outstandingDates[0];
    const logsForDay = options.logsByDate[date] || [];

    const slots = TIME_SLOTS.map(function (slot) {
      const meds = options.regularMeds.filter(function (m) { return m.timesOfDay.indexOf(slot) !== -1; });
      return {
        slot: slot,
        medications: meds.map(function (m) {
          const log = logsForDay.find(function (l) { return l.itemName === m.itemName && l.timeOfDay === slot; });
          return {
            id: m.id,
            itemName: m.itemName,
            dosage: m.dosage,
            logged: !!log,
            status: log ? log.status : null,
            reason: log ? log.reason : null,
            givenBy: log ? log.givenBy : null,
            loggedAt: log ? log.loggedAt : null
          };
        })
      };
    }).filter(function (s) { return s.medications.length; });

    const todaysPrnLogs = (options.logsByDate[options.today] || []).filter(function (l) { return l.timeOfDay === 'PRN'; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        resident: resident,
        date: date,
        today: options.today,
        strict: options.strict,
        outstandingDates: options.outstandingDates,
        slots: slots,
        prnMedications: options.prnMeds.map(function (m) { return { id: m.id, itemName: m.itemName, dosage: m.dosage }; }),
        todaysPrnLogs: todaysPrnLogs
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
