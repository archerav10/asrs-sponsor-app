const { requireSession } = require('./lib/session');
const qi = require('./lib/qi-rm');
const rep = require('./lib/qi-report');
const { buildQiReportPdf, reportFilename } = require('./lib/qi-report-pdf');

// Monthly QI & RM Status and Compliance Report (ASRS-620-06), Executive
// Director and Risk Manager only.
//   GET ?month=yyyy-mm&check=1   what the report will contain (readiness)
//   GET ?month=yyyy-mm           the report as a fillable PDF
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    await qi.requireQiAccess(session);
    const q = event.queryStringParameters || {};
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month || '')) return json(400, { error: 'Choose a month.' });
    const data = await rep.gather(q.month);
    if (q.check) return json(200, rep.summary(data));
    const pdf = await buildQiReportPdf(data);
    await rep.markGenerated(data.info, data.risk ? data.risk.file.name : '', session.name || session.email).catch(function (e) { console.error('Report generated, but not recorded', e); });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + reportFilename(data).replace(/"/g, '') + '"', 'Cache-Control': 'no-store' },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
