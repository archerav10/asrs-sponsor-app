const { queryDatabase, queryDatabaseAll, updatePage, createPage, getPlainText, getPage, driveFolderIdFromUrl } = require('./notion');
const { id: configId } = require('./ids');
const driveDocs = require('./drive-documents');

const STAFF_TRAINING_DB_ID = configId('STAFF_TRAINING_DB_ID');
const ASRS_PEOPLE_DB_ID = configId('ASRS_PEOPLE_DB_ID');

// The checklist itself (ASRS-450-01) lives in Notion, not in code, so it
// can be edited without a deploy — the same idea as Sponsor Intake's
// Intake Steps. One row per required item: Label, Key, Part, Section,
// Applies To (roles), Renews, Order, Active, optional Form Link, and
// optional Sponsor Intake Steps / DSP Intake Steps (the intake step Keys
// that satisfy the item, used by copyFromIntake). Progress
// rows in Staff Training Items are keyed by each requirement's Key, which
// is why a Key must never change once used — rename the Label instead.
const REQUIREMENTS_DB_ID = configId('TRAINING_REQUIREMENTS_DB_ID');
const REQUIREMENTS_TTL_MS = 30 * 1000;

// Unlike Annual Planning or MAR Review, this process has no shared cycle
// date and no finalize step — each item renews on its own schedule.
// Puzzle turns yellow + starts spinning this many days before the
// earliest upcoming due date.
const WINDOW_DAYS_BEFORE_DUE = 30;

// A person's Role (ASRS People) decides which requirements apply to them.
// House Managers are DSPs. Someone with no Role yet is treated as a DSP —
// the dashboard flags them so an admin sets it.
const ROLES = ['Sponsor', 'DSP', 'Secondary DSP'];
const DEFAULT_ROLE = 'DSP';

// Report order: annual items first, intake (which rarely changes) second.
const PARTS = ['Annual training & certification', 'Intake'];
const RENEW_YEARS = { 'One-time': 0, '1 year': 1, '2 years': 2 };
// Keys end up in filenames split on "_", so letters and numbers only.
const KEY_RE = /^[A-Za-z0-9]+$/;
// Last Updated By prefix on rows copied from an intake (Sponsor or DSP).
const INTAKE_SOURCE = 'Intake';
const INTAKE_NA = INTAKE_SOURCE + ': Not Applicable';

let requirementsCache = null;

// Loads and validates the checklist. A bad row never breaks the app: it
// is skipped and described in `problems`, which the Staff Training tab
// shows so whoever edited Notion can fix it. Cached for 30s per function
// instance; admin pages pass { fresh: true } so an edit shows up on the
// next reload.
async function loadRequirements(options) {
  options = options || {};
  if (!options.fresh && requirementsCache && Date.now() - requirementsCache.at < REQUIREMENTS_TTL_MS) {
    return requirementsCache.value;
  }

  const pages = await queryDatabaseAll(REQUIREMENTS_DB_ID);
  const problems = [];
  const requirements = [];
  const byKey = {};

  pages.forEach(function (page) {
    const p = page.properties;
    if (!p['Active'] || !p['Active'].checkbox) return;
    const label = getPlainText(p['Label']);
    const key = (getPlainText(p['Key']) || '').trim();
    const name = '"' + (label || key || '(untitled)') + '"';
    if (!label || !key) return problems.push('Item ' + name + ' skipped: it needs both a Label and a Key.');
    if (!KEY_RE.test(key)) return problems.push('Item ' + name + ' skipped: Key "' + key + '" can only use letters and numbers.');
    if (byKey[key]) return problems.push('Item ' + name + ' skipped: Key ' + key + ' is already used by "' + byKey[key].label + '".');

    const part = getPlainText(p['Part']);
    if (PARTS.indexOf(part) === -1) return problems.push('Item ' + name + ' skipped: choose a Part.');
    const renews = getPlainText(p['Renews']);
    if (!(renews in RENEW_YEARS)) return problems.push('Item ' + name + ' skipped: choose how often it Renews.');
    const appliesTo = ((p['Applies To'] && p['Applies To'].multi_select) || [])
      .map(function (o) { return o.name; })
      .filter(function (r) { return ROLES.indexOf(r) !== -1; });
    if (!appliesTo.length) return problems.push('Item ' + name + ' skipped: choose who it Applies To.');

    const order = getPlainText(p['Order']);
    const formUrl = getPlainText(p['Form Link']) || '';
    const req = {
      key: key,
      label: label,
      part: part,
      section: getPlainText(p['Section']) || 'Other',
      appliesTo: appliesTo,
      renewYears: RENEW_YEARS[renews],
      order: typeof order === 'number' ? order : 9999,
      formUrl: /^https?:\/\//i.test(formUrl) ? formUrl : '',
      intakeSteps: {
        Sponsor: keyList(getPlainText(p['Sponsor Intake Steps'])),
        DSP: keyList(getPlainText(p['DSP Intake Steps']))
      }
    };
    byKey[key] = req;
    requirements.push(req);
  });

  requirements.sort(function (a, b) {
    return (PARTS.indexOf(a.part) - PARTS.indexOf(b.part)) || (a.order - b.order) || a.label.localeCompare(b.label);
  });

  const value = { requirements: requirements, byKey: byKey, problems: problems };
  requirementsCache = { at: Date.now(), value: value };
  return value;
}

function keyList(text) {
  return (text || '').split(',').map(function (k) { return k.trim(); }).filter(Boolean);
}

// Which intake checklist a role goes through: Sponsors the Sponsor intake,
// DSPs and Secondary DSPs the DSP intake.
function intakeProcessForRole(role) {
  return effectiveRole(role) === 'Sponsor' ? 'Sponsor' : 'DSP';
}

function effectiveRole(role) {
  return ROLES.indexOf(role) !== -1 ? role : DEFAULT_ROLE;
}

function requirementsForRole(requirements, role) {
  const r = effectiveRole(role);
  return requirements.filter(function (req) { return req.appliesTo.indexOf(r) !== -1; });
}

function sanitizeForFilename(s) { return (s || '').replace(/[^a-zA-Z0-9]+/g, ''); }

// Filename convention: "{location}_Staff_{staffId}_{key}_{completedDate}".
// Uses the staff member's ASRS People page ID rather than their name —
// unlike resident initials or the fixed SERVICES enum in
// lib/annual-planning.js, a full name ("Ovetis Cooper") loses
// information once sanitizeForFilename strips its spaces, so it can't
// be parsed back unambiguously. The page ID has no such problem and is
// the only channel available when a document reaches Drive through a
// form's own native "save to Drive" integration. (Files from before the
// checklist moved to Notion carry an expiration date in that last slot.)
function buildFilename(location, staffId, stepKey, date) {
  return sanitizeForFilename(location) + '_Staff_' + sanitizeForFilename(staffId) + '_' + stepKey + '_' + date;
}

// The key is only checked for shape here; callers check it against the
// current requirements.
function parseFilename(filename) {
  const parts = (filename || '').split('_');
  if (parts.length !== 5 || parts[1] !== 'Staff') return null;
  if (!KEY_RE.test(parts[3])) return null;
  return { location: parts[0], staffId: parts[2], stepKey: parts[3], date: parts[4] };
}

function personFromPage(page) {
  const role = getPlainText(page.properties['Role']) || '';
  return {
    id: page.id,
    name: getPlainText(page.properties['Name']),
    location: getPlainText(page.properties['Location']),
    role: effectiveRole(role),
    roleSet: ROLES.indexOf(role) !== -1,
    trainingFolderUrl: getPlainText(page.properties['Training Folder URL']),
    intakeId: getPlainText(page.properties['Intake ID']) || ''
  };
}

// Looks a staff member up directly by their ASRS People page ID (as
// embedded in a filename) rather than by name — Notion's API accepts
// page IDs with or without dashes, which is exactly the mangled form
// sanitizeForFilename produces.
async function staffInfoById(staffId) {
  return personFromPage(await getPage(staffId));
}

async function staffListForLocation(location) {
  const result = await queryDatabase(ASRS_PEOPLE_DB_ID, {
    and: [
      { property: 'Type', select: { equals: 'Staff' } },
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(personFromPage)
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

// Every active staff member at every location (the nightly Drive check).
async function allActiveStaff() {
  const pages = await queryDatabaseAll(ASRS_PEOPLE_DB_ID, {
    and: [
      { property: 'Type', select: { equals: 'Staff' } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return pages.map(personFromPage);
}

function itemFromPage(page) {
  return {
    id: page.id,
    stepKey: getPlainText(page.properties['Step Key']),
    done: !!page.properties['Done'].checkbox,
    filename: getPlainText(page.properties['Filename']),
    completedDate: getPlainText(page.properties['Completed Date']) || '',
    expDate: getPlainText(page.properties['Exp Date']) || '',
    lastUpdatedBy: getPlainText(page.properties['Last Updated By']) || ''
  };
}

// Every active item row for a staff member — however many exist so far
// (a brand-new staff member has none yet; each gets created lazily the
// first time it's completed, see markItemDone).
async function itemsForStaff(location, staffName) {
  const result = await queryDatabase(STAFF_TRAINING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Staff Name', rich_text: { equals: staffName } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(itemFromPage);
}

function dateOnly(iso) {
  return new Date(iso + 'T00:00:00');
}

// One-time items are done once they're on file. Renewing items are due
// on their Exp Date (set from the completion date when recorded) and turn
// yellow WINDOW_DAYS_BEFORE_DUE days ahead.
function itemState(req, item, now) {
  if (!item || !item.done) return 'missing';
  if (!req.renewYears) return 'current';
  if (!item.expDate) return 'missing';
  const due = dateOnly(item.expDate);
  if (now >= due) return 'overdue';
  const windowOpen = new Date(due);
  windowOpen.setDate(windowOpen.getDate() - WINDOW_DAYS_BEFORE_DUE);
  return now >= windowOpen ? 'soon' : 'current';
}

// Every requirement that applies to this role, in checklist order, with
// its progress filled in (a placeholder where no row exists yet) — the
// UI needs a stable, complete list to render, not just however many rows
// happen to exist in Notion.
function fullStepList(items, requirements, role, now) {
  now = now || new Date();
  const byKey = {};
  items.forEach(function (i) { byKey[i.stepKey] = i; });
  return requirementsForRole(requirements, role).map(function (req) {
    const item = byKey[req.key];
    return {
      key: req.key,
      label: req.label,
      part: req.part,
      section: req.section,
      renewYears: req.renewYears,
      formUrl: req.formUrl,
      done: item ? item.done : false,
      filename: item ? item.filename : '',
      completedDate: item ? item.completedDate : '',
      expDate: item && req.renewYears ? item.expDate : '',
      // Copied from an intake: the document is in the person's intake
      // folder, not their training folder.
      fromIntake: !!item && item.lastUpdatedBy.indexOf(INTAKE_SOURCE) === 0,
      notApplicable: !!item && item.lastUpdatedBy.indexOf(INTAKE_NA) === 0,
      state: itemState(req, item, now)
    };
  });
}

// dueDate is the earliest due date among renewing items on file, whether
// or not other items are still missing.
function computeStaffTrainingWindow(steps) {
  const missingCount = steps.filter(function (s) { return s.state === 'missing'; }).length;
  const dueDates = steps.filter(function (s) { return s.state !== 'missing' && s.expDate; })
    .map(function (s) { return s.expDate; }).sort();
  const isOverdue = steps.some(function (s) { return s.state === 'overdue'; });
  return {
    hasStarted: steps.some(function (s) { return s.done; }),
    missingCount: missingCount,
    totalCount: steps.length,
    dueDate: dueDates.length ? dateOnly(dueDates[0]) : null,
    isOverdue: isOverdue,
    isDueSoon: !isOverdue && steps.some(function (s) { return s.state === 'soon'; })
  };
}

// Everything a screen needs for one person: their checklist and its
// summary. Pass the loaded requirements in when doing this for many
// people at once.
async function staffTrainingStatus(location, member, requirements, now) {
  requirements = requirements || (await loadRequirements()).requirements;
  const items = await itemsForStaff(location, member.name);
  const steps = fullStepList(items, requirements, member.role, now);
  return { steps: steps, window: computeStaffTrainingWindow(steps) };
}

// "YYYY-MM-DD" plus whole years; Feb 29 rolls to Mar 1 in a non-leap year.
function addYears(iso, years) {
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0] + years, p[1] - 1, p[2])).toISOString().slice(0, 10);
}

// Finds-or-creates the row for (location, staffName, key) and marks it
// done. The next due date is worked out from the completion date and the
// requirement's Renews setting; one-time items have none.
async function markItemDone(location, staffName, req, filename, completedDate, updatedBy) {
  const result = await queryDatabase(STAFF_TRAINING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Staff Name', rich_text: { equals: staffName } },
      { property: 'Step Key', select: { equals: req.key } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const existing = (result.results || [])[0];
  const today = new Date().toISOString().slice(0, 10);
  const props = {
    'Done': { checkbox: true },
    'Filename': { rich_text: filename ? [{ text: { content: filename } }] : [] },
    'Completed Date': { date: { start: completedDate } },
    'Exp Date': { date: req.renewYears ? { start: addYears(completedDate, req.renewYears) } : null },
    'Last Updated By': { rich_text: [{ text: { content: updatedBy } }] },
    'Last Updated Date': { date: { start: today } }
  };

  if (existing) {
    await updatePage(existing.id, props);
    return;
  }

  // Step Key is a select: Notion adds a new requirement's Key as an
  // option the first time it's written.
  await createPage(STAFF_TRAINING_DB_ID, Object.assign({
    'Record Title': { title: [{ text: { content: location + ' - ' + staffName + ' - ' + req.key } }] },
    'Location': { select: { name: location } },
    'Staff Name': { rich_text: [{ text: { content: staffName } }] },
    'Step Key': { select: { name: req.key } },
    'Active': { checkbox: true }
  }, props));
}

// Fills in someone's training record from their intake (processName:
// Sponsor or DSP): every requirement that applies to them and names steps
// in that process's Intake Steps column is marked done
// once all of those steps are Complete or Not Applicable in the intake,
// using the latest of their completion dates (so a renewing item's due
// date follows from it; marking a step Not Applicable stamps that date).
// When every step was Not Applicable, the row says so (INTAKE_NA).
// Items already on file are left alone, so this is safe to run again as
// the intake progresses. intakeItemsByKey is lib/sponsor-intake.js's
// itemsForIntake result. No filename: the documents stay in the intake's
// Drive folder.
async function copyFromIntake(location, person, requirements, intakeItemsByKey, updatedBy, processName) {
  const existing = {};
  (await itemsForStaff(location, person.name)).forEach(function (i) { existing[i.stepKey] = i; });
  const result = { copied: [], notApplicable: [], alreadyOnFile: [], notYet: [], noDate: [] };

  const reqs = requirementsForRole(requirements, person.role).filter(function (r) { return r.intakeSteps[processName].length; });
  for (const req of reqs) {
    if (existing[req.key] && existing[req.key].done) {
      result.alreadyOnFile.push(req.label);
      continue;
    }
    const steps = req.intakeSteps[processName].map(function (k) { return intakeItemsByKey[k]; });
    if (steps.some(function (s) { return !s || (s.status !== 'Complete' && s.status !== 'Not Applicable'); })) {
      result.notYet.push(req.label);
      continue;
    }
    const dates = steps.map(function (s) { return s.completedDate; }).filter(Boolean).sort();
    if (dates.length !== steps.length) {
      result.noDate.push(req.label);
      continue;
    }
    const date = dates[dates.length - 1].slice(0, 10);
    const allNA = steps.every(function (s) { return s.status === 'Not Applicable'; });
    await markItemDone(location, person.name, req, '', date, (allNA ? INTAKE_NA : INTAKE_SOURCE) + ' – ' + processName + ' (' + updatedBy + ')');
    (allNA ? result.notApplicable : result.copied).push({ label: req.label, date: date });
  }
  return result;
}

// The Eastern date a Drive file was last changed (≈ when it was put
// there), for one-time items whose name has no date.
function driveDate(file, now) {
  const when = file.modifiedTime ? new Date(file.modifiedTime) : (now || new Date());
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
}

// Picks up documents put straight into a person's Training folder (or a
// folder inside it) by hand rather than uploaded through the app
// (lib/drive-documents.js has the naming convention). The name must start
// with a requirement's Key and include the date it was completed, which
// sets the next due date. A file is recorded when the item isn't on file
// yet, or, for a renewing item, when its date is newer than the one on
// file (a renewal). A one-time item's name can leave the date off. Training-module certificates ("Module_…", filed by the
// training modules) are left alone. Returns
// { checked, added: [{ label, file, date }], unrecognized: [{ name, reason }] }.
async function syncFromDrive(member, requirements, now) {
  const result = { checked: false, added: [], unrecognized: [] };
  const folderId = driveFolderIdFromUrl(member.trainingFolderUrl);
  if (!folderId) return result;

  const files = await driveDocs.listFiles(folderId, 1);
  result.checked = true;
  const existing = {};
  (await itemsForStaff(member.location, member.name)).forEach(function (i) { existing[i.stepKey] = i; });
  const mine = requirementsForRole(requirements, member.role);
  const allCodes = requirements.map(function (r) { return r.key; });

  // Oldest first, so when several files name the same item the newest
  // one ends up on file.
  const candidates = [];
  files.forEach(function (file) {
    if (/^Module_/i.test(file.name)) return;
    if (Object.keys(existing).some(function (k) { return driveDocs.sameFile(existing[k].filename, file.name); })) return;
    const parsed = driveDocs.parseDocName(file.name, allCodes);
    const shown = file.folderName ? file.folderName + '/' + file.name : file.name;
    if (!parsed.code) {
      result.unrecognized.push({ name: shown, reason: 'The name doesn\'t start with a training item code.' });
      return;
    }
    const req = mine.find(function (r) { return r.key === parsed.code; });
    if (!req) {
      result.unrecognized.push({ name: shown, reason: parsed.code + ' isn\'t on the checklist for a ' + member.role + '.' });
      return;
    }
    // A renewing item's date sets its next due date, so it has to be in
    // the name; a one-time item can go without (the day the file was
    // added to Drive is used).
    if (!parsed.date && req.renewYears) {
      result.unrecognized.push({ name: shown, reason: 'Add the date it was completed to the name, e.g. ' + req.key + '_2026-10-15.' });
      return;
    }
    candidates.push({ file: file, req: req, date: parsed.date || driveDate(file, now) });
  });
  candidates.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  for (const c of candidates) {
    const item = existing[c.req.key];
    if (item && item.done) {
      // One-time items stay as they are; a renewing item only moves
      // forward to a newer completion date.
      if (!c.req.renewYears) continue;
      const onFile = item.completedDate || (item.expDate ? addYears(item.expDate, -c.req.renewYears) : '');
      if (onFile && c.date <= onFile) continue;
    }
    await markItemDone(member.location, member.name, c.req, c.file.name, c.date, driveDocs.DRIVE_SOURCE);
    existing[c.req.key] = { stepKey: c.req.key, done: true, filename: c.file.name, completedDate: c.date, expDate: '' };
    result.added = result.added.filter(function (a) { return a.key !== c.req.key; });
    result.added.push({ key: c.req.key, label: c.req.label, file: c.file.name, date: c.date });
  }
  return result;
}

module.exports = {
  ROLES,
  PARTS,
  WINDOW_DAYS_BEFORE_DUE,
  loadRequirements,
  requirementsForRole,
  intakeProcessForRole,
  buildFilename,
  parseFilename,
  staffInfoById,
  staffListForLocation,
  allActiveStaff,
  itemsForStaff,
  fullStepList,
  computeStaffTrainingWindow,
  staffTrainingStatus,
  addYears,
  markItemDone,
  copyFromIntake,
  syncFromDrive,
  driveFolderIdFromUrl
};
