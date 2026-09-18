const { createPage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { sendSms } = require('./lib/twilio');
const { recipientsForLocation } = require('./lib/notification-recipients');

const SERIOUS_INCIDENT_DB_ID = process.env.SERIOUS_INCIDENT_DB_ID;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    const residentInvolved = body.residentInvolved || '';
    const incidentDateTime = body.incidentDateTime; // "YYYY-MM-DDTHH:MM"
    const incidentLocation = body.incidentLocation || '';
    const incidentName = body.incidentName;
    const details = body.details || '';

    if (!incidentDateTime || !incidentName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Date/time and a name for the incident are required.' }) };
    }

    const stampedBy = session.name || session.email;

    await createPage(SERIOUS_INCIDENT_DB_ID, {
      'Name': { title: [{ text: { content: incidentName } }] },
      'Location': { rich_text: [{ text: { content: session.location } }] },
      'Resident Involved': { rich_text: [{ text: { content: residentInvolved } }] },
      'Date of Incident': { date: { start: incidentDateTime } },
      'Location of Incident': { rich_text: [{ text: { content: incidentLocation } }] },
      'Description of Incident': { rich_text: [{ text: { content: details } }] },
      'Status': { select: { name: 'Submitted' } },
      'Submitted By': { rich_text: [{ text: { content: stampedBy } }] }
    });

    // Immediate notification — not batched into any scheduled check.
    // Administration only, not sponsors, per how this was specified.
    try {
      const recipients = await recipientsForLocation(session.location);
      const admins = recipients.filter(function (r) { return r.role === 'admin'; });
      const dateLabel = new Date(incidentDateTime).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const message = 'ASRS SERIOUS INCIDENT — ' + session.location + '\n' +
        incidentName + '\n' +
        'Resident: ' + (residentInvolved || 'N/A') + '\n' +
        'When: ' + dateLabel + '\n' +
        'Where: ' + (incidentLocation || 'N/A') + '\n' +
        'Reported by: ' + stampedBy;
      for (const admin of admins) {
        await sendSms(admin.phone, message);
      }
    } catch (notifyErr) {
      // The incident is already saved — a notification failure shouldn't
      // make the submission itself look like it failed to the provider.
      console.error('Serious incident saved, but admin notification failed:', notifyErr);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
