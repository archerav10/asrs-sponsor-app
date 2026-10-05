const { requireSession } = require('./lib/session');
const { getChecklist, assertCanAccess, getDetail, setItem } = require('./lib/shared-checklists');

// Checks/unchecks one item and/or saves its note. Each item is its own
// Notion row, so two people working the same checklist at once never
// overwrite each other's items. Returns the whole checklist fresh, so
// the screen also picks up anything someone else changed meanwhile.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');
    if (!body.id || !body.itemKey) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Checklist ID and item are required.' }) };
    }

    const checklist = await getChecklist(body.id);
    assertCanAccess(session, checklist);
    if (checklist.completed) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This checklist has been marked complete. Reopen it to make changes.' }) };
    }

    await setItem(checklist, body.itemKey, { done: body.done, note: body.note }, session.name || session.email);

    return { statusCode: 200, body: JSON.stringify({ checklist: await getDetail(checklist) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
