const { requireSession } = require('./lib/session');
const { updatePage, queryDatabaseAll, getPlainText } = require('./lib/notion');
const { id: configId } = require('./lib/ids');
const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');
const tm = require('./lib/training-modules');
const send = require('./lib/training-modules-send');

// Admin Dashboard -> Training Modules -> one assignment.
// { assignmentId, action, ... } where action is:
//   answers    -> its written answers (Module Responses), in order
//   review     -> Reviewed, Reviewed By, Review Note (note)
//   remind     -> a reminder now, by text or email
//   newlink    -> a new link (older links stop working), sent to the person
//   due        -> change the Due Date (dueDate)
//   cancel     -> Status Cancelled; no more reminders, the link stops working
//   cancelpath -> { pathAssignmentId }: cancels a training path and its open steps
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'cancelpath') {
      const tp = require('./lib/training-paths');
      if (!body.pathAssignmentId) throw tm.badRequest('Pick a path assignment.');
      const pa = await tp.pathAssignmentFromPage(await require('./lib/notion').getPage(body.pathAssignmentId));
      if ((session.grantedLocations || []).indexOf(pa.location) < 0) return json(403, { error: 'You aren\'t granted ' + (pa.location || 'that location') + '.' });
      if (pa.status !== 'In Progress') throw tm.badRequest('This path isn\'t in progress.');
      await tp.cancelPath(pa);
      return json(200, { message: 'Path cancelled. No more reminders, and its links no longer work.' });
    }
    if (!body.assignmentId) throw tm.badRequest('Pick an assignment.');
    const a = await tm.getAssignment(body.assignmentId);
    if ((session.grantedLocations || []).indexOf(a.location) < 0) return json(403, { error: 'You aren\'t granted ' + (a.location || 'that location') + '.' });
    const deps = { sendSms: sendSms, sendEmail: sendEmail };
    const site = tm.siteFromEvent(event);

    switch (body.action) {
      case 'answers': {
        const rows = await queryDatabaseAll(configId('MODULE_RESPONSES_DB_ID'), { property: 'Assignment', relation: { contains: a.id } });
        const answers = rows.map(function (r) {
          const p = r.properties;
          return { step: getPlainText(p['Step']), number: getPlainText(p['Number']), stepTitle: getPlainText(p['Step Title']), question: getPlainText(p['Question']), answer: getPlainText(p['Answer']) };
        }).sort(function (x, y) { return (x.step - y.step) || (x.number - y.number); });
        return json(200, { answers: answers, reviewed: a.reviewed, reviewNote: a.reviewNote || '', reviewedBy: a.reviewedBy || '' });
      }
      case 'review': {
        if (a.status !== 'Completed') throw tm.badRequest('Only completed modules can be reviewed.');
        await updatePage(a.id, { 'Reviewed': { checkbox: true }, 'Reviewed By': tm.richText(session.email), 'Review Note': tm.richText(String(body.note || '').slice(0, 1500)) });
        return json(200, { message: 'Marked reviewed.' });
      }
      case 'remind': {
        if (!send.isOpen(a)) throw tm.badRequest('This module isn\'t open.');
        const channel = await send.remindNow(a, deps, site);
        return json(200, { channel: channel, message: channel ? 'Reminder sent by ' + channel.toLowerCase() + '.' : 'No phone with SMS consent and no email on file, so nothing was sent.' });
      }
      case 'newlink': {
        if (!send.isOpen(a)) throw tm.badRequest('This module isn\'t open.');
        const r = await send.resendLink(a, deps, site);
        return json(200, { channel: r.channel, link: r.link, message: r.channel ? 'New link sent by ' + r.channel.toLowerCase() + '. The old link no longer works.' : 'New link made (nothing could be sent). The old link no longer works.' });
      }
      case 'due': {
        if (!send.isOpen(a)) throw tm.badRequest('This module isn\'t open.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') || body.dueDate < tm.todayIso()) throw tm.badRequest('Pick a due date from today on.');
        await updatePage(a.id, { 'Due Date': { date: { start: body.dueDate } } });
        return json(200, { message: 'Due date changed to ' + tm.prettyDate(body.dueDate) + '.' });
      }
      case 'cancel': {
        if (!send.isOpen(a)) throw tm.badRequest('This module isn\'t open.');
        if (a.pathAssignmentId) throw tm.badRequest('This module is a step in a training path. Cancel the path instead.');
        await updatePage(a.id, { 'Status': { select: { name: 'Cancelled' } } });
        return json(200, { message: 'Cancelled. No more reminders, and the link no longer works.' });
      }
      default:
        throw tm.badRequest('Unknown action.');
    }
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
