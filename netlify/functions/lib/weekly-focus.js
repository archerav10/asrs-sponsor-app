const { queryDatabase, queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { getResidentDayWalk } = require('./daily-progress-notes');

const WEEKLY_FOCUS_DB_ID = process.env.WEEKLY_FOCUS_DB_ID;
const RESPONSES_DB_ID = process.env.WEEKLY_FOCUS_RESPONSES_DB_ID;
const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;

// The Sponsored Residential Weekly Focus. Each week is keyed by its
// "Week Of" date — the Tuesday it goes out (America/New_York). Sponsors
// are independent contractors with their own priorities, so there is no
// shared message: each Weekly Focus row names the sponsor(s) it's for
// (the Sponsor relation), and a sponsor only ever gets a row addressed
// to them. Picking several sponsors on one row sends each of them the
// same message, privately. Sending creates one Weekly Focus Responses row
// per sponsor (Status: Pending) that remembers which row they were sent
// (Content ID); the sponsor's check-in then fills it in. Responses are due Thursday;
// a late answer is still taken (and flagged Late) until the next week
// goes out, after which that week is read-only.

const TZ = 'America/New_York';
const STATUSES = ['Green', 'Yellow', 'Red'];

function pad2(n) { return String(n).padStart(2, '0'); }

// Calendar date in Eastern time, as YYYY-MM-DD.
function etDateISO(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date || new Date());
  const get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
  return get('year') + '-' + get('month') + '-' + get('day');
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Hour of day (0-23) in Eastern time.
function etHour(date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(date || new Date()));
}

// The Tuesday on or before the given date — the Week Of for "this week".
function weekOfFor(date) {
  const today = etDateISO(date);
  const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
  return addDaysISO(today, -((dow - 2 + 7) % 7));
}

// Responses are due by the end of Thursday.
function dueDateFor(weekOf) { return addDaysISO(weekOf, 2); }

function formatWeekLabel(weekOf) {
  const d = new Date(weekOf + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function richText(s) {
  // Notion caps a rich_text segment at 2000 characters.
  const content = String(s || '');
  const chunks = [];
  for (let i = 0; i < content.length; i += 2000) chunks.push({ text: { content: content.slice(i, i + 2000) } });
  return { rich_text: chunks };
}

// ---- Content (one row per week) ----

// Notion page IDs come back dashed from the API but undashed elsewhere.
function normId(id) { return String(id || '').replace(/-/g, '').toLowerCase(); }

function contentFromPage(page) {
  const p = page.properties;
  const sponsorIds = ((p['Sponsor'] && p['Sponsor'].relation) || []).map(function (r) { return normId(r.id); });
  const checklist = ['Checklist 1', 'Checklist 2', 'Checklist 3']
    .map(function (k) { return (getPlainText(p[k]) || '').trim(); })
    .filter(Boolean);
  return {
    id: page.id,
    weekOf: getPlainText(p['Week Of']),
    quote: getPlainText(p['Quote']),
    quoteAuthor: getPlainText(p['Quote Author']),
    focusTitle: getPlainText(p['Focus Title']),
    focusMessage: getPlainText(p['Focus Message']),
    checklist: checklist,
    sponsorIds: sponsorIds,
    ready: !!getPlainText(p['Ready to Send']),
    sent: !!getPlainText(p['Sent'])
  };
}

// Every row for a week (one per sponsor, or shared by a few).
async function contentsForWeek(weekOf) {
  const pages = await queryDatabaseAll(WEEKLY_FOCUS_DB_ID, { property: 'Week Of', date: { equals: weekOf } });
  return pages.map(contentFromPage);
}

async function contentById(id) {
  if (!id) return null;
  try {
    return contentFromPage(await getPage(id));
  } catch (e) {
    return null; // deleted since it was sent
  }
}

// The row a given sponsor should get this week: Ready rows addressed to
// them. More than one is a mistake on the Notion side; the first is used
// and the caller reports the duplicate.
function rowsForSponsor(contents, sponsorId) {
  const id = normId(sponsorId);
  return contents.filter(function (c) { return c.ready && c.sponsorIds.indexOf(id) !== -1; });
}

async function contentSince(weekOf) {
  const pages = await queryDatabaseAll(WEEKLY_FOCUS_DB_ID, { property: 'Week Of', date: { on_or_after: weekOf } });
  return pages.map(contentFromPage);
}

async function markContentSent(contentId) {
  await updatePage(contentId, {
    'Sent': { checkbox: true },
    'Sent At': { date: { start: new Date().toISOString() } }
  });
}

// ---- Sponsors ----

function sponsorFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    email: (getPlainText(p['Email']) || '').trim(),
    phone: getPlainText(p['Phone Number']),
    location: getPlainText(p['Location']),
    residentInitials: getPlainText(p['Resident Initials']),
    smsOptedIn: getPlainText(p['SMS Consent Status']) === 'Opted In'
  };
}

// Everyone with sponsor app access gets the Weekly Focus — it's a
// required weekly check-in, so it doesn't follow the routine-notification
// opt-out. Texts only go to sponsors whose SMS Consent Status is Opted In.
async function activeSponsors() {
  const pages = await queryDatabaseAll(SPONSORS_DB_ID, { property: 'Provider App Enabled', checkbox: { equals: true } });
  return pages.map(sponsorFromPage).filter(function (s) { return s.email; });
}

// ---- Daily documentation ----

function parseResidents(residentInitials) {
  return (residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Per resident, how many days before today still have an unsigned Daily
// Progress Note (the same day-walk the Daily Progress Notes screen
// enforces). Today's own note isn't due yet, so it never counts. A
// resident with no notes entered at all reads as notStarted rather than
// "up to date"; a lookup failure reads as unknown rather than failing the
// whole check-in.
async function documentationStatus(location, residentInitials, now) {
  const today = etDateISO(now);
  const residents = parseResidents(residentInitials);
  return Promise.all(residents.map(async function (resident) {
    try {
      const walk = await getResidentDayWalk(location, resident, now);
      const behind = walk.days
        .filter(function (d) { return (!d.cover || !d.cover.signedAt) && d.date < today; })
        .map(function (d) { return d.date; });
      return { resident: resident, notStarted: walk.isFirstEntry, daysBehind: behind.length, oldest: behind[0] || null };
    } catch (e) {
      console.error('Daily Progress Notes status failed for ' + location + '/' + resident, e);
      return { resident: resident, unknown: true, daysBehind: 0, oldest: null };
    }
  }));
}

// Residents needing attention: behind on notes, or never started.
function countDocsBehind(docStatus) {
  return docStatus.filter(function (d) { return d.daysBehind > 0 || d.notStarted; }).length;
}

// ---- Responses (one row per sponsor per week) ----

function parseChecklist(raw) {
  try {
    const items = JSON.parse(raw || '[]');
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

function responseFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    weekOf: getPlainText(p['Week Of']),
    sponsorName: getPlainText(p['Sponsor Name']),
    sponsorEmail: getPlainText(p['Sponsor Email']),
    location: getPlainText(p['Location']),
    status: getPlainText(p['Status']) || 'Pending',
    comment: getPlainText(p['Comment']),
    checklist: parseChecklist(getPlainText(p['Checklist'])),
    docsBehind: getPlainText(p['Docs Behind']) || 0,
    contentId: getPlainText(p['Content ID']),
    respondedAt: getPlainText(p['Responded At']),
    late: !!getPlainText(p['Late']),
    reminderSent: !!getPlainText(p['Reminder Sent']),
    followedUp: !!getPlainText(p['Followed Up']),
    followUpNote: getPlainText(p['Follow-up Note']),
    followedUpBy: getPlainText(p['Followed Up By']),
    followedUpDate: getPlainText(p['Followed Up Date'])
  };
}

function byWeekDesc(a, b) { return a.weekOf < b.weekOf ? 1 : a.weekOf > b.weekOf ? -1 : 0; }

async function responsesForSponsor(email) {
  const pages = await queryDatabaseAll(RESPONSES_DB_ID, { property: 'Sponsor Email', rich_text: { equals: email } });
  return pages.map(responseFromPage).sort(byWeekDesc);
}

async function responsesForWeek(weekOf) {
  const pages = await queryDatabaseAll(RESPONSES_DB_ID, { property: 'Week Of', date: { equals: weekOf } });
  return pages.map(responseFromPage);
}

async function responsesSince(weekOf) {
  const pages = await queryDatabaseAll(RESPONSES_DB_ID, { property: 'Week Of', date: { on_or_after: weekOf } });
  return pages.map(responseFromPage).sort(byWeekDesc);
}

// Open follow-ups from any week: a Yellow or Red answer nobody has marked
// followed up yet. They stay open past the week they came in.
async function openFollowUps() {
  const pages = await queryDatabaseAll(RESPONSES_DB_ID, {
    and: [
      { property: 'Followed Up', checkbox: { equals: false } },
      { or: [
        { property: 'Status', select: { equals: 'Yellow' } },
        { property: 'Status', select: { equals: 'Red' } }
      ] }
    ]
  });
  return pages.map(responseFromPage).sort(byWeekDesc);
}

async function getResponse(id) {
  return responseFromPage(await getPage(id));
}

// This week's items, plus anything left unticked on the sponsor's most
// recent earlier week — carried over with the week it first appeared, so
// "still open since Oct 6" survives more than one carry. An item already
// on this week's list isn't repeated.
function buildChecklist(content, previousResponse) {
  const items = content.checklist.map(function (text) {
    return { text: text, fromWeek: content.weekOf, done: false };
  });
  const seen = new Set(items.map(function (i) { return i.text.toLowerCase(); }));
  (previousResponse ? previousResponse.checklist : []).forEach(function (item) {
    if (item.done || seen.has(String(item.text).toLowerCase())) return;
    seen.add(String(item.text).toLowerCase());
    items.push({ text: item.text, fromWeek: item.fromWeek || previousResponse.weekOf, done: false });
  });
  return items;
}

async function createResponse(sponsor, weekOf, contentId, checklist, docsBehind) {
  const page = await createPage(RESPONSES_DB_ID, {
    'Record Title': { title: [{ text: { content: weekOf + ' - ' + sponsor.name } }] },
    'Week Of': { date: { start: weekOf } },
    'Sponsor Name': richText(sponsor.name),
    'Sponsor Email': richText(sponsor.email),
    'Location': { select: sponsor.location ? { name: sponsor.location } : null },
    'Status': { select: { name: 'Pending' } },
    'Checklist': richText(JSON.stringify(checklist)),
    'Docs Behind': { number: docsBehind },
    'Content ID': richText(contentId)
  });
  return responseFromPage(page);
}

// A week's check-in can still be answered (late, after Thursday) until a
// newer week has gone out to that sponsor.
function isOpen(response, sponsorResponses) {
  return sponsorResponses.length > 0 && sponsorResponses[0].id === response.id;
}

function isLate(weekOf, now) {
  return etDateISO(now) > dueDateFor(weekOf);
}

// doneIndexes: which checklist items the sponsor ticked.
async function saveResponse(response, status, comment, doneIndexes, now) {
  const done = new Set((doneIndexes || []).map(Number));
  const checklist = response.checklist.map(function (item, i) {
    return Object.assign({}, item, { done: done.has(i) });
  });
  const late = isLate(response.weekOf, now);
  await updatePage(response.id, {
    'Status': { select: { name: status } },
    'Comment': richText(comment),
    'Checklist': richText(JSON.stringify(checklist)),
    'Responded At': { date: { start: (now || new Date()).toISOString() } },
    'Late': { checkbox: late }
  });
  return Object.assign({}, response, { status: status, comment: comment, checklist: checklist, late: late });
}

async function markReminderSent(responseId) {
  await updatePage(responseId, { 'Reminder Sent': { checkbox: true } });
}

async function markFollowedUp(responseId, note, by, now) {
  await updatePage(responseId, {
    'Followed Up': { checkbox: true },
    'Follow-up Note': richText(note),
    'Followed Up By': richText(by),
    'Followed Up Date': { date: { start: etDateISO(now) } }
  });
}

module.exports = {
  STATUSES,
  etDateISO,
  etHour,
  addDaysISO,
  weekOfFor,
  dueDateFor,
  formatWeekLabel,
  normId,
  contentsForWeek,
  contentById,
  rowsForSponsor,
  contentSince,
  markContentSent,
  activeSponsors,
  documentationStatus,
  countDocsBehind,
  responsesForSponsor,
  responsesForWeek,
  responsesSince,
  openFollowUps,
  getResponse,
  buildChecklist,
  createResponse,
  isOpen,
  isLate,
  saveResponse,
  markReminderSent,
  markFollowedUp
};
