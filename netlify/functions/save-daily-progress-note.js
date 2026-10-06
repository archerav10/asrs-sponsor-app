const { requireSession } = require('./lib/session');
const { resolveDayOptions, findQuestionsForDate, saveAnswers } = require('./lib/daily-progress-notes');

// Draft save: persists whatever is currently entered, complete or not —
// no validation here, that's sign-daily-progress-note's job. Two
// regimes from resolveDayOptions: for a resident's very first entry ever
// (no cover on file yet), any date within [initialDateMin, initialDateMax]
// is accepted — the questionnaire's earliest Effective Date through
// today — since nothing is mandatory before that first save actually
// happens; for ordinary catch-up, the date must be one of the currently
// outstanding (unsigned) days. Either way, a client-supplied date is
// only ever accepted if it's actually valid for whichever regime
// applies — never trusted outright.
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

    const answers = body.answers || {}; // { [questionKey]: { answerText?, checklistAnswers? } }
    const options = await resolveDayOptions(session.location, resident);

    let date;
    if (options.isFirstEntry) {
      if (!options.initialDateMin) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published yet. Contact an admin.' }) };
      }
      date = options.today;
      if (body.date) {
        if (body.date < options.initialDateMin || body.date > options.initialDateMax) {
          return { statusCode: 400, body: JSON.stringify({ error: 'That date is outside the questionnaire’s effective range.' }) };
        }
        date = body.date;
      }
    } else {
      if (!options.outstandingDates.length) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Today is already signed. Come back tomorrow.' }) };
      }
      date = options.outstandingDates[0];
      if (body.date) {
        if (options.outstandingDates.indexOf(body.date) === -1) {
          return { statusCode: 400, body: JSON.stringify({ error: 'That day isn’t available to enter notes for.' }) };
        }
        date = body.date;
      }
    }

    const questions = await findQuestionsForDate(session.location, resident, date);
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published for ' + date + ' yet. Contact an admin.' }) };
    }
    const enteredBy = session.name || session.email;
    const timesCovered = typeof body.timesCovered === 'string' ? body.timesCovered.trim() : '';
    await saveAnswers(session.location, resident, date, questions, answers, enteredBy, timesCovered);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: date }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
