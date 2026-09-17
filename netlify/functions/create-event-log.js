const { createPage } = require('./lib/notion');
const { requireSession } = require('./lib/session');

const EVENT_LOG_DB_ID = process.env.EVENT_LOG_DB_ID; // 45e5d57d-b6bc-48e4-9283-5fbc4b2426de

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    const eventType = body.eventType; // "Appointment" | "Community Outing" | "Other"
    const residentInitials = body.residentInitials || '';
    const eventDateTime = body.eventDateTime; // "YYYY-MM-DDTHH:MM"
    const notes = body.notes || '';
    const hasAttachment = !!body.hasAttachment;
    const attachmentFilename = body.attachmentFilename || '';

    if (!eventType || !eventDateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Event type and date/time are required.' }) };
    }

    const dateOnly = eventDateTime.slice(0, 10);
    const title = session.location + ' — ' + eventType + ' — ' + dateOnly;
    const stampedBy = session.name || session.email;

    await createPage(EVENT_LOG_DB_ID, {
      'Event Title': { title: [{ text: { content: title } }] },
      'Location': { select: { name: session.location } },
      'Resident Initials': { rich_text: [{ text: { content: residentInitials } }] },
      'Event Type': { select: { name: eventType } },
      'Event Date/Time': { date: { start: eventDateTime } },
      'Notes': { rich_text: [{ text: { content: notes } }] },
      'Has Attachment': { checkbox: hasAttachment },
      'Attachment Filename': { rich_text: [{ text: { content: attachmentFilename } }] },
      'Logged By': { rich_text: [{ text: { content: stampedBy } }] }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
