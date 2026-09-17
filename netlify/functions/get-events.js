const { queryDatabase, getPlainText } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const EVENT_LOG_DB_ID = process.env.EVENT_LOG_DB_ID;

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);

    const startDate = isoDateOffset(-30);
    const endDate = isoDateOffset(30);

    const result = await queryDatabase(EVENT_LOG_DB_ID, {
      and: [
        { property: 'Location', select: { equals: session.location } },
        { property: 'Event Date/Time', date: { on_or_after: startDate } },
        { property: 'Event Date/Time', date: { on_or_before: endDate } }
      ]
    });

    const events = (result.results || []).map(function (page) {
      return {
        id: page.id,
        eventType: getPlainText(page.properties['Event Type']),
        residentInitials: getPlainText(page.properties['Resident Initials']),
        eventDateTime: getPlainText(page.properties['Event Date/Time']),
        notes: getPlainText(page.properties['Notes']),
        hasAttachment: getPlainText(page.properties['Has Attachment']),
        attachmentFilename: getPlainText(page.properties['Attachment Filename']),
        loggedBy: getPlainText(page.properties['Logged By'])
      };
    }).sort(function (a, b) {
      return (a.eventDateTime || '').localeCompare(b.eventDateTime || '');
    });

    return { statusCode: 200, body: JSON.stringify({ location: session.location, events: events }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
