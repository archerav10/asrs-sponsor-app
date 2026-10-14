const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');

// The sponsor's Weekly Focus check-in: their most recent week (the only
// one still open for answers), the content for it, their residents'
// Daily Progress Notes status, and a list of earlier weeks. ?weekOf=
// opens an earlier week read-only — e.g. a button tapped in an old email.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'sponsor' || !session.email) {
      return { statusCode: 403, body: JSON.stringify({ error: 'The Weekly Focus check-in is for sponsors.' }) };
    }

    const params = event.queryStringParameters || {};
    const history = await wf.responsesForSponsor(session.email);
    if (!history.length) {
      return { statusCode: 200, body: JSON.stringify({ hasWeeks: false }) };
    }

    const response = (params.weekOf && history.filter(function (r) { return r.weekOf === params.weekOf; })[0]) || history[0];
    const results = await Promise.all([
      wf.contentForWeek(response.weekOf),
      wf.contentSince(history[history.length - 1].weekOf),
      wf.documentationStatus(session.location, session.residentInitials)
    ]);
    const content = results[0];
    const titles = {};
    results[1].forEach(function (c) { titles[c.weekOf] = c.focusTitle; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        hasWeeks: true,
        requestedWeekFound: !params.weekOf || response.weekOf === params.weekOf,
        week: {
          responseId: response.id,
          weekOf: response.weekOf,
          dueDate: wf.dueDateFor(response.weekOf),
          isOpen: wf.isOpen(response, history),
          isPastDue: wf.isLate(response.weekOf),
          status: response.status,
          comment: response.comment,
          checklist: response.checklist,
          respondedAt: response.respondedAt,
          late: response.late,
          followedUp: response.followedUp
        },
        content: content ? {
          quote: content.quote,
          quoteAuthor: content.quoteAuthor,
          focusTitle: content.focusTitle,
          focusMessage: content.focusMessage
        } : null,
        documentation: results[2],
        pastWeeks: history.map(function (r) {
          return { weekOf: r.weekOf, focusTitle: titles[r.weekOf] || '', status: r.status, late: r.late };
        })
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
