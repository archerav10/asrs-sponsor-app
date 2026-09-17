const { notionFetch, updatePage, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');
    const itemId = body.itemId;
    const currentExpDate = body.currentExpDate; // "YYYY-MM-DD" or ""
    const notes = body.notes || '';

    if (!itemId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing itemId.' }) };
    }

    // Fetch the item first to confirm it actually belongs to this
    // provider's own location — never trust location from the client.
    const page = await notionFetch('/pages/' + itemId);
    const itemLocation = getPlainText(page.properties['Location']);
    if (itemLocation !== session.location) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this item.' }) };
    }

    const properties = {
      'Notes': { rich_text: [{ text: { content: notes } }] },
      'Last Updated By': { rich_text: [{ text: { content: session.name || session.email } }] },
      'Last Updated Date': { date: { start: todayISO() } }
    };

    if (currentExpDate) {
      properties['Current Exp Date'] = { date: { start: currentExpDate } };
    } else {
      properties['Current Exp Date'] = { date: null };
    }

    await updatePage(itemId, properties);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
