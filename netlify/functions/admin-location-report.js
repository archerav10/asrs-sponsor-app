const { requireSession } = require('./lib/session');
const lr = require('./lib/location-report');
const { buildLocationReportPdf, reportFilename } = require('./lib/location-report-pdf');

// Admin dashboard: the Monthly Location Compliance Report (ASRS-520-03)
// as a PDF to download.
//   GET ?location=Janeway&month=2026-11&mode=mtd     month to date (preview)
//   GET ?location=Janeway&month=2026-11&mode=final   month-end report: the
//        saved snapshot, or built and saved the first time
//   ...&mode=final&regenerate=1                       rebuild and replace the snapshot
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const q = event.queryStringParameters || {};
    if ((session.grantedLocations || []).indexOf(q.location) === -1) return json(403, { error: 'Not authorized for that location.' });
    lr.monthBounds(q.month);
    let report;
    if (q.mode === 'final') {
      report = (await lr.finalReport(q.location, q.month, session.name || session.email, q.regenerate === '1')).report;
    } else {
      report = await lr.build(q.location, q.month, 'mtd');
    }
    const pdf = await buildLocationReportPdf(report);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + reportFilename(report) + '"', 'Cache-Control': 'no-store' },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
