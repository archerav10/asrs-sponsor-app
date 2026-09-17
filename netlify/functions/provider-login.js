const crypto = require('crypto');
const { queryDatabase, getPlainText } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { encryptToken } = require('./lib/crypto');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID; // 39fff13f-62f9-80f0-9134-000bddf16417

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function maskPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return '(***) ***-' + digits.slice(-4);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Same generic message for every failure mode below — never reveal
  // whether the email or the password was the problem.
  const genericError = { statusCode: 401, body: JSON.stringify({ error: 'Invalid email or password.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = body.email;
    const password = body.password;

    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email and password are required.' }) };
    }

    const normalizedEmail = email.trim().toLowerCase();

    const result = await queryDatabase(SPONSORS_DB_ID, {
      property: 'Email',
      rich_text: { equals: normalizedEmail }
    });

    const page = (result.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    if (!page) return genericError;

    const enabled = getPlainText(page.properties['Provider App Enabled']);
    const storedHash = getPlainText(page.properties['Password Hash']);
    if (!enabled || !storedHash) return genericError;

    if (hashPassword(password) !== storedHash) return genericError;

    const phone = getPlainText(page.properties['Phone Number']);
    if (!phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No phone number on file for this account. Contact your administrator.' }) };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await sendSms(phone, 'Your ASRS Provider App verification code is: ' + otp);

    // The OTP itself never touches any database — it lives only inside this
    // short-lived encrypted token, which the browser holds and returns on
    // the next step.
    const otpToken = encryptToken({ email: normalizedEmail, otp: otp }, 5 * 60);

    return {
      statusCode: 200,
      body: JSON.stringify({ otpToken: otpToken, maskedPhone: maskPhone(phone) })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
