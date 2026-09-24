const { findIntakeByToken, itemsForIntake, sponsorStatus, json, errorResponse } = require('./lib/sponsor-intake');

// The sponsor's read-only status page. The private token in the link is
// the only credential — no login — so everything returned goes through
// sponsorStatus's allowlist of sponsor-safe fields.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const token = (event.queryStringParameters || {}).t;
    const intake = await findIntakeByToken(token);
    if (!intake) {
      return json(404, { error: 'This status link isn\'t valid. Check the link in your most recent ASRS email.' });
    }
    const items = await itemsForIntake(intake.id);
    return json(200, sponsorStatus(intake, items));
  } catch (err) {
    return errorResponse(err);
  }
};
