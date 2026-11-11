const { updatePage } = require('./lib/notion');
const { requireIntakeAdmin, PROCESSES, listIntakes, getIntake, itemsForIntake, normalizeId, loadChecklist, smsConsentStep, STATUS, todayIso } = require('./lib/sponsor-intake');
const { normalizePhone } = require('./lib/twilio');
const { loadRequirements, staffInfoById, intakeProcessForRole, copyFromIntake } = require('./lib/staff-training');

// Links a staff member's training record (ASRS People) to the intake they
// went through — the Sponsor intake for a Sponsor, the DSP intake for a
// DSP or Secondary DSP — and brings in every item the intake already
// completed (see copyFromIntake in lib/staff-training.js).
//   GET  ?staffId=…            → that process's intakes to choose from + the current link
//   POST { staffId, intakeId } → saves the link (Intake ID) and copies
// Same gate as the Intake tab, since intakes hold background check results.
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
    const processName = intakeProcessForRole(staff.role);
    const title = PROCESSES[processName].title;

    if (event.httpMethod === 'GET') {
      const intakes = (await listIntakes({ all: true })).filter(function (i) {
        return i.process === processName;
      }).map(function (i) {
        return { id: i.id, name: i.name, active: i.active, startedDate: i.startedDate };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return {
        statusCode: 200,
        body: JSON.stringify({ title: title, linkedIntakeId: staff.intakeId ? normalizeId(staff.intakeId) : '', intakes: intakes })
      };
    }

    if (!body.intakeId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'intakeId is required.' }) };
    }
    const intake = await getIntake(body.intakeId);
    if (intake.process !== processName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That is a ' + PROCESSES[intake.process].title + ', but ' + staff.name + ' is a ' + staff.role + ' (' + title + ').' }) };
    }
    if (normalizeId(staff.intakeId) !== normalizeId(intake.id)) {
      await updatePage(staff.id, { 'Intake ID': { rich_text: [{ text: { content: normalizeId(intake.id) } }] } });
    }

    const requirements = (await loadRequirements({ fresh: true })).requirements;
    const intakeItems = await itemsForIntake(intake.id);
    const result = await copyFromIntake(staff.location, staff, requirements, intakeItems, session.name || session.email, processName);
    result.smsConsent = await copySmsConsent(staff, intake, intakeItems);

    return { statusCode: 200, body: JSON.stringify(Object.assign({ intakeName: intake.name, title: title }, result)) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};

// The intake's Text Message Consent step, carried over to the person's
// ASRS People row: replied START -> Opted In (dated the reply); replied
// STOP -> Opted Out. Someone who has opted out since is never switched
// back on. Their intake phone fills in a missing Phone Number. Returns a
// short description for the screen, or ''.
async function copySmsConsent(staff, intake, intakeItems) {
  const step = smsConsentStep(await loadChecklist({ process: intake.process }));
  const item = step ? intakeItems[step.key] : null;
  const props = {};
  let said = '';
  if (item && item.status === STATUS.COMPLETE && staff.smsConsent !== 'Opted Out' && staff.smsConsent !== 'Opted In') {
    props['SMS Consent Status'] = { select: { name: 'Opted In' } };
    props['SMS Consent Date'] = { date: { start: (item.completedDate || todayIso()).slice(0, 10) } };
    said = 'Texts: Opted In (replied START ' + (item.completedDate || '').slice(0, 10) + ').';
  } else if (item && item.status === STATUS.RETURNED && staff.smsConsent !== 'Opted Out' && staff.smsConsent !== 'Opted In') {
    props['SMS Consent Status'] = { select: { name: 'Opted Out' } };
    props['SMS Consent Date'] = { date: { start: todayIso() } };
    said = 'Texts: Opted Out (replied STOP).';
  }
  const phone = normalizePhone(intake.phone);
  if (phone && !normalizePhone(staff.phone)) {
    props['Phone Number'] = { phone_number: phone };
    said += (said ? ' ' : '') + 'Phone number copied from the intake.';
  }
  if (Object.keys(props).length) await updatePage(staff.id, props);
  return said;
}
