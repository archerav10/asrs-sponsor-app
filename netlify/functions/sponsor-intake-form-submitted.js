const {
  loadChecklist, stepOrPlaceholder, getIntake, itemsForIntake, upsertItem, STATUS, parseFormFilename,
  todayIso, uploadFilename, richText, statusProp, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');
const { notifyAdmins } = require('./lib/sponsor-intake-email');

// Zapier-facing: the last step of the JotForm Zap, after the submission
// PDF has been moved into the sponsor's stage folder. Marks the item
// Received (the form-path twin of sponsor-intake-upload-complete).
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

    const parsed = parseFormFilename(body.filename);
    if (!parsed) return json(400, { error: 'Could not find an intake/step in that filename.' });

    const step = stepOrPlaceholder(await loadChecklist(), parsed.stepKey);
    const intake = await getIntake(parsed.intakeId);
    const item = (await itemsForIntake(intake.id))[step.key] || null;

    const props = {
      'Filename': richText(uploadFilename(intake, step, 1, 1, 'pdf')),
      'Received Date': dateProp(todayIso()),
      'Last Updated By': richText('JotForm submission')
    };
    if (!item || item.status !== STATUS.COMPLETE) {
      props['Status'] = statusProp(STATUS.RECEIVED);
      props['Return Reason'] = richText('');
    }

    await upsertItem(intake, step, props, item);
    await notifyAdmins(intake, step);

    return json(200, { success: true });
  } catch (err) {
    return errorResponse(err);
  }
};
