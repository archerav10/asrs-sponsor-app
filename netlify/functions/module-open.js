const { updatePage } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');
const tm = require('./lib/training-modules');

// The module page (/m/{token}) calls this first. No login: the link is
// the access (see lib/training-modules.js, "private links"). Returns the
// module, its steps and what the person has done so far, and marks the
// assignment In Progress the first time it's opened.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const link = tm.readLinkToken(body.token);
    const assignment = await tm.getAssignment(link.assignmentId);

    if (assignment.status === 'Cancelled') {
      return json(410, { error: 'This training module was cancelled. Nothing more is needed from you.' });
    }
    if (assignment.status === 'Locked') {
      return json(409, { error: await require('./lib/training-paths').lockedMessage(assignment) });
    }
    if (link.linkVersion !== assignment.linkVersion) {
      return json(410, { error: 'This link has been replaced by a newer one. Please use the most recent link we sent you.' });
    }

    const mod = await tm.loadModule(assignment.moduleId);
    const firstName = (assignment.personName || '').split(/\s+/)[0];

    if (assignment.status === 'Completed') {
      return json(200, {
        completed: true, firstName: firstName, module: { title: mod.title, certificateLine: mod.certificateLine },
        completedAt: assignment.completedAt, certificateId: assignment.certificateId,
        location: assignment.location, role: assignment.role, personName: assignment.personName
      });
    }

    if (link.expired) {
      // Send a fresh link the same way the first one went, then say so.
      const person = await tm.getPerson(assignment.personId).catch(function () { return null; });
      const sent = await tm.sendAssignmentNotice(Object.assign({}, assignment, { smsConsent: person && person.smsConsent }), mod, { sendSms: sendSms, sendEmail: sendEmail, site: tm.siteFromEvent(event) }).catch(function (e) { console.error(e); return { channel: '' }; });
      return json(410, { error: sent.channel === 'Text' ? 'This link has expired. We\'ve texted you a new one.' : sent.channel === 'Email' ? 'This link has expired. We\'ve emailed you a new one.' : 'This link has expired. Please ask ASRS for a new one.' });
    }

    if (mod.problems.length) {
      console.error('Module ' + mod.id + ' has problems', mod.problems);
      return json(503, { error: 'This module isn\'t ready yet. ASRS has been told; please try again later.' });
    }
    if (assignment.moduleVersion !== mod.version) {
      // The steps changed after this was assigned. Progress is keyed by step
      // order, so it carries over as far as it still fits.
      console.warn('Assignment ' + assignment.id + ' was made for version ' + assignment.moduleVersion + '; module is now ' + mod.version);
    }

    if (assignment.status === 'Assigned') {
      await updatePage(assignment.id, {
        'Status': { select: { name: 'In Progress' } },
        'Opened At': { date: { start: new Date().toISOString() } }
      });
    }

    return json(200, {
      completed: false,
      firstName: firstName,
      dueDate: assignment.dueDate,
      module: tm.publicModule(mod),
      progress: assignment.progress
    });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Something went wrong. Please try again.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
