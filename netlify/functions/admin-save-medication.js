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
    // Only meaningful for Regular medications (PRN/Info have no fixed
    // schedule) but harmless to store either way — the admin UI just
    // doesn't show the checkboxes for those types.
    const timesOfDay = Array.isArray(body.timesOfDay) ? body.timesOfDay.filter(function (t) { return ['AM', 'Noon', 'Afternoon', 'PM'].indexOf(t) !== -1; }) : [];
    // Both optional — blank Effective Date means "has always applied"
    // (no backfill needed for rows entered before this field existed);
    // blank Termination Date means "still applies." Setting Termination
    // Date is how a medication change mid-month is recorded: stop the
    // old row here, give the replacement row an Effective Date of the
    // same day (see README's Give Medications section).
    const effectiveDate = typeof body.effectiveDate === 'string' ? body.effectiveDate.trim() : '';
    const terminationDate = typeof body.terminationDate === 'string' ? body.terminationDate.trim() : '';

    if (!location || !resident || !itemName || !medicationType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, item name, and medication type are required.' }) };
    }
    if (effectiveDate && terminationDate && terminationDate <= effectiveDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'The termination date must be after the effective date.' }) };
    }

    const properties = {
      'Item Name': { title: [{ text: { content: itemName } }] },
      'Location': { select: { name: location } },
      'Resident Initials': { rich_text: [{ text: { content: resident } }] },
      'Dosage': { rich_text: [{ text: { content: dosage } }] },
      'Frequency': { rich_text: [{ text: { content: frequency } }] },
      'Purpose': { rich_text: [{ text: { content: purpose } }] },
      'Medication Type': { select: { name: medicationType } },
      'Active': { checkbox: active },
      'Times of Day': { multi_select: timesOfDay.map(function (t) { return { name: t }; }) },
      'Effective Date': effectiveDate ? { date: { start: effectiveDate } } : { date: null },
      'Termination Date': terminationDate ? { date: { start: terminationDate } } : { date: null }
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
