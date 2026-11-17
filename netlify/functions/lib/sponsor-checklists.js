const crypto = require('crypto');
const { queryDatabase, queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { sendEmail } = require('./email');
const { sendSms, normalizePhone } = require('./twilio');
const { adminsWithRole } = require('./roles');
const drive = require('./google-drive');
const { id: configId } = require('./ids');

const SPONSOR_CHECKLISTS_DB_ID = configId('SPONSOR_CHECKLISTS_DB_ID');
const ITEMS_DB_ID = configId('SPONSOR_CHECKLIST_ITEMS_DB_ID');
const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const TIME_ZONE = 'America/New_York';

const STATUSES = ['Open', 'Closed'];
const MAX_ITEMS = 100;

// Sponsor checklists: an admin sends a location's checklist recipient a
// list of action items to work through on their phone.
//
//   The items come from the first column of a Google Sheet the admin
//   builds (the checklist itself is still edited in Sheets, outside the
//   app), read once when the checklist is sent and saved one row per item
//   in Sponsor Checklist Items.
//   The recipient gets a private link (/checklist/?t=…) by text when they
//   have a phone number and SMS Consent Status = Opted In on the Sponsors
//   table, otherwise by email. The page saves each item as they go;
//   Submit texts the admin who sent it and the location's Residential
//   Liaison(s). Closing it texts the recipient that it's complete.
//   Reminders only go out when an admin clicks Send reminder.
//
// Checklists sent before this (a Sheet link by email, no items) keep
// working the old way: Open checklist opens the Sheet, and reminders
// email the Sheet link.

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

function usDate(iso) {
  const p = (iso || '').slice(0, 10).split('-');
  return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) + '/' + p[0] : (iso || '');
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function richText(s) {
  return { rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] };
}

// A location's one checklist recipient: the only sponsor/DSP on file there,
// or, with more than one, whichever has Primary Sponsor checked (the group
// home's house manager at Longstreet). null when it's ambiguous.
async function primarySponsorForLocation(location) {
  const result = await queryDatabase(SPONSORS_DB_ID, {
    property: 'Location', rich_text: { equals: location }
  });
  const sponsors = (result.results || []).map(function (page) {
    return {
      name: getPlainText(page.properties['Name']),
      email: getPlainText(page.properties['Email']),
      phone: getPlainText(page.properties['Phone Number']),
      smsConsent: getPlainText(page.properties['SMS Consent Status']),
      primary: !!getPlainText(page.properties['Primary Sponsor'])
    };
  }).filter(function (s) { return s.email || s.phone; });

  if (sponsors.length === 0) return null;
  if (sponsors.length === 1) return sponsors[0];
  return sponsors.filter(function (s) { return s.primary; })[0] || null;
}

function checklistFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    location: getPlainText(p['Location']),
    title: getPlainText(p['Record Title']),
    driveLink: getPlainText(p['Drive Link']),
    dueDate: getPlainText(p['Due Date']),
    message: getPlainText(p['Message']),
    status: getPlainText(p['Status']) || 'Open',
    sponsorName: getPlainText(p['Sponsor Name']),
    sponsorEmail: getPlainText(p['Sponsor Email']),
    sponsorPhone: getPlainText(p['Sponsor Phone']),
    sentVia: getPlainText(p['Sent Via']) || 'Email',
    submittedDate: getPlainText(p['Submitted Date']),
    createdByEmail: getPlainText(p['Created By Email']),
    createdByName: getPlainText(p['Created By Name']),
    createdDate: getPlainText(p['Created Date']),
    closedDate: getPlainText(p['Closed Date']),
    closedBy: getPlainText(p['Closed By'])
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

function itemFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    item: getPlainText(p['Item']),
    order: getPlainText(p['Order']) || 0,
    done: !!getPlainText(p['Done']),
    date: getPlainText(p['Done Date']) || '',
    notes: getPlainText(p['Notes']) || ''
  };
}

function sameId(a, b) {
  return (a || '').replace(/-/g, '').toLowerCase() === (b || '').replace(/-/g, '').toLowerCase();
}

async function itemsFor(checklistId) {
  const pages = await queryDatabaseAll(ITEMS_DB_ID, { property: 'Checklist ID', rich_text: { equals: checklistId } });
  return pages.map(itemFromPage).sort(function (a, b) { return a.order - b.order; });
}

function progress(items) {
  return { total: items.length, done: items.filter(function (i) { return i.done; }).length, notes: items.filter(function (i) { return i.notes; }).length };
}

// ---------- reading the items from the Sheet ----------

function sheetIdFromLink(link) {
  const m = (link || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

// Minimal CSV parser (quoted fields, doubled quotes, newlines in quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The action items: the first column of the Sheet's first tab, one per
// non-empty row, below the header row ("Action Item", "Item", "Task"…, or
// a row with a column headed "Done") when there is one in the first 10
// rows, so a title or due-date line above the header is skipped too.
// Other columns (Owner, Done, Date, Notes…) aren't read: the phone page
// collects Done, the date and notes itself.
const HEADER_RE = /^\s*(action\s*items?|items?|tasks?|to\s*dos?|checklist(\s*items?)?)\s*$/i;

function isHeaderRow(row) {
  return HEADER_RE.test(row[0] || '') || row.slice(1).some(function (c) { return /^\s*done\s*\??\s*$/i.test(c || ''); });
}

function itemsFromCsv(text) {
  const rows = parseCsv(text || '');
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (isHeaderRow(rows[i])) { start = i + 1; break; }
  }
  return rows.slice(start)
    .map(function (r) { return (r[0] || '').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
}

async function itemsFromSheet(driveLink) {
  const fileId = sheetIdFromLink(driveLink);
  if (!fileId) throw httpError(400, 'Paste the link to a Google Sheet (it starts with https://docs.google.com/spreadsheets/).');
  let csv;
  try {
    csv = await drive.sheetCsv(fileId);
  } catch (e) {
    if (e.statusCode === 400) throw e;
    throw httpError(400, 'Couldn\'t read that Google Sheet. Make sure it\'s in the ASRS Google Drive (or shared with it).');
  }
  const items = itemsFromCsv(csv);
  if (!items.length) throw httpError(400, 'That Sheet has no action items. Put one item per row in the first column.');
  if (items.length > MAX_ITEMS) throw httpError(400, 'That Sheet has ' + items.length + ' items; the most a checklist can have is ' + MAX_ITEMS + '.');
  return items;
}

// ---------- private links ----------
// /checklist/?t={checklistId}_{sig}: sig is a short HMAC, so the link only
// opens that one checklist and can't be guessed or altered.
function signature(checklistId) {
  return crypto.createHmac('sha256', Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'hex'))
    .update('sponsor-checklist:' + checklistId.replace(/-/g, '').toLowerCase())
    .digest('hex').slice(0, 16);
}

function tokenFor(checklistId) {
  return checklistId.replace(/-/g, '').toLowerCase() + '_' + signature(checklistId);
}

function checklistIdFromToken(token) {
  const m = (token || '').match(/^([0-9a-f]{32})_([0-9a-f]{16})$/);
  if (!m) return null;
  if (!crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(signature(m[1])))) return null;
  return m[1].slice(0, 8) + '-' + m[1].slice(8, 12) + '-' + m[1].slice(12, 16) + '-' + m[1].slice(16, 20) + '-' + m[1].slice(20);
}

function siteBase(site) {
  return (site || process.env.URL || 'https://asrs-sponsor-app.netlify.app').replace(/\/+$/, '');
}

function linkFor(checklistId, site) {
  return siteBase(site) + '/checklist/?t=' + tokenFor(checklistId);
}

// ---------- messages ----------

function canText(person) {
  return !!normalizePhone(person.phone) && person.smsConsent === 'Opted In';
}

// Sends the recipient a message: by text when the checklist went out by
// text, else by email. `kind`: new, reminder, closed.
async function notifyRecipient(checklist, kind, site) {
  const link = linkFor(checklist.id, site);
  const legacy = !checklist.hasItems;
  const due = usDate(checklist.dueDate);
  if (checklist.sentVia === 'Text' && normalizePhone(checklist.sponsorPhone)) {
    const text = kind === 'closed'
      ? 'ASRS: Thanks, ' + firstName(checklist.sponsorName) + '. "' + checklist.title + '" is complete. No further action needed.'
      : (kind === 'reminder' ? 'ASRS reminder: ' : 'ASRS checklist for ' + checklist.location + ': ') + '"' + checklist.title + '", due ' + due +
        '. Open it here to check items off: ' + link + ' Reply STOP to opt out.';
    await sendSms(normalizePhone(checklist.sponsorPhone), text);
    return 'Text';
  }
  if (!checklist.sponsorEmail) throw httpError(400, checklist.sponsorName + ' has no email, and texts aren\'t set up for them.');
  const subject = kind === 'closed' ? 'Complete: ' + checklist.title : (kind === 'reminder' ? 'Reminder: ' : '') + checklist.title;
  const body = kind === 'closed'
    ? 'Thank you. "' + checklist.title + '" is complete. No further action is needed.'
    : [checklist.message, '', 'Please complete all items by ' + due + '.', '', 'Checklist: ' + (legacy ? checklist.driveLink : link)].join('\n');
  await sendEmail(checklist.sponsorEmail, checklist.sponsorName, subject, body);
  return 'Email';
}

async function adminByEmail(email) {
  const want = (email || '').trim().toLowerCase();
  if (!want) return null;
  const r = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, null);
  const page = (r.results || []).find(function (pg) { return getPlainText(pg.properties['Email']).trim().toLowerCase() === want; });
  return page ? { name: getPlainText(page.properties['Name']), phone: getPlainText(page.properties['Phone Number']) } : null;
}

// The admin who sent it and the location's Residential Liaison(s), one
// text per phone number.
async function staffToNotify(checklist) {
  const people = [];
  const creator = await adminByEmail(checklist.createdByEmail).catch(function () { return null; });
  if (creator) people.push(creator);
  (await adminsWithRole('Residential Liaison', checklist.location).catch(function () { return []; })).forEach(function (a) { people.push(a); });
  const seen = {};
  return people.filter(function (p) {
    const phone = normalizePhone(p.phone);
    if (!phone || seen[phone]) return false;
    seen[phone] = true;
    return true;
  });
}

// ---------- actions ----------

async function createChecklist(location, title, message, dueDate, driveLink, createdByEmail, createdByName, site) {
  const sponsor = await primarySponsorForLocation(location);
  if (!sponsor) {
    throw httpError(400, 'No single checklist recipient could be determined for ' + location + '. Check Primary Sponsor on one person there in the Sponsors table and try again.');
  }
  const items = await itemsFromSheet(driveLink);
  const viaText = canText(sponsor);
  if (!viaText && !sponsor.email) throw httpError(400, sponsor.name + ' has no email, and isn\'t opted in to texts. Add one in the Sponsors table first.');

  const page = await createPage(SPONSOR_CHECKLISTS_DB_ID, {
    'Record Title': { title: [{ text: { content: title } }] },
    'Location': { select: { name: location } },
    'Drive Link': { url: driveLink },
    'Due Date': { date: { start: dueDate } },
    'Message': richText(message),
    'Status': { select: { name: 'Open' } },
    'Sponsor Name': richText(sponsor.name),
    'Sponsor Email': richText(sponsor.email),
    'Sponsor Phone': richText(viaText ? normalizePhone(sponsor.phone) : ''),
    'Sent Via': { select: { name: viaText ? 'Text' : 'Email' } },
    'Created By Email': richText(createdByEmail),
    'Created By Name': richText(createdByName),
    'Created Date': { date: { start: todayIso() } }
  });
  for (let i = 0; i < items.length; i++) {
    await createPage(ITEMS_DB_ID, {
      'Item': { title: [{ text: { content: items[i].slice(0, 2000) } }] },
      'Checklist ID': richText(page.id),
      'Order': { number: i + 1 },
      'Done': { checkbox: false }
    });
  }

  const checklist = Object.assign(checklistFromPage(page), { hasItems: true });
  await notifyRecipient(checklist, 'new', site);
  return checklist;
}

async function sendReminder(checklistId, site) {
  const checklist = await checklistById(checklistId);
  if (checklist.status !== 'Open') throw httpError(400, 'That checklist is closed.');
  checklist.hasItems = (await itemsFor(checklist.id)).length > 0;
  const via = await notifyRecipient(checklist, 'reminder', site);
  return { checklist: checklist, via: via };
}

// Anyone with access to the location can close a checklist; who did it is
// recorded. The recipient gets a "complete" message.
async function closeChecklist(checklistId, byName, site) {
  const checklist = await checklistById(checklistId);
  if (checklist.status !== 'Open') throw httpError(400, 'That checklist is already closed.');
  await updatePage(checklistId, {
    'Status': { select: { name: 'Closed' } },
    'Closed Date': { date: { start: todayIso() } },
    'Closed By': richText(byName)
  });
  checklist.hasItems = (await itemsFor(checklist.id)).length > 0;
  let notified = '';
  try {
    notified = await notifyRecipient(checklist, 'closed', site);
  } catch (e) {
    console.error('Checklist closed, but the recipient couldn\'t be told', e);
  }
  return { checklist: await checklistById(checklistId), notified: notified };
}

// ---------- the recipient's page ----------

async function publicView(token) {
  const id = checklistIdFromToken(token);
  if (!id) throw httpError(404, 'This checklist link isn\'t valid.');
  const checklist = await checklistById(id);
  const items = await itemsFor(id);
  return {
    title: checklist.title,
    location: checklist.location,
    dueDate: checklist.dueDate,
    message: checklist.message,
    recipient: firstName(checklist.sponsorName),
    status: checklist.status,
    submittedDate: checklist.submittedDate,
    driveLink: items.length ? '' : checklist.driveLink,
    items: items.map(function (i) { return { id: i.id, item: i.item, done: i.done, date: i.date, notes: i.notes }; })
  };
}

async function openChecklistForToken(token) {
  const id = checklistIdFromToken(token);
  if (!id) throw httpError(404, 'This checklist link isn\'t valid.');
  const checklist = await checklistById(id);
  if (checklist.status !== 'Open') throw httpError(409, 'This checklist has been closed, so it can\'t be changed.');
  return checklist;
}

async function saveItem(token, itemId, fields) {
  const checklist = await openChecklistForToken(token);
  const page = await getPage(itemId);
  if (!sameId(getPlainText(page.properties['Checklist ID']), checklist.id)) throw httpError(403, 'That item isn\'t on this checklist.');
  const done = !!fields.done;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fields.date || '') ? fields.date : (done ? todayIso() : '');
  await updatePage(itemId, {
    'Done': { checkbox: done },
    'Done Date': { date: date ? { start: date } : null },
    'Notes': richText(String(fields.notes || '').slice(0, 2000)),
    'Last Updated': { date: { start: todayIso() } }
  });
  return { done: done, date: date };
}

async function submit(token) {
  const checklist = await openChecklistForToken(token);
  const items = await itemsFor(checklist.id);
  await updatePage(checklist.id, { 'Submitted Date': { date: { start: todayIso() } } });
  const p = progress(items);
  const text = 'ASRS: ' + checklist.sponsorName + ' submitted "' + checklist.title + '" for ' + checklist.location + ' (' + p.done + ' of ' + p.total + ' done' +
    (p.notes ? ', ' + p.notes + ' note' + (p.notes === 1 ? '' : 's') : '') + '). Review it in the admin dashboard, Checklists tab.';
  const staff = await staffToNotify(checklist);
  for (const person of staff) {
    try { await sendSms(normalizePhone(person.phone), text); } catch (e) { console.error('Checklist submit text failed for ' + person.name, e); }
  }
  return { progress: p, notified: staff.length };
}

module.exports = {
  STATUSES,
  httpError,
  primarySponsorForLocation,
  checklistById,
  checklistsForLocations,
  itemsFor,
  progress,
  itemsFromCsv,
  tokenFor,
  checklistIdFromToken,
  linkFor,
  createChecklist,
  sendReminder,
  closeChecklist,
  publicView,
  saveItem,
  submit
};
