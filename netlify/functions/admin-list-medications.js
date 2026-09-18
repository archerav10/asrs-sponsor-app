const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const MAR_DB_ID = process.env.MAR_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const params = event.queryStringParameters || {};
    const location = params.location;
    const resident = params.resident;
    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location and resident are required.' }) };
    }

    const result = await queryDatabase(MAR_DB_ID, {
      and: [
        { property: 'Location', select: { equals: location } },
        { property: 'Resident Initials', rich_text: { equals: resident } },
        { property: 'Medication Type', select: { does_not_equal: 'Info' } }
      ]
    });

    const medications = (result.results || []).map(function (page) {
      return {
        id: page.id,
        itemName: getPlainText(page.properties['Item Name']),
        dosage: getPlainText(page.properties['Dosage']),
        frequency: getPlainText(page.properties['Frequency']),
        purpose: getPlainText(page.properties['Purpose']),
        medicationType: getPlainText(page.properties['Medication Type']),
        active: getPlainText(page.properties['Active'])
      };
    }).sort(function (a, b) { return a.itemName.localeCompare(b.itemName); });

    return { statusCode: 200, body: JSON.stringify({ medications: medications }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
