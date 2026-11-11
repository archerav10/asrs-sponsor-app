const { startJob } = require('./lib/drive-documents-job');

// Scheduled (see netlify.toml) — nightly. Starts the Drive check for
// hand-placed documents (lib/drive-documents-job.js) in the background.
exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await startJob()) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
