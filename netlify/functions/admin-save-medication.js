const { updatePage, createPage } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');

const MAR_DB_ID = process.env.MAR_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const body = JSON.parse(event.body || '{}');
    const id = body.id; // present -> update, absent -> create
    const location = body.location;
    const resident = body.resident;
    const itemName = body.itemName;
    const dosage = body.dosage || '';
    const frequency = body.frequency || '';
    const purpose = body.purpose || '';
    const medicationType = body.medicationType;
    const active = body.active !== false;

    if (!location || !resident || !itemName || !medicationType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, item name, and medication type are required.' }) };
    }

    const properties = {
      'Item Name': { title: [{ text: { content: itemName } }] },
      'Location': { select: { name: location } },
      'Resident Initials': { rich_text: [{ text: { content: resident } }] },
      'Dosage': { rich_text: [{ text: { content: dosage } }] },
      'Frequency': { rich_text: [{ text: { content: frequency } }] },
      'Purpose': { rich_text: [{ text: { content: purpose } }] },
      'Medication Type': { select: { name: medicationType } },
      'Active': { checkbox: active }
    };

    if (id) {
      await updatePage(id, properties);
    } else {
      await createPage(MAR_DB_ID, properties);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, updated: !!id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
