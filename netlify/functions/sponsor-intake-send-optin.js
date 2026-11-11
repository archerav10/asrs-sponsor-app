const {
  requireIntakeAdmin, loadChecklist, getIntake, itemsForIntake, upsertItem, STATUS, OPT_IN_SMS,
  todayIso, richText, statusProp, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');
const { sendSms, normalizePhone } = require('./lib/twilio');

// Send opt-in text: texts the person the intake is for, asking them to
// reply START to receive work-related texts (the second half of the
// double opt-in; their application is the first). Only when an admin
// clicks it. Marks the Text Message Consent step Requested.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireIntakeAdmin(event);
    const body = JSON.parse(event.body || '{}');
    if (!body.id || !body.stepKey) return json(400, { error: 'id and stepKey are required.' });
    const intake = await getIntake(body.id);
    const step = (await loadChecklist({ fresh: true, process: intake.process })).byKey[body.stepKey];
    if (!step || step.type !== 'sms') return json(400, { error: 'That isn\'t a text message consent step.' });
    const phone = normalizePhone(intake.phone);
    if (!phone) return json(400, { error: 'Add a mobile number to this intake first.' });

    const item = (await itemsForIntake(intake.id))[step.key] || null;
    if (item && item.status === STATUS.COMPLETE) return json(400, { error: 'They already replied START.' });

    await sendSms(phone, OPT_IN_SMS);
    await upsertItem(intake, step, {
      'Status': statusProp(STATUS.REQUESTED),
      'Requested Date': dateProp(todayIso()),
      'Return Reason': richText(''),
      'Sent To': richText(phone),
      'Last Updated By': richText(session.name || session.email)
    }, item);
    return json(200, { sent: true, to: '•••' + phone.slice(-4) });
  } catch (err) {
    return errorResponse(err);
  }
};
