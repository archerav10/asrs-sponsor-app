const { requireSession } = require('./lib/session');
const { findTemplate, create } = require('./lib/shared-checklists');

// Admin dashboard only: sends out a new shared checklist (e.g. DSP
// Intake for one incoming person) to a location. Everyone logged into
// the provider app at that location sees it until it's marked complete.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const subject = (body.subject || '').trim();
    const location = body.location;

    if (!findTemplate(body.templateKey)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Choose a checklist type.' }) };
    }
    if (!subject) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Enter who this checklist is for.' }) };
    }
    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const checklist = await create(body.templateKey, subject, location, session.name || session.email);

    return { statusCode: 200, body: JSON.stringify({ checklist: checklist }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
