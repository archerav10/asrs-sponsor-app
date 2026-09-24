const {
  requireIntakeAdmin, getIntake, itemsForIntake, fullItemList, stageSummary, STAGES,
  statusPageUrl, json, errorResponse
} = require('./lib/sponsor-intake');

// Everything the admin page for one sponsor needs: the full checklist
// with each item's state, stage progress, and the sponsor's status link.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireIntakeAdmin(event);
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'id is required.' });

    const intake = await getIntake(id);
    const items = await itemsForIntake(intake.id);
    const rootFolderId = process.env.SPONSOR_INTAKE_ROOT_FOLDER_ID || '';

    return json(200, {
      intake: {
        id: intake.id,
        name: intake.name,
        email: intake.email,
        phone: intake.phone,
        startedDate: intake.startedDate,
        lastRequestSent: intake.lastRequestSent,
        statusUrl: statusPageUrl(intake),
        driveUrl: rootFolderId ? 'https://drive.google.com/drive/folders/' + rootFolderId : ''
      },
      stages: STAGES.map(function (s) { return { num: s.num, name: s.name }; }),
      progress: stageSummary(items),
      items: fullItemList(items)
    });
  } catch (err) {
    return errorResponse(err);
  }
};
