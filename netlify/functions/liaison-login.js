const crypto = require('crypto');
const { queryDatabase, getPlainText } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { encryptToken } = require('./lib/crypto');
const { id: configId } = require('./lib/ids');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

// Liaison app login, step 1: the liaison's email plus the password of any
// location they're granted (same passwords as the admin dashboard). The
// account must have "Liaison App Enabled". Texts a 6-digit code.
function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }
function maskPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length < 4 ? '****' : '(***) ***-' + digits.slice(-4);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const genericError = { statusCode: 401, body: JSON.stringify({ error: 'Invalid email or password.' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.email || !body.password) return { statusCode: 400, body: JSON.stringify({ error: 'Email and password are required.' }) };
    const email = body.email.trim().toLowerCase();
    const hash = hashPassword(body.password);

    const adminResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, { property: 'Email', rich_text: { equals: email } });
    const admin = (adminResult.results || []).find(function (p) { return getPlainText(p.properties['Email']).trim().toLowerCase() === email; });
    if (!admin) { console.log('liaison-login: no admin account for', email); return genericError; }

    const granted = require('./lib/access').liaisonLocationsOf(admin);
    const codes = await queryDatabase(configId('LOCATION_CODES_DB_ID'), { property: 'Active', checkbox: { equals: true } });
    const match = (codes.results || []).find(function (p) {
      const h = getPlainText(p.properties['Password Hash']);
      return h && h === hash;
    });
    if (!match) { console.log('liaison-login: password matched no home'); return genericError; }
    // Only said once the password is right, so it reveals nothing to a guesser.
    const home = getPlainText(match.properties['Location']);
    if (granted.indexOf(home) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: granted.length ? 'You don\u2019t have Liaison access to ' + home + '. Use the password of one of your homes (' + granted.join(', ') + '), or ask the super admin.' : 'This account isn\u2019t set up for the Liaison app. Ask the super admin to give you Liaison access to a home.' }) };
    }

    const phone = getPlainText(admin.properties['Phone Number']);
    if (!phone) return { statusCode: 400, body: JSON.stringify({ error: 'No phone number on file for this account. Contact your administrator.' }) };
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await sendSms(phone, 'Your ASRS Liaison App verification code is: ' + otp);
    const otpToken = encryptToken({ email: email, otp: otp, kind: 'liaison', location: getPlainText(match.properties['Location']) }, 5 * 60);
    return { statusCode: 200, body: JSON.stringify({ otpToken: otpToken, maskedPhone: maskPhone(phone) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
