const { readJobTicket, runDriveCheck } = require('./lib/drive-documents-job');

// Background function (the "-background" suffix gives it 15 minutes).
// Only runs with a ticket from check-drive-documents.js.
exports.handler = async function (event) {
  try {
    readJobTicket(JSON.parse(event.body || '{}').ticket);
  } catch (e) {
    console.error('Drive check refused: ' + e.message);
    return;
  }

  try {
    console.log('Drive check finished: ' + JSON.stringify(await runDriveCheck()));
  } catch (e) {
    console.error('Drive check failed', e);
  }
};
