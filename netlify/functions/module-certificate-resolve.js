const { updatePage } = require('./lib/notion');
const tm = require('./lib/training-modules');

// Called by the "ASRS Module Certificates" Zap, never by a browser.
//   { action: "resolve", assignmentId, certificateId }
//     -> where the certificate goes: { filename, folderId, rootFolderId,
//        locationFolderName, fallbackFolderName }. folderId is the person's
//        Training folder; when it's blank the Zap files it under
//        Facility Reporting/{locationFolderName}/{fallbackFolderName}.
//   { action: "saved", assignmentId, certificateId, link }
//     -> marks Certificate Status = Saved.
// Only answers for a Completed assignment whose Certificate ID matches, so
// the Zap's public hook can't be used to file arbitrary files.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const dest = await tm.certificateDestination(body.assignmentId, body.certificateId);
    if (body.action === 'saved') {
      await updatePage(body.assignmentId, { 'Certificate Status': { select: { name: 'Saved' } } });
      return json(200, { ok: true });
    }
    return json(200, dest);
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
