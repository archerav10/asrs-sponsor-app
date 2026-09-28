const { requireSession } = require('./lib/session');
const { findOutstandingDays, findQuestionsForDate, saveAnswers } = require('./lib/daily-progress-notes');

// Draft save: persists whatever is currently entered, complete or not —
// no validation here, that's sign-daily-progress-note's job. Only ever
// writes to a day that's actually outstanding (unsigned, and from the
// earliest one through today) — never whatever date a stale or tampered
// client request happens to send — defaulting to the oldest outstanding
// day when none is given.
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

    const outstanding = await findOutstandingDays(session.location, resident);
    if (!outstanding.length) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Today is already signed. Come back tomorrow.' }) };
    }

    let date = outstanding[0];
    if (body.date) {
      if (outstanding.indexOf(body.date) === -1) {
        return { statusCode: 400, body: JSON.stringify({ error: 'That day isn’t available to enter notes for.' }) };
      }
      date = body.date;
    }

    const questions = await findQuestionsForDate(session.location, resident, date);
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published for ' + date + ' yet. Contact an admin.' }) };
    }
    await saveAnswers(session.location, resident, date, questions, answers);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: date }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
