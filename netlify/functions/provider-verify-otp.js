const { queryDatabase, getPlainText } = require('./lib/notion');
const { decryptToken, encryptToken } = require('./lib/crypto');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const MAR_DB_ID = process.env.MAR_DB_ID;
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

// For an admin session, there's no personal "Resident Initials" field the
// way a sponsor has — so resolve which residents exist at that location by
// looking at the MAR Review data itself (the only place per-location
// resident identity currently lives).
async function residentsAtLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const set = new Set();
  (result.results || []).forEach(function (page) {
    const type = getPlainText(page.properties['Medication Type']);
    if (type === 'Info') return;
    const initials = getPlainText(page.properties['Resident Initials']);
    if (initials) set.add(initials);
  });
  return Array.from(set).join(', ');
}

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

    let session;

    if (payload.accountType === 'admin') {
      const adminResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
        property: 'Email',
        rich_text: { equals: payload.email }
      });
      const adminPage = (adminResult.results || [])[0];
      if (!adminPage) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Account not found.' }) };
      }
      session = {
        email: payload.email,
        name: getPlainText(adminPage.properties['Name']),
        location: payload.resolvedLocation,
        residentInitials: await residentsAtLocation(payload.resolvedLocation),
        accountType: 'admin'
      };
    } else {
      const result = await queryDatabase(SPONSORS_DB_ID, {
        property: 'Email',
        rich_text: { equals: payload.email }
      });
      const page = (result.results || [])[0];
      if (!page) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Account not found.' }) };
      }
      session = {
        email: payload.email,
        name: getPlainText(page.properties['Name']),
        location: getPlainText(page.properties['Location']),
        residentInitials: getPlainText(page.properties['Resident Initials']),
        accountType: 'sponsor'
      };
    }

    const sessionToken = encryptToken(session, SESSION_TTL_SECONDS);

    return { statusCode: 200, body: JSON.stringify({ sessionToken: sessionToken, session: session }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
