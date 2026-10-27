const { queryDatabase, queryDatabaseAll, updatePage, createPage, getPlainText, getPage, driveFolderIdFromUrl } = require('./notion');
const { id: configId } = require('./ids');

const STAFF_TRAINING_DB_ID = process.env.STAFF_TRAINING_DB_ID;
const ASRS_PEOPLE_DB_ID = process.env.ASRS_PEOPLE_DB_ID;

// The checklist itself (ASRS-450-01) lives in Notion, not in code, so it
// can be edited without a deploy — the same idea as Sponsor Intake's
// Intake Steps. One row per required item: Label, Key, Part, Section,
// Applies To (roles), Renews, Order, Active, optional Form Link, and
// optional Intake Steps (the Sponsor Intake step Keys that satisfy the
// item, used by copyFromIntake). Progress
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
// Last Updated By prefix on rows copied from Sponsor Intake.
const INTAKE_SOURCE = 'Sponsor Intake';

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
      intakeSteps: (getPlainText(p['Intake Steps']) || '').split(',')
        .map(function (k) { return k.trim(); }).filter(Boolean)
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
    intakeId: getPlainText(page.properties['Sponsor Intake ID']) || ''
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
      // Copied from Sponsor Intake: the document is in the sponsor's
      // intake folder, not their training folder.
      fromIntake: !!item && item.lastUpdatedBy.indexOf(INTAKE_SOURCE) === 0,
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

// Fills in a sponsor's training record from their Sponsor Intake: every
// requirement that applies to them and names Intake Steps is marked done
// once all of those steps are Complete in the intake, using the latest of
// their completion dates (so a renewing item's due date follows from it).
// Items already on file are left alone, so this is safe to run again as
// the intake progresses. intakeItemsByKey is lib/sponsor-intake.js's
// itemsForIntake result. No filename: the documents stay in the intake's
// Drive folder.
async function copyFromIntake(location, person, requirements, intakeItemsByKey, updatedBy) {
  const existing = {};
  (await itemsForStaff(location, person.name)).forEach(function (i) { existing[i.stepKey] = i; });
  const result = { copied: [], alreadyOnFile: [], notYet: [], noDate: [] };

  const reqs = requirementsForRole(requirements, person.role).filter(function (r) { return r.intakeSteps.length; });
  for (const req of reqs) {
    if (existing[req.key] && existing[req.key].done) {
      result.alreadyOnFile.push(req.label);
      continue;
    }
    const steps = req.intakeSteps.map(function (k) { return intakeItemsByKey[k]; });
    if (steps.some(function (s) { return !s || s.status !== 'Complete'; })) {
      result.notYet.push(req.label);
      continue;
    }
    const dates = steps.map(function (s) { return s.completedDate; }).filter(Boolean).sort();
    if (dates.length !== steps.length) {
      result.noDate.push(req.label);
      continue;
    }
    const date = dates[dates.length - 1].slice(0, 10);
    await markItemDone(location, person.name, req, '', date, INTAKE_SOURCE + ' (' + updatedBy + ')');
    result.copied.push({ label: req.label, date: date });
  }
  return result;
}

module.exports = {
  ROLES,
  PARTS,
  WINDOW_DAYS_BEFORE_DUE,
  loadRequirements,
  requirementsForRole,
  buildFilename,
  parseFilename,
  staffInfoById,
  staffListForLocation,
  itemsForStaff,
  fullStepList,
  computeStaffTrainingWindow,
  staffTrainingStatus,
  addYears,
  markItemDone,
  copyFromIntake,
  driveFolderIdFromUrl
};
