const { updatePage } = require('./lib/notion');
const tm = require('./lib/training-modules');

// Autosave from the module page: video positions every few seconds while a
// video plays, and draft answers shortly after the person stops typing.
// Returns which videos the server counts as watched.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const link = tm.readLinkToken(body.token);
    if (link.expired) throw tm.badRequest('This link has expired. Reload the page to get a new one.', 410);
    const assignment = await tm.getAssignment(link.assignmentId);
    if (link.linkVersion !== assignment.linkVersion || assignment.status === 'Cancelled') {
      throw tm.badRequest('This link no longer works.', 410);
    }
    if (assignment.status === 'Completed') throw tm.badRequest('This module is already complete.', 409);

    const mod = await tm.loadModule(assignment.moduleId);
    const progress = tm.mergeProgress(mod, assignment.progress, body.progress || {}, Date.now());
    await updatePage(assignment.id, { 'Progress': tm.richText(JSON.stringify(progress)) });
    return json(200, { videos: progress.videos });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Couldn\'t save. Check your connection.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
