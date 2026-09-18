const crypto = require('crypto');
const { sendSms } = require('./lib/twilio');
const { encryptToken } = require('./lib/crypto');

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

  const genericError = { statusCode: 401, body: JSON.stringify({ error: 'Invalid email or password.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    const superEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const superHash = process.env.SUPER_ADMIN_PASSWORD_HASH || '';
    const superPhone = process.env.SUPER_ADMIN_PHONE || '';

    if (!email || !password || email !== superEmail || hashPassword(password) !== superHash) {
      return genericError;
    }
    if (!superPhone) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No phone number configured for the admin tools account.' }) };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await sendSms(superPhone, 'Your ASRS Admin Tools verification code is: ' + otp);
    const otpToken = encryptToken({ email: email, otp: otp, accountType: 'superadmin' }, 5 * 60);

    return { statusCode: 200, body: JSON.stringify({ otpToken: otpToken, maskedPhone: maskPhone(superPhone) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
