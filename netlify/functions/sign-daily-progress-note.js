const { requireSession } = require('./lib/session');
const { resolveDayOptions, findQuestionsForDate, findAnswers, missingQuestions, signAndFinalize } = require('./lib/daily-progress-notes');

// Validates first: every question must have a real value — mirrors every
// other process's Finalize gate. Failing blocks signing with a message
// naming which questions still need attention. strokes is the signature
// pad's raw pen-stroke points, stored as-is and replayed as vector line
// drawing when the nightly job renders the PDF. Same dual-regime date
// validation as save-daily-progress-note.js: a resident's very first
// entry ever accepts any date within the questionnaire's effective
// range, ordinary catch-up requires one of the currently outstanding
// days — never whatever date a stale or tampered client request
// happens to send.
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
          return { statusCode: 400, body: JSON.stringify({ error: 'That day isn’t available to sign.' }) };
        }
        date = body.date;
      }
    }

    const questions = await findQuestionsForDate(session.location, resident, date);
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Daily Progress Notes questionnaire is published for ' + date + ' yet. Contact an admin.' }) };
    }
    const answersByKey = await findAnswers(session.location, resident, date);
    const missing = missingQuestions(questions, answersByKey);
    if (missing.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Still needs: ' + missing.join(', ') }) };
    }

    const signedBy = session.name || session.email;
    await signAndFinalize(session.location, resident, date, signedBy, strokes);

    return { statusCode: 200, body: JSON.stringify({ success: true, date: date }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
