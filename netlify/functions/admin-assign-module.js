const { requireSession } = require('./lib/session');
const { updatePage } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');
const tm = require('./lib/training-modules');

// Admin Dashboard -> Training Modules -> Assign: one module to one person,
// with a due date. Creates the Module Assignments row and sends the link
// (text if the person is Opted In with a phone number, otherwise email).
// The link is also returned so the admin can copy it.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return json(403, { error: 'Not authorized for the admin dashboard.' });
    }
    const body = JSON.parse(event.body || '{}');
    if (!body.moduleId || !body.personId) throw tm.badRequest('Pick a module and a person.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '')) throw tm.badRequest('Pick a due date.');
    if (body.dueDate < tm.todayIso()) throw tm.badRequest('The due date is in the past.');

    const person = await tm.getPerson(body.personId);
    if ((session.grantedLocations || []).indexOf(person.location) < 0) {
      return json(403, { error: 'You aren\'t granted ' + (person.location || 'that person\'s location') + '.' });
    }

    const mod = await tm.loadModule(body.moduleId);
    if (mod.status !== 'Published') throw tm.badRequest('"' + mod.title + '" isn\'t Published in Notion yet.');
    if (mod.problems.length) throw tm.badRequest('"' + mod.title + '" can\'t be assigned yet: ' + mod.problems.join(' '));

    const open = (await tm.listAssignments({ property: 'Person', relation: { contains: person.id } }))
      .filter(function (a) { return tm.sameId(a.moduleId, mod.id) && (a.status === 'Assigned' || a.status === 'In Progress'); });
    if (open.length) throw tm.badRequest(person.name + ' already has "' + mod.title + '" open (due ' + tm.prettyDate(open[0].dueDate) + ').', 409);

    const phone = tm.normalizePhone(person.phone);
    const assignment = await tm.createAssignment({
      moduleId: mod.id, moduleTitle: mod.title, moduleVersion: mod.version,
      personId: person.id, personName: person.name, role: person.role, location: person.location,
      dueDate: body.dueDate, assignedBy: session.email, phone: phone, email: person.email
    });

    const site = tm.siteFromEvent(event);
    let sent = { channel: '', link: tm.moduleLink(assignment, site) };
    let sendError = '';
    try {
      sent = await tm.sendAssignmentNotice(Object.assign({}, assignment, { smsConsent: person.smsConsent }), mod, { sendSms: sendSms, sendEmail: sendEmail, site: site });
    } catch (e) {
      console.error('Assignment notice failed', e);
      sendError = e.message;
    }
    if (sent.channel) await updatePage(assignment.id, { 'Channel': { select: { name: sent.channel } } });

    return json(200, {
      assignmentId: assignment.id,
      channel: sent.channel,
      link: sent.link,
      message: sent.channel === 'Text' ? 'Texted ' + person.name + '.'
        : sent.channel === 'Email' ? 'Emailed ' + person.name + ' (no SMS consent on file).'
        : sendError ? 'Assigned, but the message didn\'t send: ' + sendError + ' Copy the link below and send it yourself.'
        : 'Assigned. ' + person.name + ' has no phone with SMS consent and no email in ASRS People, so nothing was sent. Copy the link below and send it yourself.'
    });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
