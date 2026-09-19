const crypto = require('crypto');
const { queryDatabase, getPlainText } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { encryptToken } = require('./lib/crypto');

const LOCATION_CODES_DB_ID = process.env.LOCATION_CODES_DB_ID;
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function maskPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return '(***) ***-' + digits.slice(-4);
}

// Admin Dashboard login — same email + one-of-your-granted-locations'
// password + SMS OTP pattern as provider-login.js's admin path (so an
// admin proves they hold real location access, same bar as everywhere
// else in this app). The difference is what the resulting session
// carries: provider-login.js locks the session to the ONE matched
// location; this issues a session scoped to the admin's FULL granted
// location list, since the dashboard is a cross-location oversight view,
// not a per-location working screen. See admin-dashboard-verify-otp.js.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const genericError = { statusCode: 401, body: JSON.stringify({ error: 'Invalid email or password.' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = body.email;
    const password = body.password;

    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email and password are required.' }) };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const submittedHash = hashPassword(password);

    const adminResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
      property: 'Email',
      rich_text: { equals: normalizedEmail }
    });
    const adminPage = (adminResult.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    if (!adminPage || !getPlainText(adminPage.properties['Admin App Enabled'])) {
      return genericError;
    }

    const grantedLocations = (getPlainText(adminPage.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const codesResult = await queryDatabase(LOCATION_CODES_DB_ID, {
      property: 'Active', checkbox: { equals: true }
    });
    const matchedLocation = (codesResult.results || []).find(function (p) {
      const loc = getPlainText(p.properties['Location']);
      const hash = getPlainText(p.properties['Password Hash']);
      return hash && hash === submittedHash && grantedLocations.indexOf(loc) !== -1;
    });

    if (!matchedLocation) {
      return genericError;
    }

    const phone = getPlainText(adminPage.properties['Phone Number']);
    if (!phone) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No phone number on file for this account. Contact your administrator.' }) };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await sendSms(phone, 'Your ASRS Admin Dashboard verification code is: ' + otp);
    const otpToken = encryptToken({ email: normalizedEmail, otp: otp }, 5 * 60);

    return { statusCode: 200, body: JSON.stringify({ otpToken: otpToken, maskedPhone: maskPhone(phone) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
