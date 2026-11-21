const { requireSession } = require('./lib/session');
const { capDetail, openItems, todayIso } = require('./lib/cap-review');
const { buildCapReportPdf, buildOpenItemsPdf, fileSafe } = require('./lib/cap-report-pdf');

// CAP Review PDFs.
//   GET ?capId=...   CAP report: every citation on that CAP, open and closed
//   GET ?open=1      Open items: every open citation at the admin's locations
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const locations = session.grantedLocations || [];
    const q = event.queryStringParameters || {};
    let pdf, filename;
    const stamp = todayIso();
    if (q.capId) {
      const detail = await capDetail(q.capId);
      if (locations.indexOf(detail.cap.location) === -1) return json(403, { error: 'Not authorized for that location.' });
      pdf = await buildCapReportPdf(detail);
      filename = 'CAP Report - ' + fileSafe(detail.cap.location + ' ' + detail.cap.licenseNumber + ' inspection ' + detail.cap.inspectionDate) + ' - ' + stamp + '.pdf';
    } else {
      pdf = await buildOpenItemsPdf(await openItems(locations), locations);
      filename = 'CAP Open Items - ' + stamp + '.pdf';
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + filename.replace(/"/g, '') + '"', 'Cache-Control': 'no-store' },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
