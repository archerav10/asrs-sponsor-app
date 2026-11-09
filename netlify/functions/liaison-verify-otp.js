const { queryDatabase, getPlainText } = require('./lib/notion');
const { decryptToken, encryptToken } = require('./lib/crypto');
const lz = require('./lib/liaison');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

// Liaison app login, step 2: checks the texted code and opens a session
// for the location whose password was used. The session works with every
// sponsor app screen (it's a location session) and carries liaison: true
// and the granted locations for switching homes.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.otpToken || !body.code) return { statusCode: 400, body: JSON.stringify({ error: 'Missing code.' }) };
    let payload;
    try { payload = decryptToken(body.otpToken); } catch (e) { return { statusCode: 401, body: JSON.stringify({ error: 'Code expired. Please log in again.' }) }; }
    if (payload.kind !== 'liaison') return { statusCode: 401, body: JSON.stringify({ error: 'Code expired. Please log in again.' }) };
    if (payload.otp !== String(body.code).trim()) return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect code.' }) };

    const result = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, { property: 'Email', rich_text: { equals: payload.email } });
    const admin = (result.results || [])[0];
    if (!admin || !getPlainText(admin.properties['Liaison App Enabled'])) return { statusCode: 401, body: JSON.stringify({ error: 'Account not found.' }) };
    const granted = (getPlainText(admin.properties['Granted Locations']) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (granted.indexOf(payload.location) === -1) return { statusCode: 401, body: JSON.stringify({ error: 'Not authorized for that location.' }) };

    const session = await lz.sessionForLocation({ email: payload.email, name: getPlainText(admin.properties['Name']), grantedLocations: granted }, payload.location);
    return { statusCode: 200, body: JSON.stringify({ sessionToken: encryptToken(session, SESSION_TTL_SECONDS), session: session }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
