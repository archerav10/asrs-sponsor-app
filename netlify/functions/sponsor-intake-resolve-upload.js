const { decryptToken } = require('./lib/crypto');
const {
  loadChecklist, stepOrPlaceholder, getIntake, stageFolderName, sponsorFolderName, uploadFilename, parseFormFilename,
  json, errorResponse
} = require('./lib/sponsor-intake');

// Zapier-facing: tells the intake Zaps where a file goes. Two callers:
//
//   Direct upload Zap — { secret, ticket, part, total, ext } from the
//   Catch Hook; the ticket comes from sponsor-intake-upload-ticket.
//
//   JotForm Zap — { secret, filename }: a form's native Google Drive
//   integration drops the submission PDF into a staging folder named
//   after its prefilled app_filename, and the Zap passes that name here.
//
// Either way it returns the root folder ID plus the sponsor and stage
// folder names for two Find/Create Folder steps, and the file's final name.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.ANNUAL_PLANNING_FORM_WEBHOOK_SECRET; // shared across admin-dashboard Zapier-facing endpoints
    if (!secret || body.secret !== secret) {
      return json(403, { error: 'Missing or incorrect secret.' });
    }
    const rootFolderId = process.env.SPONSOR_INTAKE_ROOT_FOLDER_ID;
    if (!rootFolderId) return json(500, { error: 'SPONSOR_INTAKE_ROOT_FOLDER_ID is not set.' });

    let intakeId;
    let stepKey;
    let part = 1;
    let total = 1;
    let ext = '';

    if (body.ticket) {
      let ticket;
      try {
        ticket = decryptToken(body.ticket);
      } catch (e) {
        return json(401, { error: 'Upload ticket expired or invalid.' });
      }
      if (ticket.kind !== 'intake-upload') return json(401, { error: 'Invalid upload ticket.' });
      intakeId = ticket.intakeId;
      stepKey = ticket.stepKey;
      total = Math.max(1, Math.min(20, parseInt(body.total, 10) || 1));
      part = Math.max(1, Math.min(total, parseInt(body.part, 10) || 1));
      ext = String(body.ext || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toLowerCase();
    } else {
      const parsed = parseFormFilename(body.filename);
      if (!parsed) return json(400, { error: 'Could not find an intake/step in that filename.' });
      intakeId = parsed.intakeId;
      stepKey = parsed.stepKey;
      ext = 'pdf';
    }

    const cl = await loadChecklist();
    const step = stepOrPlaceholder(cl, stepKey);
    const intake = await getIntake(intakeId);

    return json(200, {
      rootFolderId: rootFolderId,
      sponsorFolderName: sponsorFolderName(intake),
      stageFolderName: stageFolderName(cl, step.stage),
      filename: uploadFilename(intake, step, part, total, ext),
      sponsorName: intake.name,
      stepKey: step.key
    });
  } catch (err) {
    return errorResponse(err);
  }
};
