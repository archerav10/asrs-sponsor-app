const crypto = require('crypto');
const { queryDatabase, updatePage, getPlainText } = require('./lib/notion');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;

function isAdmin(email) {
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map(function (e) {
    return e.trim().toLowerCase();
  });
  return allowed.indexOf((email || '').trim().toLowerCase()) !== -1;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const adminEmail = body.adminEmail;
    const providerEmail = body.providerEmail;
    const newPassword = body.newPassword;

    if (!isAdmin(adminEmail)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
    }
    if (!providerEmail || !newPassword || newPassword.length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Provider email and a password of at least 8 characters are required.' }) };
    }

    const normalizedEmail = providerEmail.trim().toLowerCase();
    const result = await queryDatabase(SPONSORS_DB_ID, {
      property: 'Email',
      rich_text: { equals: normalizedEmail }
    });
    const page = (result.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    if (!page) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No sponsor found with that email. Check the Email field in the Sponsors database first.' }) };
    }

    await updatePage(page.id, {
      'Password Hash': { rich_text: [{ text: { content: hashPassword(newPassword) } }] },
      'Provider App Enabled': { checkbox: true }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
