const { saveItem } = require('./lib/sponsor-checklists');

// Saves one item from the recipient's checklist page: Done, date, notes.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.itemId) return { statusCode: 400, body: JSON.stringify({ error: 'itemId is required.' }) };
    const saved = await saveItem(body.t, body.itemId, { done: body.done, date: body.date, notes: body.notes });
    return { statusCode: 200, body: JSON.stringify(Object.assign({ success: true }, saved)) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
