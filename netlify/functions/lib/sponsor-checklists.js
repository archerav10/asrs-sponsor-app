const { queryDatabase, queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { sendEmail } = require('./email');
const { id: configId } = require('./ids');

const SPONSOR_CHECKLISTS_DB_ID = configId('SPONSOR_CHECKLISTS_DB_ID');
const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;

const STATUSES = ['Open', 'Closed'];

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// A location's one checklist recipient. Most locations have a single
// sponsor on file, which is used directly; a location with more than
// one sponsor/DSP only sends to whichever one is flagged Primary
// Sponsor — returns null (ambiguous) if none of them is flagged.
async function primarySponsorForLocation(location) {
  const result = await queryDatabase(SPONSORS_DB_ID, {
    property: 'Location', rich_text: { equals: location }
  });
  const sponsors = (result.results || []).map(function (page) {
    return {
      name: getPlainText(page.properties['Name']),
      email: getPlainText(page.properties['Email']),
      primary: !!getPlainText(page.properties['Primary Sponsor'])
    };
  }).filter(function (s) { return s.email; });

  if (sponsors.length === 0) return null;
  if (sponsors.length === 1) return sponsors[0];
  return sponsors.filter(function (s) { return s.primary; })[0] || null;
}

function checklistFromPage(page) {
  return {
    id: page.id,
    location: getPlainText(page.properties['Location']),
    title: getPlainText(page.properties['Record Title']),
    driveLink: getPlainText(page.properties['Drive Link']),
    dueDate: getPlainText(page.properties['Due Date']),
    message: getPlainText(page.properties['Message']),
    status: getPlainText(page.properties['Status']) || 'Open',
    sponsorName: getPlainText(page.properties['Sponsor Name']),
    sponsorEmail: getPlainText(page.properties['Sponsor Email']),
    createdByEmail: getPlainText(page.properties['Created By Email']),
    createdByName: getPlainText(page.properties['Created By Name']),
    createdDate: getPlainText(page.properties['Created Date']),
    closedDate: getPlainText(page.properties['Closed Date'])
  };
}

async function checklistById(checklistId) {
  return checklistFromPage(await getPage(checklistId));
}

// Every checklist (any status) at the admin's granted locations.
async function checklistsForLocations(locations) {
  if (!locations.length) return [];
  const pages = await queryDatabaseAll(SPONSOR_CHECKLISTS_DB_ID, {
    or: locations.map(function (l) { return { property: 'Location', select: { equals: l } }; })
  });
  return pages.map(checklistFromPage);
}

function checklistEmailBody(title, message, dueDate, driveLink) {
  const lines = [message, '', 'Please complete all items by ' + dueDate + '.', '', 'Checklist: ' + driveLink];
  return lines.join('\n');
}

async function createChecklist(location, title, message, dueDate, driveLink, createdByEmail, createdByName) {
  const sponsor = await primarySponsorForLocation(location);
  if (!sponsor) {
    throw httpError(400, 'No single sponsor could be determined for ' + location + '. Mark one sponsor there as the Primary Sponsor and try again.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const page = await createPage(SPONSOR_CHECKLISTS_DB_ID, {
    'Record Title': { title: [{ text: { content: title } }] },
    'Location': { select: { name: location } },
    'Drive Link': { url: driveLink },
    'Due Date': { date: { start: dueDate } },
    'Message': { rich_text: [{ text: { content: message } }] },
    'Status': { select: { name: 'Open' } },
    'Sponsor Name': { rich_text: [{ text: { content: sponsor.name } }] },
    'Sponsor Email': { rich_text: [{ text: { content: sponsor.email } }] },
    'Created By Email': { rich_text: [{ text: { content: createdByEmail } }] },
    'Created By Name': { rich_text: [{ text: { content: createdByName } }] },
    'Created Date': { date: { start: today } }
  });

  await sendEmail(sponsor.email, sponsor.name, title, checklistEmailBody(title, message, dueDate, driveLink));
  return checklistFromPage(page);
}

async function sendReminder(checklistId) {
  const checklist = await checklistById(checklistId);
  await sendEmail(checklist.sponsorEmail, checklist.sponsorName, 'Reminder: ' + checklist.title,
    checklistEmailBody(checklist.title, checklist.message, checklist.dueDate, checklist.driveLink));
  return checklist;
}

// Only the admin who created a checklist may close it — enforced here,
// server-side, since the dashboard only hides the button for everyone
// else.
async function closeChecklist(checklistId, byEmail) {
  const checklist = await checklistById(checklistId);
  if (checklist.createdByEmail.trim().toLowerCase() !== (byEmail || '').trim().toLowerCase()) {
    throw httpError(403, 'Only ' + checklist.createdByName + ', who created this checklist, can close it.');
  }
  const today = new Date().toISOString().slice(0, 10);
  await updatePage(checklistId, {
    'Status': { select: { name: 'Closed' } },
    'Closed Date': { date: { start: today } }
  });
  return checklistById(checklistId);
}

module.exports = {
  STATUSES,
  httpError,
  primarySponsorForLocation,
  checklistById,
  checklistsForLocations,
  createChecklist,
  sendReminder,
  closeChecklist
};
