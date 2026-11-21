const { queryDatabase, queryDatabaseAll, updatePage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');
const ma = require('./medication-administration');

// Compliance lights for the daily records (lib/compliance.js adds them):
//
//   Daily Progress Notes        a day counts once its note is signed
//   Medication Administration   a day counts once every scheduled dose
//                               (each Regular medication's times of day in
//                               effect that day) has an entry: Given,
//                               Refused or Held
//   Resident Q&A (admin only)   the Liaison app's resident interview
//                               questionnaire, each resident, each month
//
// Notes and MAR start counting on the location's go-live date (Location
// Access Codes > "DPN MAR Go-Live", set on the admin Compliance tab);
// before it, or with none set, they read "Not started" (status "off",
// left out of the overall light). Rules, for each resident:
//   red     a day missed in the 30 days before the last completed day, or
//           nothing completed for 3+ days (or since go-live, 3+ days ago)
//   yellow  the last completed day was 2 days ago
//   green   today or yesterday done, nothing missed
// Resident Q&A: red if any of the previous 3 calendar months has no
// completed Q&A; yellow if those are done but this month's isn't yet.

const LOCATIONS_DB = configId('LOCATION_CODES_DB_ID');
const NOTES_DB = configId('DAILY_PROGRESS_NOTES_DB_ID');
const LOG_DB = process.env.MEDICATION_ADMIN_LOG_DB_ID;
const RESPONSES_DB = configId('QUESTIONNAIRE_RESPONSES_DB_ID');
const WINDOW = 30;
const LOOKBACK = WINDOW + 45; // days of records read (enough to find the last completed day and its window)

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function fmt(iso) { return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; }
function short(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }); }
function monthName(m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }

// ---------- go-live ----------

async function goLiveFor(location) {
  const r = await queryDatabase(LOCATIONS_DB, { property: 'Location', title: { equals: location } });
  const page = (r.results || [])[0];
  return { pageId: page ? page.id : null, goLive: page ? getPlainText(page.properties['DPN MAR Go-Live']) : '' };
}

async function setGoLive(location, date) {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Choose a valid go-live date.'), { statusCode: 400 });
  const g = await goLiveFor(location);
  if (!g.pageId) throw Object.assign(new Error(location + ' isn\'t in Location Access Codes.'), { statusCode: 404 });
  await updatePage(g.pageId, { 'DPN MAR Go-Live': { date: date ? { start: date } : null } });
  return { location: location, goLive: date || '' };
}

// ---------- the shared rule ----------

// done(date) -> true when that day is complete. Days before `start` don't count.
function judge(start, today, done) {
  if (!start || today < start) return null;
  let last = '';
  for (let d = today; d >= start; d = addDays(d, -1)) { if (done(d)) { last = d; break; } }
  const missed = [];
  if (last) {
    for (let d = addDays(last, -WINDOW); d < last; d = addDays(d, 1)) { if (d >= start && !done(d)) missed.push(d); }
  }
  const since = last ? daysBetween(last, today) : daysBetween(addDays(start, -1), today);
  let status = 'green';
  if (missed.length || since >= 3) status = 'red';
  else if (since === 2) status = 'yellow';
  let text = last ? 'last completed ' + fmt(last) : 'none completed since go-live ' + fmt(start);
  if (missed.length) text += '; missed ' + missed.length + ' day' + (missed.length === 1 ? '' : 's') + ' in the 30 days before (' + missed.slice(0, 6).map(short).join(', ') + (missed.length > 6 ? ', …' : '') + ')';
  else if (last) text += '; none missed in the 30 days before';
  // Days after the last completed one, up to yesterday, still owed.
  if (last && since >= 2) text += '; not done yet: ' + (since === 2 ? short(addDays(last, 1)) : short(addDays(last, 1)) + '–' + short(addDays(today, -1)));
  return { status: status, text: text, last: last, missed: missed };
}

function offArea(key, label, goLive) {
  return { key: key, label: label, status: 'off', summary: goLive ? 'Starts ' + fmt(goLive) + ' (go-live)' : 'Not started (no go-live date set)', details: [] };
}

// ---------- Daily Progress Notes ----------

async function signedNoteDays(location, resident, from) {
  const pages = await queryDatabaseAll(NOTES_DB, { and: [
    { property: 'Location', select: { equals: location } },
    { property: 'Resident Initials', rich_text: { equals: resident } },
    { property: 'Active', checkbox: { equals: true } },
    { property: 'Date', date: { on_or_after: from } }
  ] });
  const set = new Set();
  pages.forEach(function (p) { if (getPlainText(p.properties['Signed At'])) set.add(getPlainText(p.properties['Date'])); });
  return set;
}

async function dpnDetails(location, residents, goLive, today) {
  const from = addDays(today, -LOOKBACK) > goLive ? addDays(today, -LOOKBACK) : goLive;
  return Promise.all(residents.map(async function (resident) {
    const signed = await signedNoteDays(location, resident, from);
    const j = judge(goLive, today, function (d) { return signed.has(d); });
    return { label: resident, status: j.status, text: j.text };
  }));
}

// ---------- Medication Administration ----------

async function doseLogs(location, resident, from, to) {
  const pages = await queryDatabaseAll(LOG_DB, { and: [
    { property: 'Location', select: { equals: location } },
    { property: 'Resident Initials', rich_text: { equals: resident } },
    { property: 'Active', checkbox: { equals: true } },
    { property: 'Date', date: { on_or_after: from } },
    { property: 'Date', date: { on_or_before: to } }
  ] });
  return pages.map(function (p) { return { date: getPlainText(p.properties['Date']), timeOfDay: getPlainText(p.properties['Time of Day']), itemName: getPlainText(p.properties['Item Name']), status: getPlainText(p.properties['Status']) }; });
}

async function marDetails(location, residents, goLive, today) {
  const from = addDays(today, -LOOKBACK) > goLive ? addDays(today, -LOOKBACK) : goLive;
  return Promise.all(residents.map(async function (resident) {
    const [meds, logs] = await Promise.all([ma.fetchMedicationsRaw(location, resident), doseLogs(location, resident, from, today)]);
    const byDate = {};
    logs.forEach(function (l) { (byDate[l.date] = byDate[l.date] || []).push(l); });
    const done = function (d) {
      const expected = ma.medicationsInEffectOn(meds, d).filter(function (m) { return m.medicationType === 'Regular'; });
      const slots = ma.expectedSlotsForMedications(expected);
      return ma.isDayComplete(slots, byDate[d] || []);
    };
    const j = judge(goLive, today, done);
    const anyScheduled = ma.expectedSlotsForMedications(ma.medicationsInEffectOn(meds, today).filter(function (m) { return m.medicationType === 'Regular'; })).length > 0;
    return { label: resident, status: j.status, text: anyScheduled ? j.text : 'no scheduled doses on file (PRN only or none)' };
  }));
}

// ---------- Resident Q&A ----------

async function qaDetails(location, residents, today) {
  const pages = await queryDatabaseAll(RESPONSES_DB, { and: [
    { property: 'Location', select: { equals: location } },
    { property: 'Audience', select: { equals: 'Resident' } },
    { property: 'Active', checkbox: { equals: true } }
  ] });
  const rows = pages.map(function (p) { return { resident: getPlainText(p.properties['Resident Initials']), date: String(getPlainText(p.properties['Submitted At']) || '').slice(0, 10) }; }).filter(function (r) { return r.date; });
  const thisMonth = today.slice(0, 7);
  const prev = [1, 2, 3].map(function (n) { const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 - n, 1)); return d.toISOString().slice(0, 7); });
  return residents.map(function (resident) {
    const mine = rows.filter(function (r) { return r.resident.toLowerCase() === resident.toLowerCase(); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    const months = new Set(mine.map(function (r) { return r.date.slice(0, 7); }));
    const missing = prev.filter(function (m) { return !months.has(m); });
    const last = mine[0] ? 'last completed ' + fmt(mine[0].date) : 'none on file';
    if (missing.length) return { label: resident, status: 'red', text: last + '; none in ' + missing.reverse().map(monthName).join(', ') };
    if (!months.has(thisMonth)) return { label: resident, status: 'yellow', text: last + '; ' + monthName(thisMonth) + ' not done yet' };
    return { label: resident, status: 'green', text: last };
  });
}

// Per day, whether the MAR was complete: { done(date), logs, meds }.
async function marDayChecker(location, resident, from, to) {
  const [meds, logs] = await Promise.all([ma.fetchMedicationsRaw(location, resident), doseLogs(location, resident, from, to)]);
  const byDate = {};
  logs.forEach(function (l) { (byDate[l.date] = byDate[l.date] || []).push(l); });
  return {
    logs: logs,
    scheduled: function (d) { return ma.expectedSlotsForMedications(ma.medicationsInEffectOn(meds, d).filter(function (m) { return m.medicationType === 'Regular'; })).length; },
    done: function (d) {
      const slots = ma.expectedSlotsForMedications(ma.medicationsInEffectOn(meds, d).filter(function (m) { return m.medicationType === 'Regular'; }));
      return ma.isDayComplete(slots, byDate[d] || []);
    }
  };
}

module.exports = { goLiveFor, setGoLive, judge, offArea, dpnDetails, marDetails, qaDetails, addDays, signedNoteDays, doseLogs, marDayChecker };
