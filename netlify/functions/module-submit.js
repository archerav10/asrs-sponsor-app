const { updatePage } = require('./lib/notion');
const tm = require('./lib/training-modules');
const tp = require('./lib/training-paths');
const send = require('./lib/training-modules-send');
const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');

// Submit from the module page. The page locks steps for the person; this
// is the real check: every video watched (per the saved progress) and
// every answer at least Min Words long. Then the answers go to Module
// Responses, the assignment is Completed, and the certificate is made and
// sent to Drive.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const link = tm.readLinkToken(body.token);
    if (link.expired) throw tm.badRequest('This link has expired. Reload the page to get a new one.', 410);
    const assignment = await tm.getAssignment(link.assignmentId);
    if (link.linkVersion !== assignment.linkVersion || assignment.status === 'Cancelled' || assignment.status === 'Locked') {
      throw tm.badRequest('This link no longer works.', 410);
    }
    if (assignment.status === 'Completed') {
      return json(200, { completed: true, certificateId: assignment.certificateId, completedAt: assignment.completedAt });
    }
    if (body.attest !== true) throw tm.badRequest('Please check the box to confirm these answers are your own.');

    const mod = await tm.loadModule(assignment.moduleId);
    const progress = tm.mergeProgress(mod, assignment.progress, body.progress || {}, Date.now());
    const missing = tm.missingForSubmit(mod, progress);
    if (missing.length) {
      await updatePage(assignment.id, { 'Progress': tm.richText(JSON.stringify(progress)) });
      return json(422, { error: 'A few things are still missing.', missing: missing });
    }

    const completedAt = new Date().toISOString();
    await tm.writeResponses(assignment, mod, progress);
    await updatePage(assignment.id, {
      'Progress': tm.richText(JSON.stringify(progress)),
      'Status': { select: { name: 'Completed' } },
      'Completed At': { date: { start: completedAt } }
    });

    const site = tm.siteFromEvent(event);
    const cert = await tm.issueCertificate(Object.assign({}, assignment, { completedAt: completedAt, status: 'Completed' }), mod, site);

    // In a training path: unlock and announce the next step, or finish the path.
    let path = {};
    try {
      path = await tp.afterStepCompleted(Object.assign({}, assignment, { status: 'Completed' }), { notifyNextStep: send.notifyNextStep({ sendSms: sendSms, sendEmail: sendEmail }) }, site);
    } catch (e) {
      console.error('Path step after submit failed for ' + assignment.id, e);
    }

    return json(200, {
      completed: true,
      completedAt: completedAt,
      certificateId: cert.certificateId,
      next: path.next || null,
      pathCompleted: !!path.pathCompleted,
      pathTitle: path.pathTitle || '',
      personName: assignment.personName,
      location: assignment.location,
      role: assignment.role
    });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Something went wrong. Your answers are saved; please try Submit again.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
