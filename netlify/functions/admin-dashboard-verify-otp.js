const { queryDatabase, getPlainText } = require('./lib/notion');
const { decryptToken, encryptToken } = require('./lib/crypto');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours, same as the provider app

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const otpToken = body.otpToken;
    const code = body.code;

    if (!otpToken || !code) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing code.' }) };
    }

    let payload;
    try {
      payload = decryptToken(otpToken);
    } catch (e) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Code expired. Please log in again.' }) };
    }

    if (payload.otp !== code.trim()) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect code.' }) };
    }

    const adminResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
      property: 'Email',
      rich_text: { equals: payload.email }
    });
    const adminPage = (adminResult.results || [])[0];
    if (!adminPage) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Account not found.' }) };
    }

    const grantedLocations = (getPlainText(adminPage.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const session = {
      email: payload.email,
      name: getPlainText(adminPage.properties['Name']),
      grantedLocations: grantedLocations,
      accountType: 'admin-dashboard'
    };

    const sessionToken = encryptToken(session, SESSION_TTL_SECONDS);

    return { statusCode: 200, body: JSON.stringify({ sessionToken: sessionToken, session: session }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
