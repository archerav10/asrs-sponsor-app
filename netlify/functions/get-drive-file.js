const { requireSession } = require('./lib/session');
const drive = require('./lib/google-drive');
const { resolveRoot, httpError } = require('./lib/drive-roots');

// Streams one file from a root the sponsor may browse (same parameters as
// get-drive-folder, plus fileId). Google Docs/Sheets/Slides come back as
// PDFs.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const params = event.queryStringParameters || {};
    if (!params.fileId) throw httpError(400, 'Choose a file.');
    const root = await resolveRoot(session, params.root, params.resident);
    if (!(await drive.isWithin(params.fileId, root.id))) throw httpError(403, 'That file isn\'t available here.');
    const file = await drive.fileContent(params.fileId);
    const name = (file.exported ? file.name + '.pdf' : file.name).replace(/["\\\r\n]/g, '');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': 'inline; filename="' + name + '"',
        'Cache-Control': 'private, no-store'
      },
      body: file.buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) console.error(err);
    return { statusCode: err.statusCode || 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
