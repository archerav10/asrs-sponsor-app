const { updatePage } = require('./lib/notion');
const { requireIntakeAdmin, listIntakes, getIntake, itemsForIntake, normalizeId } = require('./lib/sponsor-intake');
const { loadRequirements, staffInfoById, copyFromIntake } = require('./lib/staff-training');

// Links a sponsor's training record (ASRS People) to the Sponsor Intake
// they went through, and brings in every item the intake already
// completed (see copyFromIntake in lib/staff-training.js).
//   GET  ?staffId=…            → the intakes to choose from + the current link
//   POST { staffId, intakeId } → saves the link (Sponsor Intake ID) and copies
// Same gate as the Sponsor Intake tab, since intakes hold background
// check results.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireIntakeAdmin(event);
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : (event.queryStringParameters || {});
    if (!body.staffId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId is required.' }) };
    }

    const staff = await staffInfoById(body.staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    if (event.httpMethod === 'GET') {
      const intakes = (await listIntakes({ all: true })).map(function (i) {
        return { id: i.id, name: i.name, active: i.active, startedDate: i.startedDate };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return { statusCode: 200, body: JSON.stringify({ linkedIntakeId: staff.intakeId ? normalizeId(staff.intakeId) : '', intakes: intakes }) };
    }

    if (!body.intakeId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'intakeId is required.' }) };
    }
    const intake = await getIntake(body.intakeId);
    if (normalizeId(staff.intakeId) !== normalizeId(intake.id)) {
      await updatePage(staff.id, { 'Sponsor Intake ID': { rich_text: [{ text: { content: normalizeId(intake.id) } }] } });
    }

    const requirements = (await loadRequirements({ fresh: true })).requirements;
    const result = await copyFromIntake(staff.location, staff, requirements, await itemsForIntake(intake.id), session.name || session.email);

    return { statusCode: 200, body: JSON.stringify(Object.assign({ intakeName: intake.name }, result)) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
