const { requireSession } = require('./lib/session');
const isp = require('./lib/isp-training');
const { staffInfoById } = require('./lib/staff-training');
const { sendSms, normalizePhone } = require('./lib/twilio');

// Text link: texts one staff member their signing link for one resident's
// plan, only when an admin clicks it (never on a schedule), and only when
// their SMS Consent Status is Opted In and they have a phone number.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const body = JSON.parse(event.body || '{}');
    if (!body.staffId || !body.resident) return { statusCode: 400, body: JSON.stringify({ error: 'staffId and resident are required.' }) };

    const member = await staffInfoById(body.staffId);
    if ((session.grantedLocations || []).indexOf(member.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const phone = normalizePhone(member.phone);
    if (!phone) return { statusCode: 400, body: JSON.stringify({ error: member.name + ' has no phone number in ASRS People.' }) };
    if (member.smsConsent !== 'Opted In') {
      return { statusCode: 400, body: JSON.stringify({ error: member.name + ' hasn\'t opted in to texts (SMS Consent Status in ASRS People). Use Copy link instead.' }) };
    }
    const plan = await isp.currentPlan(member.location, body.resident);
    if (!plan) return { statusCode: 400, body: JSON.stringify({ error: 'There\'s no current plan on file for ' + body.resident + '.' }) };

    const first = (member.name || '').trim().split(/\s+/)[0] || 'there';
    const link = isp.signingLink(isp.siteFor(event), member, plan);
    await sendSms(phone, 'ASRS: Hi ' + first + ', please review and sign your ISP training acknowledgment for ' + plan.resident +
      '\'s plan (' + (plan.revised ? 'revised ' : 'effective ') + isp.usDate(plan.planDate) + '): ' + link + ' Reply STOP to opt out.');

    return { statusCode: 200, body: JSON.stringify({ sent: true, to: '•••' + phone.slice(-4) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
