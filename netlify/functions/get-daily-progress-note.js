const { requireSession } = require('./lib/session');
const { resolveTarget, findQuestionsForDate, findAnswers, missingQuestions } = require('./lib/daily-progress-notes');

// Per-resident detail: resolves which day this resident is currently on
// (the earliest unsigned day, or today if fully caught up — see
// resolveTarget's comment in lib/daily-progress-notes.js) and returns
// that day's questions (under whichever template version was actually in
// effect on that date) plus whatever's already been answered/signed.
// The client only ever renders this resolved day — there is no way to
// pick a different date — which is what enforces "can't skip a day."
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const requestedResident = event.queryStringParameters && event.queryStringParameters.resident;
    const resident = requestedResident && residents.indexOf(requestedResident) !== -1 ? requestedResident : residents[0];
    if (!resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
    }

    const target = await resolveTarget(session.location, resident);
    const questions = await findQuestionsForDate(session.location, resident, target.targetDate);
    const answersByKey = await findAnswers(session.location, resident, target.targetDate);

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        resident: resident,
        date: target.targetDate,
        cover: target.cover,
        questions: questions.map(function (q) {
          return { key: q.key, text: q.text, type: q.type, checklistItems: q.checklistItems };
        }),
        answers: answersByKey,
        missingQuestions: missingQuestions(questions, answersByKey)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
