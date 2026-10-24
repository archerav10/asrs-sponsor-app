const { queryDatabaseAll, createPage, updatePage, getPage, getPlainText, queryDatabase } = require('./notion');
const { findAllQuestionRows } = require('./daily-progress-notes');

const { id: configId } = require('./ids');

const MEDICAL_APPOINTMENTS_DB_ID = configId('MEDICAL_APPOINTMENTS_DB_ID');
const MAR_DB_ID = process.env.MAR_DB_ID;

// Every appointment is its own row (an append-only log, never one row
// per type the way Staff Training's per-item rows work) — the screen
// shows the latest of each type, but earlier ones stay on file as the
// resident's medical history.
//
// Stored in Notion's "Appointment Type" select by label, not key, so the
// database reads naturally when browsed directly; the key is only used
// for filenames.
const APPOINTMENT_TYPES = [
  { key: 'Physical', label: 'Physical' },
  { key: 'Dental', label: 'Dental' },
  { key: 'Labwork', label: 'Labwork' },
  { key: 'TBTest', label: 'TB Test' },
  { key: 'Psychiatric', label: 'Psychiatric' },
  { key: 'Endocrinologist', label: 'Endocrinologist' },
  { key: 'Nephrologist', label: 'Nephrologist' },
  { key: 'PhysicalMedicine', label: 'Physical Medicine' },
  { key: 'Urologist', label: 'Urologist' },
  { key: 'Gastrointestinal', label: 'Gastrointestinal' },
  { key: 'Emergency', label: 'Emergency' },
  { key: 'FluShot', label: 'Flu Shot' },
  { key: 'CovidShot', label: 'Covid Shot' },
  { key: 'Cardiologist', label: 'Cardiologist' },
  { key: 'Oncologist', label: 'Oncologist' },
  { key: 'Orthopedic', label: 'Orthopedic' },
  { key: 'PainManagement', label: 'Pain Management' },
  { key: 'CheckUp', label: 'Check-up' }
];

// The four types that count toward the home's compliance status — each
// due 12 months after the last one on file, turning yellow 30 days
// before that. Every other type is history only.
const COMPLIANCE_TYPE_KEYS = ['Physical', 'Dental', 'Labwork', 'TBTest'];
const DUE_SOON_DAYS = 30;

// Planned appointments were added after this database already held a
// long history of admin-logged-with-document rows that predate the
// Status property — appointmentFromPage below treats a blank Status as
// Completed, since every one of those older rows represents something
// that already happened.
const STATUSES = ['Planned', 'Completed', 'Cancelled'];

function isValidStatus(status) {
  return STATUSES.indexOf(status) !== -1;
}

function typeByKey(key) {
  return APPOINTMENT_TYPES.filter(function (t) { return t.key === key; })[0] || null;
}

function typeByLabel(label) {
  return APPOINTMENT_TYPES.filter(function (t) { return t.label === label; })[0] || null;
}

// Same resident source as Annual Planning/Quarterly Reporting — a
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
// source as the Medication Administration Report and Daily Progress
// Note PDFs (the resident's DPN template). Unlike those, this returns ''
// rather than falling back to initials when there's none on file: an
// upload here is interactive, so it's better to stop and tell the admin
// than to send a document the Zap's find-only folder steps can't place.
async function residentFullNameFor(location, resident) {
  const rows = await findAllQuestionRows(location, resident);
  return (rows.length && rows[0].residentFullName) ? rows[0].residentFullName : '';
}

function appointmentFromPage(page) {
  const type = typeByLabel(getPlainText(page.properties['Appointment Type']));
  return {
    id: page.id,
    location: getPlainText(page.properties['Location']),
    resident: getPlainText(page.properties['Resident Initials']),
    typeKey: type ? type.key : '',
    typeLabel: type ? type.label : getPlainText(page.properties['Appointment Type']),
    date: getPlainText(page.properties['Appointment Date']),
    filename: getPlainText(page.properties['Filename']),
    loggedBy: getPlainText(page.properties['Logged By']),
    status: getPlainText(page.properties['Status']) || 'Completed',
    hasNotes: !!getPlainText(page.properties['Has Notes'])
  };
}

// A single appointment by its page ID — used by the admin dashboard to
// attach a document to a row a sponsor already logged (no filename yet),
// rather than creating a duplicate row.
async function appointmentById(appointmentId) {
  return appointmentFromPage(await getPage(appointmentId));
}

// Sets Filename on an existing row once its document has been uploaded.
// Used for the "attach a missing document" flow — createAppointment
// stays the only way a new row gets made. A real document in hand is
// strong enough evidence the visit happened that this also marks the
// row Completed, so a sponsor doesn't have to separately flip it after
// an admin attaches it.
function attachFilename(appointmentId, filename) {
  return updatePage(appointmentId, {
    'Filename': { rich_text: [{ text: { content: filename } }] },
    'Status': { select: { name: 'Completed' } }
  });
}

// Reschedule (date), status, and/or "I have notes" — whichever fields
// are passed. Unlike attachFilename, this is sponsor/admin-facing and
// never touches Filename: editing a Planned appointment doesn't imply a
// document exists yet.
function updateAppointment(appointmentId, fields) {
  const properties = {};
  if (fields.appointmentDate) properties['Appointment Date'] = { date: { start: fields.appointmentDate } };
  if (fields.status) properties['Status'] = { select: { name: fields.status } };
  if (typeof fields.hasNotes === 'boolean') properties['Has Notes'] = { checkbox: fields.hasNotes };
  return updatePage(appointmentId, properties);
}

// Every active appointment for a resident, newest first.
async function appointmentsForResident(location, resident) {
  const pages = await queryDatabaseAll(MEDICAL_APPOINTMENTS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return pages.map(appointmentFromPage)
    .filter(function (a) { return a.date; })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

// One entry per type that has any history at all, in APPOINTMENT_TYPES
// order (so the four compliance types always lead), each with its most
// recent appointment plus every earlier one.
function latestByType(appointments) {
  const byKey = {};
  appointments.forEach(function (a) {
    if (!a.typeKey) return;
    (byKey[a.typeKey] = byKey[a.typeKey] || []).push(a); // already newest-first
  });
  return APPOINTMENT_TYPES.filter(function (t) { return byKey[t.key]; }).map(function (t) {
    return {
      key: t.key,
      label: t.label,
      isCompliance: COMPLIANCE_TYPE_KEYS.indexOf(t.key) !== -1,
      latest: byKey[t.key][0],
      earlier: byKey[t.key].slice(1)
    };
  });
}

function addYearsISO(iso, years) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00Z') - new Date(fromISO + 'T00:00:00Z')) / 86400000);
}

// Green/yellow/red per compliance type, plus the worst of the four as
// the resident's overall status. A compliance type with no appointment
// on file at all reads red ("missing") — there's nothing to show it's
// been done. Only Completed appointments count toward a due date: a
// Planned one hasn't happened yet, so logging a Physical for next month
// shouldn't reset this month's overdue Physical.
function computeMedicalCompliance(appointments, now) {
  const today = (now || new Date()).toISOString().slice(0, 10);
  const latest = {};
  appointments.forEach(function (a) {
    if (COMPLIANCE_TYPE_KEYS.indexOf(a.typeKey) === -1) return;
    if (a.status !== 'Completed') return;
    if (!latest[a.typeKey] || a.date > latest[a.typeKey]) latest[a.typeKey] = a.date;
  });

  const items = COMPLIANCE_TYPE_KEYS.map(function (key) {
    const lastDate = latest[key] || null;
    if (!lastDate) {
      return { key: key, label: typeByKey(key).label, lastDate: null, dueDate: null, status: 'red', state: 'missing' };
    }
    const dueDate = addYearsISO(lastDate, 1);
    const daysUntilDue = daysBetween(today, dueDate);
    let status = 'green';
    let state = 'current';
    if (daysUntilDue < 0) { status = 'red'; state = 'overdue'; }
    else if (daysUntilDue <= DUE_SOON_DAYS) { status = 'yellow'; state = 'dueSoon'; }
    return { key: key, label: typeByKey(key).label, lastDate: lastDate, dueDate: dueDate, status: status, state: state };
  });

  const statuses = items.map(function (i) { return i.status; });
  const overall = statuses.indexOf('red') !== -1 ? 'red' : statuses.indexOf('yellow') !== -1 ? 'yellow' : 'green';
  return { overall: overall, items: items };
}

// Filename convention: "{appointmentDate}_Medical_{typeKey}_{location}_{resident}{ext}"
// — date-first so a resident's Medical Appointments folder sorts
// chronologically in Drive, same idea as the Medication Report's
// year-month prefix.
function buildFilename(appointmentDate, typeKey, location, resident, extension) {
  const sanitize = function (s) { return (s || '').replace(/[^a-zA-Z0-9]+/g, ''); };
  const ext = (extension || '').replace(/[^a-zA-Z0-9.]/g, '');
  return appointmentDate + '_Medical_' + typeKey + '_' + sanitize(location) + '_' + sanitize(resident) + ext;
}

// Shared by the upload-config and save endpoints so the type/date rules
// are checked BEFORE the document goes to Drive, not only after. Returns
// an error message, or '' when the input is usable. A document can only
// be uploaded for an appointment that's already happened; one day of
// slack covers an admin east of UTC late in the evening, whose local
// "today" is already UTC's tomorrow.
function validateAppointmentInput(typeKey, appointmentDate) {
  if (!typeByKey(typeKey)) return 'Choose an appointment type.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate || '')) return 'Choose the appointment date.';
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (appointmentDate > tomorrow) return 'The appointment date can\'t be in the future.';
  return '';
}

// Same type/date checks as validateAppointmentInput, minus the
// future-date rule — used for scheduling (Planned) rather than
// uploading a document for something that already happened.
function validateScheduleInput(typeKey, appointmentDate) {
  if (!typeByKey(typeKey)) return 'Choose an appointment type.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate || '')) return 'Choose the appointment date.';
  return '';
}

async function createAppointment(location, resident, typeKey, appointmentDate, filename, loggedBy, status, hasNotes) {
  const type = typeByKey(typeKey);
  const today = new Date().toISOString().slice(0, 10);
  return createPage(MEDICAL_APPOINTMENTS_DB_ID, {
    'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + type.label + ' - ' + appointmentDate } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Appointment Type': { select: { name: type.label } },
    'Appointment Date': { date: { start: appointmentDate } },
    'Filename': { rich_text: filename ? [{ text: { content: filename } }] : [] },
    'Logged By': { rich_text: [{ text: { content: loggedBy } }] },
    'Logged Date': { date: { start: today } },
    'Active': { checkbox: true },
    'Status': { select: { name: status || 'Completed' } },
    'Has Notes': { checkbox: !!hasNotes }
  });
}

module.exports = {
  APPOINTMENT_TYPES,
  COMPLIANCE_TYPE_KEYS,
  DUE_SOON_DAYS,
  STATUSES,
  isValidStatus,
  typeByKey,
  residentsForLocation,
  residentFullNameFor,
  appointmentById,
  attachFilename,
  updateAppointment,
  appointmentsForResident,
  latestByType,
  computeMedicalCompliance,
  buildFilename,
  validateAppointmentInput,
  validateScheduleInput,
  createAppointment
};
