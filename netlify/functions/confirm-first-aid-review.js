const { queryDatabase, updatePage, getPlainText } = require('./lib/notion');
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
    const submittedItems = body.items || [];        // [{ id, currentExpDate?, present? }]
    const generalNotes = body.generalNotes;          // string, optional

    // Authoritative list of what actually belongs to this provider's
    // location — the client's ids are only ever applied if they show up
    // here, so a tampered payload can't touch another location's rows.
    const result = await queryDatabase(FIRST_AID_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });

    const authoritative = {};
    let generalNotesId = null;
    (result.results || []).forEach(function (page) {
      const name = getPlainText(page.properties['Item Name']);
      if (name === 'General Notes') {
        generalNotesId = page.id;
      } else {
        authoritative[page.id] = { tracksExpiration: getPlainText(page.properties['Tracks Expiration']) };
      }
    });

    const stampedBy = session.name || session.email;
    const today = todayISO();
    let updatedCount = 0;

    for (const submitted of submittedItems) {
      const known = authoritative[submitted.id];
      if (!known) continue; // not this provider's item — ignore

      const properties = {
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      };

      if (known.tracksExpiration) {
        properties['Current Exp Date'] = submitted.currentExpDate
          ? { date: { start: submitted.currentExpDate } }
          : { date: null };
      } else {
        properties['Present'] = { checkbox: !!submitted.present };
      }

      await updatePage(submitted.id, properties);
      updatedCount++;
    }

    if (generalNotesId && generalNotes !== undefined) {
      await updatePage(generalNotesId, {
        'Notes': { rich_text: [{ text: { content: generalNotes } }] },
        'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
        'Last Updated Date': { date: { start: today } }
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, count: updatedCount, date: today }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
