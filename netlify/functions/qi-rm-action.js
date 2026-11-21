const { requireSession } = require('./lib/session');
const qi = require('./lib/qi-rm');
const rep = require('./lib/qi-report');

// QI & RM changes (Executive Director and Risk Manager only).
//   saveResult     { objectiveId, month, count?, total?, valueText?, status?, comment?, cause?, revisedAction?, followOwner?, followDue? }
//   editObjective  { id, changes }        owner/data source/review in place; others -> draft for next version
//   addObjective   { objective fields }   draft for the next version
//   retireObjective { id, retire }        mark (or unmark) to retire at the next version; discards a draft
//   editGoalNotes  { id, notes }
//   adoptVersion   { version, effective, approvedBy?, changes? }
//   reportInfo { month } / saveReportInfo { month, preparedBy, datePrepared, meetingDate, attendees, riskToolLink }
//   createItem / editItem { id, changes } / updateItem { id, text, date?, status?, due? }
//   completeItem   { id, evidence, evidenceLink?, date? } / dropItem { id, reason } / promoteItem { id, objective fields }
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    await qi.requireQiAccess(session);
    const by = session.name || session.email;
    const b = JSON.parse(event.body || '{}');
    switch (b.action) {
      case 'saveResult': return json(200, { result: await qi.saveResult(b, by) });
      case 'editObjective': return json(200, await qi.editObjective(b.id, b.changes || {}, by));
      case 'addObjective': return json(200, { draft: await qi.addDraftObjective(b, by) });
      case 'retireObjective': return json(200, await qi.setRetire(b.id, b.retire !== false, by));
      case 'editGoalNotes': return json(200, { goal: await qi.editGoalNotes(b.id, b.notes) });
      case 'adoptVersion': return json(200, await qi.adoptVersion(b, by));
      case 'reportInfo': return json(200, { info: await rep.reportInfo(b.month) });
      case 'saveReportInfo': return json(200, { info: await rep.saveReportInfo(b, by) });
      case 'createItem': return json(200, { item: await qi.createItem(b, by) });
      case 'editItem': return json(200, { item: await qi.editItem(b.id, b.changes || {}, by) });
      case 'updateItem': return json(200, { item: await qi.addItemUpdate(b.id, b, by) });
      case 'completeItem': return json(200, { item: await qi.completeItem(b.id, b, by) });
      case 'dropItem': return json(200, { item: await qi.dropItem(b.id, b, by) });
      case 'promoteItem': return json(200, await qi.promoteItem(b.id, b, by));
      default: return json(400, { error: 'Unknown action.' });
    }
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
