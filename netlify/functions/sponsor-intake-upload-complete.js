const { decryptToken } = require('./lib/crypto');
const {
  loadChecklist, stepOrPlaceholder, getIntake, itemsForIntake, upsertItem, STATUS,
  todayIso, uploadFilename, richText, statusProp, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');
const { notifyAdmins } = require('./lib/sponsor-intake-email');

// Called by the browser once every file for an item has been accepted
// by the Zapier webhook. Authenticated by the same upload ticket, so a
// sponsor's upload page needs no session. A sponsor upload lands as
// Received (admin still reviews it); an admin upload is Complete.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let ticket;
    try {
      ticket = decryptToken(body.ticket || '');
    } catch (e) {
      return json(401, { error: 'This upload session expired. Reload the page and try again.' });
    }
    if (ticket.kind !== 'intake-upload') return json(401, { error: 'Invalid upload session.' });

    const step = stepOrPlaceholder(await loadChecklist(), ticket.stepKey);
    const intake = await getIntake(ticket.intakeId);
    const item = (await itemsForIntake(intake.id))[step.key] || null;
    const total = Math.max(1, Math.min(20, parseInt(body.total, 10) || 1));
    const ext = String(body.ext || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toLowerCase();
    const filename = total === 1
      ? uploadFilename(intake, step, 1, 1, ext)
      : uploadFilename(intake, step, 1, 1, '') + ' (' + total + ' files)';
    const today = todayIso();

    const props = {
      'Filename': richText(filename),
      'Last Updated By': richText(ticket.by)
    };

    if (ticket.role === 'sponsor') {
      if (!item || item.status !== STATUS.COMPLETE) {
        props['Status'] = statusProp(STATUS.RECEIVED);
        props['Return Reason'] = richText('');
      }
      props['Received Date'] = dateProp(today);
    } else {
      props['Status'] = statusProp(STATUS.COMPLETE);
      props['Completed Date'] = dateProp((item && item.completedDate) || today);
    }

    await upsertItem(intake, step, props, item);

    if (ticket.role === 'sponsor') await notifyAdmins(intake, step);

    return json(200, { success: true });
  } catch (err) {
    return errorResponse(err);
  }
};
