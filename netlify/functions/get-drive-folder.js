const { requireSession } = require('./lib/session');
const drive = require('./lib/google-drive');
const { resolveRoot, httpError } = require('./lib/drive-roots');

// Lists a folder for the Sponsor App's document browser.
//   ?root=guidance                         the Sponsor Guidance Binder
//   ?root=progress-notes&resident=AR       that resident's progress notes
//   &folderId=...                          a subfolder inside that root
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const params = event.queryStringParameters || {};
    const root = await resolveRoot(session, params.root, params.resident);
    const folderId = params.folderId || root.id;
    if (folderId !== root.id && !(await drive.isWithin(folderId, root.id))) throw httpError(403, 'That folder isn\'t available here.');
    const items = await drive.listFolder(folderId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ title: root.title, rootId: root.id, folderId: folderId, items: items })
    };
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
