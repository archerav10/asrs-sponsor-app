const {
  requireIntakeAdmin, loadChecklist, getIntake, itemsForIntake, fullItemList, stageSummary, adminFormLink,
  statusPageUrl, json, errorResponse, useRequestHost
} = require('./lib/sponsor-intake');

// Everything the admin page for one sponsor needs: the full checklist
// with each item's state, stage progress, and the sponsor's status link.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    useRequestHost(event);
    requireIntakeAdmin(event);
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'id is required.' });

    const cl = await loadChecklist({ fresh: true });
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
      stages: cl.stages.map(function (s) { return { num: s.num, position: s.position, name: s.name }; }),
      progress: stageSummary(cl, items),
      items: fullItemList(cl, items).map(function (item) {
        item.adminFormUrl = adminFormLink(intake, cl.byKey[item.key]);
        return item;
      }),
      checklistProblems: cl.problems
    });
  } catch (err) {
    return errorResponse(err);
  }
};
