const crypto = require('crypto');
const wf = require('./lib/weekly-focus');
const sms = require('./lib/weekly-focus-sms');
const { alertAdminsRed } = require('./lib/weekly-focus-alert');

// Twilio calls this for every text sent to the Messaging Service's number
// (the service's "Incoming messages" webhook). It records Weekly Focus
// text replies:
//
//   1 / 2 / 3     the sponsor's answer for their open week (Green /
//                 Yellow / Red), same as tapping it in the app. Can be
//                 changed until the next week goes out. 3 texts the
//                 admins right away. The sponsor gets a confirmation.
//   other text    after they've answered: added to that week's comment
//                 (for a 2 or 3, the confirmation invites a short note).
//                 Before they've answered: asked to reply 1, 2 or 3.
//   STOP / START  Twilio itself stops or resumes texting that number and
//                 replies; this only mirrors it on the sponsor's SMS
//                 Consent Status, so next week goes by email instead.
//
// Messages from numbers that aren't a sponsor's are ignored (no reply).
// The reply is TwiML, so Twilio sends it back on the same thread.

function twiml(message) {
  const body = message
    ? '<Message>' + String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</Message>'
    : '';
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: '<?xml version="1.0" encoding="UTF-8"?><Response>' + body + '</Response>'
  };
}

// https://www.twilio.com/docs/usage/security#validating-requests: base64
// HMAC-SHA1 (auth token as key) of the full URL followed by every POST
// parameter, sorted by name, as name+value.
function expectedSignature(url, params, authToken) {
  const data = Object.keys(params).sort().reduce(function (acc, key) { return acc + key + params[key]; }, url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function candidateUrls(event) {
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  const query = event.rawQuery ? '?' + event.rawQuery : '';
  return [process.env.SMS_INBOUND_URL, event.rawUrl, host ? 'https://' + host + event.path + query : null]
    .filter(Boolean);
}

function isFromTwilio(event, params) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = (event.headers || {})['x-twilio-signature'];
  if (!authToken || !signature) return false;
  return candidateUrls(event).some(function (url) { return safeEqual(expectedSignature(url, params, authToken), signature); });
}

function parseForm(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf-8') : (event.body || '');
  const params = {};
  new URLSearchParams(raw).forEach(function (value, key) { params[key] = value; });
  return params;
}

// The sponsor (and their open week) a reply is for. A phone number on
// more than one sponsor row picks the one whose latest week went out by
// text, then the most recent week.
async function findOpenWeek(phone) {
  const sponsors = (await wf.sponsorsByPhone(phone)).filter(function (s) { return s.enabled && s.email; });
  const options = [];
  for (const sponsor of sponsors) {
    const history = await wf.responsesForSponsor(sponsor.email);
    if (history.length) options.push({ sponsor: sponsor, response: history[0] });
  }
  options.sort(function (a, b) {
    const at = a.response.channel === 'Text' ? 1 : 0;
    const bt = b.response.channel === 'Text' ? 1 : 0;
    if (at !== bt) return bt - at;
    return a.response.weekOf < b.response.weekOf ? 1 : a.response.weekOf > b.response.weekOf ? -1 : 0;
  });
  return { sponsors: sponsors, match: options[0] || null };
}

function doneIndexes(response) {
  return response.checklist.map(function (item, i) { return item.done ? i : -1; }).filter(function (i) { return i >= 0; });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const params = parseForm(event);
  if (!isFromTwilio(event, params)) {
    console.warn('sms-inbound: rejected a request without a valid Twilio signature');
    return { statusCode: 403, body: 'Forbidden' };
  }

  try {
    const from = params.From || '';
    const body = String(params.Body || '').trim();

    const keyword = sms.keywordOf(body);
    if (keyword === 'optOut' || keyword === 'optIn') {
      const status = keyword === 'optOut' ? 'Opted Out' : 'Opted In';
      for (const sponsor of await wf.sponsorsByPhone(from)) {
        try { await wf.setSmsConsent(sponsor.id, status); } catch (e) { console.error('Could not set SMS consent for ' + sponsor.name, e); }
      }
      return twiml(null); // Twilio sends its own STOP/START confirmation
    }
    if (keyword === 'help') return twiml(null);

    const found = await findOpenWeek(from);
    if (!found.sponsors.length) return twiml(null); // not a sponsor's number
    const choice = sms.parseChoice(body);
    if (!found.match) return twiml(choice ? sms.CLOSED : null);

    const sponsor = found.match.sponsor;
    const response = found.match.response; // their newest week: the open one

    if (choice) {
      const wasRed = response.status === 'Red';
      const saved = await wf.saveResponse(response, choice.status, response.comment, doneIndexes(response));
      if (choice.status === 'Red' && !wasRed) await alertAdminsRed(saved);
      return twiml(sms.confirmationSms(sponsor, choice.status));
    }

    if (!body) return twiml(null);
    if (response.status === 'Pending') return twiml(sms.promptSms());
    await wf.appendComment(response, body.slice(0, 1000));
    return twiml(sms.NOTE_THANKS);
  } catch (err) {
    console.error('sms-inbound failed', err);
    // Still a 200 (a Twilio retry wouldn't help). Only an answer gets a
    // reply, so the sponsor knows to try again.
    return twiml(sms.parseChoice(params.Body) ? sms.SORRY : null);
  }
};

exports.expectedSignature = expectedSignature;
