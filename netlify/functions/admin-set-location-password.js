const crypto = require('crypto');
const { queryDatabase, updatePage } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const LOCATION_CODES_DB_ID = process.env.LOCATION_CODES_DB_ID;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const body = JSON.parse(event.body || '{}');
    const location = body.location;
    const newPassword = body.newPassword;

    if (!location || !newPassword || newPassword.length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location and a password of at least 8 characters are required.' }) };
    }

    const result = await queryDatabase(LOCATION_CODES_DB_ID, {
      property: 'Location', title: { equals: location }
    });
    const page = (result.results || [])[0];
    if (!page) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No matching location found. Check spelling/capitalization.' }) };
    }

    await updatePage(page.id, {
      'Password Hash': { rich_text: [{ text: { content: hashPassword(newPassword) } }] },
      'Active': { checkbox: true }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
