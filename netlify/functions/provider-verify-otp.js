const { queryDatabase, getPlainText } = require('./lib/notion');
const { decryptToken, encryptToken } = require('./lib/crypto');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

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

    const result = await queryDatabase(SPONSORS_DB_ID, {
      property: 'Email',
      rich_text: { equals: payload.email }
    });
    const page = (result.results || [])[0];
    if (!page) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Account not found.' }) };
    }

    const session = {
      email: payload.email,
      name: getPlainText(page.properties['Name']),
      location: getPlainText(page.properties['Location']),
      residentInitials: getPlainText(page.properties['Resident Initials'])
    };

    const sessionToken = encryptToken(session, SESSION_TTL_SECONDS);

    return { statusCode: 200, body: JSON.stringify({ sessionToken: sessionToken, session: session }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
