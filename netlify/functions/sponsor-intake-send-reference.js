const {
  requireIntakeAdmin, loadChecklist, getIntake, itemsForIntake, upsertItem, adminFormLink, isDone,
  todayIso, richText, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');
const { referenceEmail, sendTo } = require('./lib/sponsor-intake-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin-only: emails the reference form for an ASRS Document step (2.2a–c)
// straight to a reference the sponsor named. The link carries the
// tracking field, so the submitted PDF files itself and completes the
// step. Sending again (a resend, or a different person) just overwrites
// Sent To and the Requested Date.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireIntakeAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const note = String(body.note || '').trim();
    const step = (await loadChecklist({ fresh: true })).byKey[body.stepKey];
    if (!body.id || !step) return json(400, { error: 'id and a valid stepKey are required.' });
    if (!name) return json(400, { error: 'Enter the reference\'s name.' });
    if (!EMAIL_RE.test(email)) return json(400, { error: 'Enter a valid email address for the reference.' });

    const intake = await getIntake(body.id);
    const formUrl = adminFormLink(intake, step);
    if (!formUrl) return json(400, { error: 'This step has no Form Link in Notion, so there\'s no form to send.' });
    const item = (await itemsForIntake(intake.id))[step.key] || null;
    if (isDone(item)) return json(400, { error: 'This step is already done. Reopen it first to send again.' });

    await sendTo(email, name, referenceEmail(intake, name, formUrl, note));

    await upsertItem(intake, step, {
      'Requested Date': dateProp(todayIso()),
      'Sent To': richText(name + ' <' + email + '>'),
      'Last Updated By': richText(session.name || session.email)
    }, item);

    return json(200, { success: true });
  } catch (err) {
    return errorResponse(err);
  }
};
