const { queryDatabaseAll, queryDatabase, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { findAllQuestionRows } = require('./daily-progress-notes');

const { id: configId } = require('./ids');

const APPOINTMENT_LOG_DB_ID = configId('APPOINTMENT_LOG_DB_ID');
const MAR_DB_ID = process.env.MAR_DB_ID;

const STATUSES = ['Pending', 'Completed', 'Cancelled'];
const NOTES_FOLDER_NAME = 'Appointment Notes';

function isValidStatus(status) {
  return STATUSES.indexOf(status) !== -1;
}

// Same resident source as Give Medications/Medical Appointments — a
// resident exists in this app once they have a medication on file.
async function residentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const set = new Set();
  (result.results || []).forEach(function (page) {
    const initials = getPlainText(page.properties['Resident Initials']);
    if (initials) set.add(initials);
  });
  return Array.from(set).sort();
}

// Drive's resident folders are named by full name, not initials — same
// source as the Medication Administration Report and Medical Appointments.
async function residentFullNameFor(location, resident) {
  const rows = await findAllQuestionRows(location, resident);
  return (rows.length && rows[0].residentFullName) ? rows[0].residentFullName : '';
}

function appointmentFromPage(page) {
  return {
    id: page.id,
    location: getPlainText(page.properties['Location']),
    resident: getPlainText(page.properties['Resident Initials']),
    appointmentDate: getPlainText(page.properties['Appointment Date']),
    appointmentType: getPlainText(page.properties['Appointment Type']),
    status: getPlainText(page.properties['Status']),
    hasNotes: !!getPlainText(page.properties['Has Notes']),
    notesUploaded: !!getPlainText(page.properties['Notes Uploaded']),
    notesFilename: getPlainText(page.properties['Notes Filename']),
    createdByRole: getPlainText(page.properties['Created By Role']),
    loggedBy: getPlainText(page.properties['Logged By']),
    loggedDate: getPlainText(page.properties['Logged Date'])
  };
}

// Every appointment at a location, newest appointment date first —
// sponsors and admins both see the whole location's log (not just what
// they personally entered), so an admin-entered appointment shows up on
// the sponsor's screen too.
async function appointmentsForLocation(location) {
  const pages = await queryDatabaseAll(APPOINTMENT_LOG_DB_ID, {
    property: 'Location', select: { equals: location }
  });
  return pages.map(appointmentFromPage).sort(function (a, b) {
    return a.appointmentDate < b.appointmentDate ? 1 : a.appointmentDate > b.appointmentDate ? -1 : 0;
  });
}

async function appointmentById(appointmentId) {
  return appointmentFromPage(await getPage(appointmentId));
}

// A appointment type is free text (not the fixed compliance list Medical
// Appointments uses) — this is a day-to-day scheduling log, not an annual
// compliance record. Only the date format and presence are enforced; a
// future date is expected and normal here, unlike a document upload that
// can only follow something that already happened.
function validateAppointmentInput(appointmentType, appointmentDate) {
  if (!(appointmentType || '').trim()) return 'Enter the appointment type.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate || '')) return 'Choose the appointment date.';
  return '';
}

async function createAppointment(location, resident, appointmentType, appointmentDate, status, hasNotes, createdByRole, loggedBy) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await createPage(APPOINTMENT_LOG_DB_ID, {
    'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + appointmentType + ' - ' + appointmentDate } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Appointment Date': { date: { start: appointmentDate } },
    'Appointment Type': { rich_text: [{ text: { content: appointmentType } }] },
    'Status': { select: { name: status } },
    'Has Notes': { checkbox: !!hasNotes },
    'Notes Uploaded': { checkbox: false },
    'Created By Role': { select: { name: createdByRole } },
    'Logged By': { rich_text: [{ text: { content: loggedBy } }] },
    'Logged Date': { date: { start: today } }
  });
  return appointmentFromPage(result);
}

function updateAppointmentStatus(appointmentId, status, hasNotes) {
  return updatePage(appointmentId, {
    'Status': { select: { name: status } },
    'Has Notes': { checkbox: !!hasNotes }
  });
}

// Filename convention: "{appointmentDate}_AppointmentNotes_{location}_{resident}{ext}"
// — date-first so a resident's Appointment Notes folder sorts
// chronologically in Drive, same idea as Medical Appointments' filenames.
function buildNotesFilename(appointmentDate, location, resident, extension) {
  const sanitize = function (s) { return (s || '').replace(/[^a-zA-Z0-9]+/g, ''); };
  const ext = (extension || '').replace(/[^a-zA-Z0-9.]/g, '');
  return appointmentDate + '_AppointmentNotes_' + sanitize(location) + '_' + sanitize(resident) + ext;
}

function recordNotesUploaded(appointmentId, filename) {
  return updatePage(appointmentId, {
    'Notes Uploaded': { checkbox: true },
    'Notes Filename': { rich_text: [{ text: { content: filename } }] }
  });
}

module.exports = {
  STATUSES,
  NOTES_FOLDER_NAME,
  isValidStatus,
  residentsForLocation,
  residentFullNameFor,
  appointmentsForLocation,
  appointmentById,
  validateAppointmentInput,
  createAppointment,
  updateAppointmentStatus,
  buildNotesFilename,
  recordNotesUploaded
};
