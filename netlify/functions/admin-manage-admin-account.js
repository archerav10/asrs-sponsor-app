const { queryDatabase, updatePage, createPage, getPlainText } = require('./lib/notion');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

function isAdmin(email) {
  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map(function (e) {
    return e.trim().toLowerCase();
  });
  return allowed.indexOf((email || '').trim().toLowerCase()) !== -1;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const adminEmail = body.adminEmail;
    const name = body.name;
    const newAdminEmail = body.newAdminEmail;
    const phoneNumber = body.phoneNumber;
    const grantedLocations = body.grantedLocations || []; // array of location names

    if (!isAdmin(adminEmail)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
    }
    if (!name || !newAdminEmail || !phoneNumber || !grantedLocations.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name, email, phone number, and at least one granted location are required.' }) };
    }

    const normalizedEmail = newAdminEmail.trim().toLowerCase();
    const locationsText = grantedLocations.join(', ');

    const result = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, {
      property: 'Email', rich_text: { equals: normalizedEmail }
    });
    const existing = (result.results || []).find(function (p) {
      return getPlainText(p.properties['Email']).trim().toLowerCase() === normalizedEmail;
    });

    const properties = {
      'Name': { title: [{ text: { content: name } }] },
      'Email': { rich_text: [{ text: { content: normalizedEmail } }] },
      'Phone Number': { phone_number: phoneNumber },
      'Granted Locations': { rich_text: [{ text: { content: locationsText } }] },
      'Admin App Enabled': { checkbox: true }
    };

    if (existing) {
      await updatePage(existing.id, properties);
    } else {
      await createPage(ADMIN_ACCOUNTS_DB_ID, properties);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, updated: !!existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
