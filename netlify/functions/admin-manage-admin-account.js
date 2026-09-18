const { queryDatabase, updatePage, createPage, getPlainText } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const body = JSON.parse(event.body || '{}');
    const name = body.name;
    const newAdminEmail = body.newAdminEmail;
    const phoneNumber = body.phoneNumber;
    const grantedLocations = body.grantedLocations || []; // full replacement list

    if (!name || !newAdminEmail || !phoneNumber) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name, email, and phone number are required.' }) };
    }

    // Twilio requires E.164 (+1XXXXXXXXXX) — a bare 10-digit number
    // saves fine to Notion but silently fails to send SMS, which is a
    // much harder bug to catch than rejecting it here.
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    let normalizedPhone = phoneNumber.trim();
    if (!normalizedPhone.startsWith('+')) {
      if (digitsOnly.length === 10) {
        normalizedPhone = '+1' + digitsOnly;
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        normalizedPhone = '+' + digitsOnly;
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'Phone number should be a 10-digit US number or already in +1XXXXXXXXXX format.' }) };
      }
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
      'Phone Number': { phone_number: normalizedPhone },
      'Granted Locations': { rich_text: [{ text: { content: locationsText } }] },
      'Admin App Enabled': { checkbox: grantedLocations.length > 0 }
    };

    if (existing) {
      await updatePage(existing.id, properties);
    } else {
      await createPage(ADMIN_ACCOUNTS_DB_ID, properties);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, updated: !!existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
