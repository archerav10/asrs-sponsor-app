const { decryptToken, encryptToken } = require('./lib/crypto');

const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours — shorter than the provider session since this gates sensitive tooling

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

    const sessionToken = encryptToken({ email: payload.email, accountType: 'superadmin' }, SESSION_TTL_SECONDS);
    return { statusCode: 200, body: JSON.stringify({ sessionToken: sessionToken, email: payload.email }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
