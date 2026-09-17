const crypto = require('crypto');
const { queryDatabase, getPlainText } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { encryptToken } = require('./lib/crypto');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
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

async function sendOtpAndRespond(phone, tokenPayload) {
  if (!phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No phone number on file for this account. Contact your administrator.' }) };
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await sendSms(phone, 'Your ASRS Provider App verification code is: ' + otp);
  const otpToken = encryptToken(Object.assign({}, tokenPayload, { otp: otp }), 5 * 60);
  return { statusCode: 200, body: JSON.stringify({ otpToken: otpToken, maskedPhone: maskPhone(phone) }) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Same generic message for every failure mode below — never reveal
  // whether the email exists, which path (sponsor vs admin) was tried,
  // or which one was closer to matching.
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

    // --- Path 1: sponsor/provider personal password ---
    const sponsorResult = await queryDatabase(SPONSORS_DB_ID, {
      property: 'Email',
      rich_text: { equals: normalizedEmail }
    });
    const sponsorPage = (sponsorResult.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    if (sponsorPage) {
      const enabled = getPlainText(sponsorPage.properties['Provider App Enabled']);
      const storedHash = getPlainText(sponsorPage.properties['Password Hash']);
      if (enabled && storedHash && submittedHash === storedHash) {
        const phone = getPlainText(sponsorPage.properties['Phone Number']);
        return sendOtpAndRespond(phone, { email: normalizedEmail, accountType: 'sponsor' });
      }
    }

    // --- Path 2: admin + location password ---
    const adminResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
      property: 'Email',
      rich_text: { equals: normalizedEmail }
    });
    const adminPage = (adminResult.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    if (adminPage && getPlainText(adminPage.properties['Admin App Enabled'])) {
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

      if (matchedLocation) {
        const phone = getPlainText(adminPage.properties['Phone Number']);
        const resolvedLocation = getPlainText(matchedLocation.properties['Location']);
        return sendOtpAndRespond(phone, { email: normalizedEmail, accountType: 'admin', resolvedLocation: resolvedLocation });
      }
    }

    return genericError;
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
