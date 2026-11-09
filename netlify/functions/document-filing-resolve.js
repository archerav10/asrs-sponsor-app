const { decryptToken } = require('./lib/crypto');
const { id: configId } = require('./lib/ids');
const { updatePage } = require('./lib/notion');

// Zapier-facing, for the "ASRS Document Filing" workflow (visit and
// questionnaire PDFs). The encrypted ticket from lib/liaison.js names the
// file, the folders under Facility Reporting and the Notion row.
//   { action: 'resolve', ticket } -> { rootFolderId, folders: [{ name, create }], filename }
//   { action: 'saved', ticket, link } -> PDF Status = Saved, PDF Link
function json(statusCode, body) { return { statusCode: statusCode, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    let t;
    try { t = decryptToken(body.ticket || ''); } catch (e) { return json(401, { error: 'Filing ticket expired or invalid.' }); }
    if (t.kind !== 'filing' || !t.pageId || !Array.isArray(t.folders) || !t.folders.length || !t.filename) return json(401, { error: 'Invalid filing ticket.' });

    if ((body.action || 'resolve') === 'resolve') {
      return json(200, { rootFolderId: configId('FACILITY_REPORTING_ROOT_FOLDER_ID'), folders: t.folders, filename: t.filename });
    }
    if (body.action === 'saved') {
      const link = typeof body.link === 'string' && /^https:\/\//.test(body.link) ? body.link : null;
      await updatePage(t.pageId, { 'PDF Status': { select: { name: 'Saved' } }, 'PDF Link': { url: link } });
      return json(200, { success: true });
    }
    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};
