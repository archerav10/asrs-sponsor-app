const { requireSession } = require('./lib/session');
const { importCap } = require('./lib/cap-review');

// CAP Review: upload a CAP Response and Tracker (.docx).
//   POST { filename, file (base64) }               -> what was read (preview)
//   POST { filename, file (base64), apply: true }  -> imports it
const MAX_BYTES = 4 * 1024 * 1024;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const body = JSON.parse(event.body || '{}');
    const filename = String(body.filename || 'CAP.docx').slice(0, 200);
    if (!/\.docx$/i.test(filename)) return json(400, { error: 'Upload the CAP as a Word .docx file (in Word: File > Save As > Word Document).' });
    const buffer = Buffer.from(String(body.file || ''), 'base64');
    if (!buffer.length) return json(400, { error: 'The file is empty.' });
    if (buffer.length > MAX_BYTES) return json(400, { error: 'That file is over 4 MB.' });
    const result = await importCap(buffer, filename, session.name || session.email, session.grantedLocations || [], body.apply === true);
    return json(200, result);
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
