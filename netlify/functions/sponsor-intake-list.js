const { requireIntakeAdmin, listIntakes, itemsForIntake, pipelineSummary, json, errorResponse } = require('./lib/sponsor-intake');

// Pipeline view for the admin dashboard's Sponsor Intake tab: every
// active intake with its current stage and what it's waiting on.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireIntakeAdmin(event);
    const intakes = await listIntakes();
    const rows = await Promise.all(intakes.map(async function (intake) {
      const items = await itemsForIntake(intake.id);
      return pipelineSummary(intake, items);
    }));
    rows.sort(function (a, b) { return (b.startedDate || '').localeCompare(a.startedDate || ''); });
    return json(200, { intakes: rows });
  } catch (err) {
    return errorResponse(err);
  }
};
