const { requireSession } = require('./lib/session');
const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');
const tm = require('./lib/training-modules');
const send = require('./lib/training-modules-send');

// Admin Dashboard -> Training Modules -> Assign. One or more modules (a
// bundle) to one or more people, picked by location, role and name on the
// dashboard. { moduleIds, personIds, dueDate, preview }.
//   preview: true  -> who gets what, how, and who's skipped (nothing saved)
//   otherwise      -> small jobs run here and return per-person results;
//                     bigger ones go to module-jobs-background.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const body = JSON.parse(event.body || '{}');
    const opts = {
      moduleIds: body.moduleIds, pathIds: body.pathIds, personIds: body.personIds, dueDate: body.dueDate,
      grantedLocations: session.grantedLocations || [], assignedBy: session.email, site: tm.siteFromEvent(event)
    };
    const plan = await send.planAssignments(opts);
    if (body.preview) return json(200, send.planSummary(plan));
    if (!plan.totals.assignments) throw tm.badRequest('Everyone picked already has these modules open. Nothing was sent.');

    if (plan.totals.assignments <= send.INLINE_LIMIT) {
      const results = await send.carryOutPlan(plan, opts, { sendSms: sendSms, sendEmail: sendEmail });
      return json(200, { done: true, totals: plan.totals, results: results });
    }
    await send.startJob('assign', {
      moduleIds: opts.moduleIds, pathIds: opts.pathIds, personIds: opts.personIds, dueDate: opts.dueDate,
      grantedLocations: opts.grantedLocations, assignedBy: opts.assignedBy, site: opts.site
    }, opts.site);
    return json(200, { started: true, totals: plan.totals });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
