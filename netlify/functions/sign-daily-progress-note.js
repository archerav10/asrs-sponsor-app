const { requireSession } = require('./lib/session');
const { resolveTarget, findQuestionsForDate, findAnswers, missingQuestions, signAndFinalize } = require('./lib/daily-progress-notes');

// Validates first: every question must have a real value — mirrors every
// other process's Finalize gate. Failing blocks signing with a message
// naming which questions still need attention. strokes is the signature
// pad's raw pen-stroke points, stored as-is and replayed as vector line
// drawing when the nightly job renders the PDF.
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

    const strokes = body.strokes;
    if (!strokes || !strokes.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A signature is required.' }) };
    }

    const target = await resolveTarget(session.location, resident);
    if (target.cover && target.cover.signedAt) {
      return { statusCode: 403, body: JSON.stringify({ error: 'That day is already signed.' }) };
    }

    const questions = await findQuestionsForDate(session.location, resident, target.targetDate);
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published for ' + target.targetDate + ' yet. Contact an admin.' }) };
    }
    const answersByKey = await findAnswers(session.location, resident, target.targetDate);
    const missing = missingQuestions(questions, answersByKey);
    if (missing.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Still needs: ' + missing.join(', ') }) };
    }

    const signedBy = session.name || session.email;
    await signAndFinalize(session.location, resident, target.targetDate, signedBy, strokes);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: target.targetDate }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
