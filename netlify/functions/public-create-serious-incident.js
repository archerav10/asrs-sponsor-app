const { createPage } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { allEnabledAdmins } = require('./lib/notification-recipients');

const SERIOUS_INCIDENT_DB_ID = process.env.SERIOUS_INCIDENT_DB_ID;

// This form isn't tied to any of the six residential facilities — it's
// used independently of them — so there's no real "Location" to ask the
// public submitter for, and no reason to show them the internal facility
// list. A fixed placeholder keeps the Notion record shaped the same as
// every other Serious Incident row (which all have a Location) without
// asking a question that has no real answer here.
const LOCATION = 'Headquarters';

// Unauthenticated counterpart to create-serious-incident.js — reachable
// from a QR code with no login required, same as the paper form it
// replaces (physical presence wherever the code is posted is the only
// trust boundary, exactly as it was for the paper form). Submit-only by
// design: unlike the in-app screen, this never reads back any incident
// history, since anyone with the URL could load this page. requireSession
// is deliberately absent; every other write endpoint in this app has
// one, and this is the one exception, made on purpose.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // Honeypot: a real visitor never sees or fills this field (hidden
    // off-screen in report-incident/index.html). A non-empty value means
    // whatever's posting here is filling in every field it finds, same
    // as a simple spam bot would — quietly report success without
    // actually writing anything or texting anyone, so it can't tell the
    // difference and try again with something smarter.
    if (body.company) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    const residentInvolved = (body.residentInvolved || '').trim().slice(0, 200);
    const incidentDateTime = body.incidentDateTime; // "YYYY-MM-DDTHH:MM"
    const incidentLocation = (body.incidentLocation || '').trim().slice(0, 200);
    const incidentName = (body.incidentName || '').trim().slice(0, 300);
    const details = (body.details || '').trim().slice(0, 5000);
    const reportedBy = (body.reportedBy || '').trim().slice(0, 200);

    if (!residentInvolved) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Resident is required.' }) };
    }
    if (!incidentDateTime || !incidentName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Date/time and a name for the incident are required.' }) };
    }
    if (!reportedBy) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Your name is required.' }) };
    }

    // Tagged so anyone reviewing this record in Notion can immediately
    // tell it came through the public, no-login form rather than the
    // in-app screen — the two have very different trust models, and that
    // distinction is worth keeping visible on the record itself.
    const stampedBy = reportedBy + ' (via public QR form, no login)';

    await createPage(SERIOUS_INCIDENT_DB_ID, {
      'Name': { title: [{ text: { content: incidentName } }] },
      'Location': { rich_text: [{ text: { content: LOCATION } }] },
      'Resident Involved': { rich_text: [{ text: { content: residentInvolved } }] },
      'Date of Incident': { date: { start: incidentDateTime } },
      'Location of Incident': { rich_text: [{ text: { content: incidentLocation } }] },
      'Description of Incident': { rich_text: [{ text: { content: details } }] },
      'Status': { select: { name: 'Submitted' } },
      'Submitted By': { rich_text: [{ text: { content: stampedBy } }] }
    });

    // Immediate notification — not batched into any scheduled check.
    // Every admin, not filtered by granted location — this form isn't
    // tied to a facility, so location-based filtering would reach nobody
    // unless an admin happened to be granted the LOCATION placeholder
    // specifically.
    try {
      const admins = await allEnabledAdmins();
      const dateLabel = new Date(incidentDateTime).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const message = 'ASRS SERIOUS INCIDENT (public form)\n' +
        incidentName + '\n' +
        'Resident: ' + residentInvolved + '\n' +
        'When: ' + dateLabel + '\n' +
        'Where: ' + (incidentLocation || 'N/A') + '\n' +
        'Reported by: ' + stampedBy;
      for (const admin of admins) {
        await sendSms(admin.phone, message);
      }
    } catch (notifyErr) {
      console.error('Serious incident saved, but admin notification failed:', notifyErr);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
