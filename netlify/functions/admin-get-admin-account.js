const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const email = (event.queryStringParameters && event.queryStringParameters.email || '').trim().toLowerCase();
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email.' }) };
    }

    const result = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
      property: 'Email', rich_text: { equals: email }
    });
    const page = (result.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === email;
    });

    if (!page) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }

    const grantedLocations = (getPlainText(page.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        name: getPlainText(page.properties['Name']),
        email: getPlainText(page.properties['Email']),
        phoneNumber: getPlainText(page.properties['Phone Number']),
        grantedLocations: grantedLocations,
        enabled: getPlainText(page.properties['Admin App Enabled'])
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
