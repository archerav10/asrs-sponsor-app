const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const LOCATION_CODES_DB_ID = process.env.LOCATION_CODES_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const adminsResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, null);
    const admins = (adminsResult.results || []).map(function (page) {
      return {
        name: getPlainText(page.properties['Name']),
        email: getPlainText(page.properties['Email']),
        phoneNumber: getPlainText(page.properties['Phone Number']),
        grantedLocations: (getPlainText(page.properties['Granted Locations']) || '')
          .split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        enabled: getPlainText(page.properties['Admin App Enabled'])
      };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    const locationsResult = await queryDatabase(LOCATION_CODES_DB_ID, null);
    const locations = (locationsResult.results || []).map(function (page) {
      return {
        location: getPlainText(page.properties['Location']),
        hasPasswordSet: !!getPlainText(page.properties['Password Hash']),
        active: getPlainText(page.properties['Active'])
      };
    }).sort(function (a, b) { return a.location.localeCompare(b.location); });

    return { statusCode: 200, body: JSON.stringify({ admins: admins, locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
