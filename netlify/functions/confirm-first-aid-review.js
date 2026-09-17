const { queryDatabase, updatePage } = require('./lib/notion');
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

    const result = await queryDatabase(FIRST_AID_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });

    const pages = result.results || [];
    const stampedBy = session.name || session.email;
    const today = todayISO();

    // Sequential to stay comfortably under Notion's rate limits — ~28
    // items per location, so this finishes in a couple of seconds.
    for (const page of pages) {
      await updatePage(page.id, {
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, count: pages.length, date: today }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
