const { createPage } = require('./lib/notion');
const { sendSms } = require('./lib/twilio');
const { recipientsForLocation } = require('./lib/notification-recipients');

const SERIOUS_INCIDENT_DB_ID = process.env.SERIOUS_INCIDENT_DB_ID;

// Same six facilities used elsewhere in this app's Notion schemas
// (Daily Progress Notes, Monthly Checklist, etc.) — kept as a fixed list
// here too, even though this endpoint takes no session to derive it from,
// so a typo in the submitted location can't silently create a report
// nobody at the right facility ever sees.
const VALID_LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

// Unauthenticated counterpart to create-serious-incident.js — reachable
// from a QR code posted at each facility with no login required, same as
// the paper form it replaces (physical presence at the facility is the
// only trust boundary, exactly as it was for the paper form). Submit-only
// by design: unlike the in-app screen, this never reads back any
// incident history, since anyone with the URL — not just this facility's
// staff — could load this page. requireSession is deliberately absent;
// every other write endpoint in this app has one, and this is the one
// exception, made on purpose.
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

    const location = body.location || '';
    const residentInvolved = (body.residentInvolved || '').trim().slice(0, 200);
    const incidentDateTime = body.incidentDateTime; // "YYYY-MM-DDTHH:MM"
    const incidentLocation = (body.incidentLocation || '').trim().slice(0, 200);
    const incidentName = (body.incidentName || '').trim().slice(0, 300);
    const details = (body.details || '').trim().slice(0, 5000);
    const reportedBy = (body.reportedBy || '').trim().slice(0, 200);

    if (VALID_LOCATIONS.indexOf(location) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Choose a valid facility.' }) };
    }
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
      'Location': { rich_text: [{ text: { content: location } }] },
      'Resident Involved': { rich_text: [{ text: { content: residentInvolved } }] },
      'Date of Incident': { date: { start: incidentDateTime } },
      'Location of Incident': { rich_text: [{ text: { content: incidentLocation } }] },
      'Description of Incident': { rich_text: [{ text: { content: details } }] },
      'Status': { select: { name: 'Submitted' } },
      'Submitted By': { rich_text: [{ text: { content: stampedBy } }] }
    });

    // Immediate notification — not batched into any scheduled check.
    // Administration only, not sponsors, same as the authenticated path.
    try {
      const recipients = await recipientsForLocation(location);
      const admins = recipients.filter(function (r) { return r.role === 'admin'; });
      const dateLabel = new Date(incidentDateTime).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const message = 'ASRS SERIOUS INCIDENT — ' + location + '\n' +
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
