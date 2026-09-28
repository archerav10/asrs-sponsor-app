const { requireSession } = require('./lib/session');
const { resolveTarget, findQuestionsForDate, saveAnswers } = require('./lib/daily-progress-notes');

// Draft save: persists whatever is currently entered, complete or not —
// no validation here, that's sign-daily-progress-note's job. Only ever
// writes to whatever day the server itself resolves as current (never
// whatever date the client happens to send), so a stale screen can't
// accidentally save into the wrong day, and can't be used to write to a
// day that isn't the resolved target.
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

    const target = await resolveTarget(session.location, resident);
    if (target.cover && target.cover.signedAt) {
      return { statusCode: 403, body: JSON.stringify({ error: 'That day is already signed.' }) };
    }

    const questions = await findQuestionsForDate(session.location, resident, target.targetDate);
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published for ' + target.targetDate + ' yet. Contact an admin.' }) };
    }
    await saveAnswers(session.location, resident, target.targetDate, questions, answers);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: target.targetDate }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
