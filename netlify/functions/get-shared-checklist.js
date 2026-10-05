const { requireSession } = require('./lib/session');
const { getChecklist, assertCanAccess, getDetail } = require('./lib/shared-checklists');

// One shared checklist with every item's current state — who checked it,
// when, and any note. Same endpoint for the provider app and the admin
// dashboard; assertCanAccess decides what each may see.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const id = (event.queryStringParameters || {}).id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Checklist ID is required.' }) };
    }

    const checklist = await getChecklist(id);
    assertCanAccess(session, checklist);

    return { statusCode: 200, body: JSON.stringify({ checklist: await getDetail(checklist) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
