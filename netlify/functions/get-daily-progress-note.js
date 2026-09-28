const { requireSession } = require('./lib/session');
const { getResidentDayWalk, findQuestionsForDate, findAnswers, missingQuestions } = require('./lib/daily-progress-notes');

// Per-resident detail: resolves the full set of outstanding (unsigned)
// days for this resident — every one from the earliest unsigned day
// through today, oldest first — and returns the requested day's
// questions/answers, defaulting to the oldest outstanding day when no
// ?date= is given. An unrecognized/stale ?date= (already signed since,
// or simply never valid) falls back to the default rather than erroring
// — this is a read, so there's nothing destructive about silently
// recovering; save/sign reject the same mismatch outright since that's
// where "can't skip a day" actually has to hold. Uses one shared day
// walk (getResidentDayWalk) for both the outstanding list and the
// requested day's own cover, rather than querying Notion for the cover
// a second time.
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

    const days = await getResidentDayWalk(session.location, resident);
    const outstandingDays = days.filter(function (d) { return !d.cover || !d.cover.signedAt; });
    if (!outstandingDays.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          location: session.location,
          resident: resident,
          date: null,
          outstandingDates: [],
          cover: null,
          questions: [],
          answers: {},
          missingQuestions: []
        })
      };
    }

    const requestedDay = params.date && outstandingDays.find(function (d) { return d.date === params.date; });
    const day = requestedDay || outstandingDays[0];

    const questions = await findQuestionsForDate(session.location, resident, day.date);
    const answersByKey = await findAnswers(session.location, resident, day.date);

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        resident: resident,
        date: day.date,
        outstandingDates: outstandingDays.map(function (d) { return d.date; }),
        cover: day.cover,
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
