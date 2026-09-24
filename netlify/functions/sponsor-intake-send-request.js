const {
  requireIntakeAdmin, loadChecklist, getIntake, itemsForIntake, upsertItem, STATUS,
  isSponsorStep, todayIso, richText, statusProp, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');
const { updatePage } = require('./lib/notion');
const { requestEmail, welcomeEmail, sendToSponsor } = require('./lib/sponsor-intake-email');

// The admin's "Send request" button — the only way a sponsor ever gets
// emailed (nothing here is automatic). Emails one message listing every
// selected item with its own button, then marks them Requested. Items
// already Requested can be re-sent as a reminder; Returned items stay
// Returned (so the status page keeps showing the reason) but get a fresh
// Requested Date. With no items selected, sends the status-link email.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireIntakeAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const stepKeys = Array.isArray(body.stepKeys) ? body.stepKeys : [];
    const note = (body.note || '').trim();
    if (!body.id) return json(400, { error: 'id is required.' });

    const cl = await loadChecklist({ fresh: true });
    const intake = await getIntake(body.id);
    if (!intake.email) return json(400, { error: 'This sponsor has no email address on file.' });

    if (!stepKeys.length) {
      await sendToSponsor(intake, welcomeEmail(intake, note));
      return json(200, { success: true, sent: 0 });
    }

    const items = await itemsForIntake(intake.id);
    const selected = [];
    for (let i = 0; i < stepKeys.length; i++) {
      const step = cl.byKey[stepKeys[i]];
      if (!step || !isSponsorStep(step)) return json(400, { error: 'Only sponsor items can be requested.' });
      const item = items[step.key];
      const status = item ? item.status : '';
      if (status === STATUS.RECEIVED || status === STATUS.COMPLETE) {
        return json(400, { error: step.key + ' ' + step.label + ' was already received — accept or return it instead.' });
      }
      selected.push({ step: step, stepKey: step.key, item: item || null, returnReason: status === STATUS.RETURNED ? item.returnReason : '' });
    }

    const order = cl.steps.map(function (s) { return s.key; });
    selected.sort(function (a, b) { return order.indexOf(a.stepKey) - order.indexOf(b.stepKey); });

    await sendToSponsor(intake, requestEmail(cl, intake, selected, note));

    const today = todayIso();
    const by = richText(session.name || session.email);
    await Promise.all(selected.map(function (s) {
      const props = { 'Requested Date': dateProp(today), 'Last Updated By': by };
      if (!s.item || s.item.status !== STATUS.RETURNED) props['Status'] = statusProp(STATUS.REQUESTED);
      return upsertItem(intake, s.step, props, s.item);
    }));
    await updatePage(intake.id, { 'Last Request Sent': dateProp(today) });

    return json(200, { success: true, sent: selected.length });
  } catch (err) {
    return errorResponse(err);
  }
};
