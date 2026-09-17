const { createPage } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const FIRE_DRILL_DB_ID = process.env.FIRE_DRILL_DB_ID; // 2cd3e109-c6b9-4cc2-80cb-fde91d28a2f4

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    const drillDateTime = body.drillDateTime; // "YYYY-MM-DDTHH:MM" from a datetime-local input
    const mockFireLocation = body.mockFireLocation || '';
    const individualsPresent = body.individualsPresent || '';
    const evacMinutes = parseInt(body.evacMinutes, 10) || 0;
    const evacSeconds = parseInt(body.evacSeconds, 10) || 0;
    const notes = body.notes || '';

    if (!drillDateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Date and time of the drill are required.' }) };
    }

    const evacuationTimeSec = evacMinutes * 60 + evacSeconds;
    const drillDateOnly = drillDateTime.slice(0, 10);
    const title = session.location + ' — ' + drillDateOnly;
    const stampedBy = session.name || session.email;

    await createPage(FIRE_DRILL_DB_ID, {
      'Drill Title': { title: [{ text: { content: title } }] },
      'Location': { select: { name: session.location } },
      'Drill Date/Time': { date: { start: drillDateTime } },
      'Mock Fire Location': { rich_text: [{ text: { content: mockFireLocation } }] },
      'Individuals Present (Initials)': { rich_text: [{ text: { content: individualsPresent } }] },
      'Evacuation Time (sec)': { number: evacuationTimeSec },
      'Notes': { rich_text: [{ text: { content: notes } }] },
      'Logged By': { rich_text: [{ text: { content: stampedBy } }] }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
