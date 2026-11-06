const { requireSession } = require('./lib/session');
const tm = require('./lib/training-modules');

// Admin Dashboard -> Training Modules -> Resend certificate. Rebuilds a
// completed assignment's certificate (same Certificate ID and filename)
// and hands it to the asrs-module-certificates Zap again. Offered when the
// certificate is Failed, or still Pending 10 minutes after completion.
const PENDING_GRACE_MS = 10 * 60 * 1000;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return json(403, { error: 'Not authorized for the admin dashboard.' });
    }
    const body = JSON.parse(event.body || '{}');
    if (!body.assignmentId) throw tm.badRequest('Pick an assignment.');

    const assignment = await tm.getAssignment(body.assignmentId);
    if ((session.grantedLocations || []).indexOf(assignment.location) < 0) {
      return json(403, { error: 'You aren\'t granted ' + (assignment.location || 'that location') + '.' });
    }
    if (assignment.status !== 'Completed') throw tm.badRequest('This module hasn\'t been completed yet.');
    if (!tm.canResendCertificate(assignment, Date.now())) {
      throw tm.badRequest(assignment.certificateStatus === 'Saved'
        ? 'This certificate is already saved to Drive.'
        : 'This certificate was sent less than 10 minutes ago. Give it a few minutes before resending.', 409);
    }

    let cert;
    if (assignment.isPath) {
      const tp = require('./lib/training-paths');
      cert = await tp.issuePathCertificate(assignment, await tp.loadPath(assignment.pathId), tm.siteFromEvent(event));
    } else {
      cert = await tm.issueCertificate(assignment, await tm.loadModule(assignment.moduleId), tm.siteFromEvent(event));
    }
    if (cert.status === 'Failed') {
      return json(502, { error: 'The certificate couldn\'t be sent to the Zap. Check that ZAPIER_MODULE_CERTIFICATE_WEBHOOK_URL is set in Netlify and the site has been redeployed since.' });
    }
    return json(200, { certificateId: cert.certificateId, message: 'Sent. It should be in Drive within a couple of minutes.' });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

exports.PENDING_GRACE_MS = PENDING_GRACE_MS;

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
