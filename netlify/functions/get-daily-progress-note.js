const { requireSession } = require('./lib/session');
const { resolveDayOptions, findQuestionsForDate, findAnswers, missingQuestions } = require('./lib/daily-progress-notes');

// Per-resident detail. Two regimes, both from resolveDayOptions:
//   - First entry ever for this resident (no cover on file at all):
//     nothing is mandatory yet. Returns isFirstEntry:true plus
//     initialDateMin/Max — any date in that inclusive range (the
//     questionnaire's earliest Effective Date through today) is a valid
//     choice for the very first day, matching "notes are usually
//     entered the morning after" rather than forcing literally today.
//   - Ordinary catch-up: returns the full outstandingDates list (oldest
//     first) exactly as before.
// An unrecognized/stale ?date= falls back to the regime's own default
// rather than erroring — this is a read, so there's nothing destructive
// about silently recovering; save/sign reject the same mismatch outright
// since that's where "can't skip a day" actually has to hold.
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

    const options = await resolveDayOptions(session.location, resident);

    const emptyResponse = function (extra) {
      return {
        statusCode: 200,
        body: JSON.stringify(Object.assign({
          location: session.location,
          resident: resident,
          date: null,
          isFirstEntry: options.isFirstEntry,
          initialDateMin: options.initialDateMin,
          initialDateMax: options.initialDateMax,
          outstandingDates: [],
          cover: null,
          questions: [],
          answers: {},
          missingQuestions: []
        }, extra || {}))
      };
    };

    if (options.isFirstEntry) {
      if (!options.initialDateMin) {
        return emptyResponse();
      }
      const requested = params.date;
      const date = requested && requested >= options.initialDateMin && requested <= options.initialDateMax
        ? requested
        : options.today;
      const questions = await findQuestionsForDate(session.location, resident, date);
      const answersByKey = await findAnswers(session.location, resident, date);
      const timesCoveredEditable = questions.length ? !!questions[0].timesCoveredEditable : false;
      return {
        statusCode: 200,
        body: JSON.stringify({
          location: session.location,
          resident: resident,
          date: date,
          isFirstEntry: true,
          initialDateMin: options.initialDateMin,
          initialDateMax: options.initialDateMax,
          outstandingDates: [date],
          cover: null,
          timesCoveredEditable: timesCoveredEditable,
          timesCovered: timesCoveredEditable ? '' : (questions.length ? questions[0].timesCovered : ''),
          questions: questions.map(function (q) {
            return { key: q.key, text: q.text, type: q.type, checklistItems: q.checklistItems };
          }),
          answers: answersByKey,
          missingQuestions: missingQuestions(questions, answersByKey)
        })
      };
    }

    if (!options.outstandingDates.length) {
      return emptyResponse();
    }

    const date = params.date && options.outstandingDates.indexOf(params.date) !== -1 ? params.date : options.outstandingDates[0];
    const questions = await findQuestionsForDate(session.location, resident, date);
    const answersByKey = await findAnswers(session.location, resident, date);
    const cover = options.coverByDate[date] || null;
    const timesCoveredEditable = questions.length ? !!questions[0].timesCoveredEditable : false;
    const timesCovered = cover && cover.timesCovered
      ? cover.timesCovered
      : (timesCoveredEditable ? '' : (questions.length ? questions[0].timesCovered : ''));

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        resident: resident,
        date: date,
        isFirstEntry: false,
        initialDateMin: null,
        initialDateMax: null,
        outstandingDates: options.outstandingDates,
        cover: cover,
        timesCoveredEditable: timesCoveredEditable,
        timesCovered: timesCovered,
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
