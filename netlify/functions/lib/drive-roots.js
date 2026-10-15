const drive = require('./google-drive');
const { residentFullNameFor } = require('./medical-appointments');
const { id: configId } = require('./ids');

// The Drive folders the Sponsor App can browse, each resolved on the
// server from the sponsor's own session. The browser never chooses a
// folder ID: it names a "root", and every folder or file it asks for
// afterwards must sit inside that root (see isWithin).
//
//   guidance        the Sponsor Guidance Binder (every sponsor)
//   progress-notes  Facility Reporting/{Location}/Residents/{Full Name}/
//                   Daily Progress Notes, for one of the sponsor's own
//                   residents: where the nightly Daily Progress Note PDFs
//                   land (see the Zapier setup in the README)

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function sponsorResidents(session) {
  return (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

async function progressNotesFolder(location, resident) {
  const fullName = await residentFullNameFor(location, resident);
  if (!fullName) throw httpError(404, 'This resident\'s folder isn\'t set up yet. Please let the office know.');
  let folder = configId('FACILITY_REPORTING_ROOT_FOLDER_ID');
  for (const name of [location, 'Residents', fullName, 'Daily Progress Notes']) {
    folder = await drive.findChildFolder(folder, name);
    if (!folder) throw httpError(404, 'No progress notes have been filed for ' + resident + ' yet.');
  }
  return folder;
}

// { id, title } for the root this session may browse.
async function resolveRoot(session, root, resident) {
  if (session.accountType !== 'sponsor') throw httpError(403, 'This is for sponsors.');
  if (root === 'guidance') {
    return { id: configId('SPONSOR_GUIDANCE_FOLDER_ID'), title: 'Sponsor Guidance' };
  }
  if (root === 'progress-notes') {
    if (sponsorResidents(session).indexOf(resident) === -1) throw httpError(403, 'That resident isn\'t on your account.');
    return { id: await progressNotesFolder(session.location, resident), title: 'Progress Notes: ' + resident };
  }
  throw httpError(400, 'Unknown folder.');
}

module.exports = { resolveRoot, httpError };
