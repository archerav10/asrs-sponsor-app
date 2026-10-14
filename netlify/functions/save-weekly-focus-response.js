const { requireSession } = require('./lib/session');
const { recipientsForLocation, allEnabledAdmins } = require('./lib/notification-recipients');
const { sendSms } = require('./lib/twilio');
const wf = require('./lib/weekly-focus');
const { redAlertText } = require('./lib/weekly-focus-email');

const MAX_COMMENT = 4000;

// Saves a sponsor's check-in. Can be changed as often as they like while
// the week is still open (until the next week goes out); answering after
// Thursday is accepted and marked Late. Choosing Red texts the admins for
// the sponsor's location right away — every admin with app access there,
// regardless of the routine-notification opt-out, the same as a Serious
// Incident alert, because Red means "contact me ASAP".
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'sponsor' || !session.email) {
      return { statusCode: 403, body: JSON.stringify({ error: 'The Weekly Focus check-in is for sponsors.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const status = body.status;
    const comment = String(body.comment || '').trim();
    if (wf.STATUSES.indexOf(status) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Choose All good, I need to discuss something, or Please contact me ASAP.' }) };
    }
    if (comment.length > MAX_COMMENT) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That note is too long. Please keep it under ' + MAX_COMMENT + ' characters.' }) };
    }

    const history = await wf.responsesForSponsor(session.email);
    const response = history.filter(function (r) { return r.id === body.responseId; })[0];
    if (!response) {
      return { statusCode: 404, body: JSON.stringify({ error: 'That check-in was not found.' }) };
    }
    if (!wf.isOpen(response, history)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This week has closed. Please answer this week\'s check-in instead.' }) };
    }

    const doneIndexes = (Array.isArray(body.done) ? body.done : [])
      .map(Number)
      .filter(function (i) { return Number.isInteger(i) && i >= 0 && i < response.checklist.length; });
    const wasRed = response.status === 'Red';
    const saved = await wf.saveResponse(response, status, comment, doneIndexes);

    let adminsAlerted = 0;
    if (status === 'Red' && !wasRed) {
      let admins = (await recipientsForLocation(saved.location)).filter(function (r) { return r.role === 'admin'; });
      // Nobody granted this location: a Red must still reach someone.
      if (!admins.length) admins = await allEnabledAdmins();
      for (const admin of admins) {
        try {
          await sendSms(admin.phone, redAlertText(saved));
          adminsAlerted++;
        } catch (e) {
          console.error('Weekly Focus Red alert failed for ' + admin.name, e);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, status: saved.status, late: saved.late, adminsAlerted: adminsAlerted })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
