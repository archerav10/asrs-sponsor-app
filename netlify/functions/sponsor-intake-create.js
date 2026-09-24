const { requireIntakeAdmin, createIntake, json, errorResponse } = require('./lib/sponsor-intake');
const { welcomeEmail, sendToSponsor } = require('./lib/sponsor-intake-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Starts a new intake: one Sponsor Intakes row with a fresh private
// status-page token. No item rows yet — they're created lazily as each
// step is first touched. Optionally emails the sponsor their status link.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireIntakeAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const phone = (body.phone || '').trim();

    if (!name || !email) {
      return json(400, { error: 'Enter the sponsor\'s name and email.' });
    }
    if (!EMAIL_RE.test(email)) {
      return json(400, { error: 'That email address doesn\'t look right.' });
    }

    const intake = await createIntake(name, email, phone, session.name || session.email);

    let welcomeSent = false;
    if (body.sendWelcome) {
      await sendToSponsor(intake, welcomeEmail(intake, (body.note || '').trim()));
      welcomeSent = true;
    }

    return json(200, { id: intake.id, welcomeSent: welcomeSent });
  } catch (err) {
    return errorResponse(err);
  }
};
