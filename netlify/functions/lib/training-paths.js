// Training paths (phase 3): modules done in a set order. Assigning a path
// creates one Path Assignments row plus one Module Assignments row per
// step; step 1 is Assigned, the rest Locked. Submitting a step unlocks the
// next one (its due date starts then) and texts its link; submitting the
// last one completes the path and issues a path certificate through the
// same Zap as module certificates.
//
// Notion (Training Modules page; IDs in lib/ids.js):
//   Paths             Title, Key, Status, Applies To, Certificate Line
//   Path Steps        Path, Module, Order, Days to complete (blank = 7)
//   Path Assignments  one row per person per path, written by the app
const { queryDatabaseAll, updatePage, createPage, getPage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');
const tm = require('./training-modules');

const PATHS_DB_ID = configId('PATHS_DB_ID');
const PATH_STEPS_DB_ID = configId('PATH_STEPS_DB_ID');
const PATH_ASSIGNMENTS_DB_ID = configId('PATH_ASSIGNMENTS_DB_ID');
const MODULE_ASSIGNMENTS_DB_ID = configId('MODULE_ASSIGNMENTS_DB_ID');
const DEFAULT_DAYS = 7;

function addDays(iso, days) {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function relationIds(prop) { return ((prop && prop.relation) || []).map(function (r) { return r.id; }); }

function pathFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: getPlainText(p['Title']),
    key: getPlainText(p['Key']).trim(),
    status: getPlainText(p['Status']) || 'Draft',
    appliesTo: ((p['Applies To'] && p['Applies To'].multi_select) || []).map(function (o) { return o.name; }),
    certificateLine: getPlainText(p['Certificate Line']) || 'Training path',
    description: getPlainText(p['Description'])
  };
}

// The path plus its steps in order, each with its module loaded.
// `problems` lists anything that stops it being assigned.
async function loadPath(pathId) {
  const path = pathFromPage(await getPage(pathId));
  const rows = await queryDatabaseAll(PATH_STEPS_DB_ID, { property: 'Path', relation: { contains: pathId } });
  const problems = [];
  const steps = [];
  for (const row of rows) {
    const p = row.properties;
    const order = getPlainText(p['Order']);
    const moduleId = relationIds(p['Module'])[0];
    const label = getPlainText(p['Label']) || 'A step';
    if (typeof order !== 'number') { problems.push('"' + label + '" has no Order.'); continue; }
    if (!moduleId) { problems.push('"' + label + '" has no Module.'); continue; }
    const days = getPlainText(p['Days to complete']);
    const mod = await tm.loadModule(moduleId);
    if (mod.status !== 'Published') problems.push('"' + mod.title + '" isn\'t Published.');
    if (mod.problems.length) problems.push('"' + mod.title + '": ' + mod.problems.join(' '));
    steps.push({ order: order, moduleId: moduleId, mod: mod, days: typeof days === 'number' && days > 0 ? days : DEFAULT_DAYS });
  }
  steps.sort(function (a, b) { return a.order - b.order; });
  if (!steps.length) problems.push('It has no steps.');
  if (!/^[A-Za-z0-9]+$/.test(path.key)) problems.push('Its Key must be letters and numbers only.');
  path.steps = steps;
  path.problems = problems;
  return path;
}

async function listPaths() {
  const pages = await queryDatabaseAll(PATHS_DB_ID);
  return pages.map(pathFromPage).sort(function (a, b) { return a.title.localeCompare(b.title); });
}

function pathAssignmentFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    pathId: relationIds(p['Path'])[0] || '',
    personId: relationIds(p['Person'])[0] || '',
    personName: getPlainText(p['Person Name']),
    role: getPlainText(p['Role']),
    location: getPlainText(p['Location']),
    status: getPlainText(p['Status']) || 'In Progress',
    assignedDate: getPlainText(p['Assigned Date']),
    steps: getPlainText(p['Steps']) || 0,
    currentStep: getPlainText(p['Current Step']) || 1,
    completedAt: getPlainText(p['Completed At']),
    certificateId: getPlainText(p['Certificate ID']),
    certificateStatus: getPlainText(p['Certificate Status']),
    certificateSentAt: getPlainText(p['Certificate Sent'])
  };
}

async function listPathAssignments(filter) {
  return (await queryDatabaseAll(PATH_ASSIGNMENTS_DB_ID, filter)).map(pathAssignmentFromPage);
}

// The module rows of one path assignment, by step.
async function stepRows(pathAssignmentId) {
  const rows = (await tm.listAssignments({ property: 'Path Assignment', relation: { contains: pathAssignmentId } }));
  return rows.sort(function (a, b) { return (a.pathStep || 0) - (b.pathStep || 0); });
}

// Creates the Path Assignments row and every step's Module Assignments
// row. Returns { pathAssignment, first: { assignment, mod } }.
async function createPathAssignment(path, person, opts) {
  const today = tm.todayIso();
  const props = {
    'Name': { title: [{ text: { content: person.name + ' · ' + path.title } }] },
    'Path': { relation: [{ id: path.id }] },
    'Person': { relation: [{ id: person.id }] },
    'Person Name': tm.richText(person.name),
    'Status': { select: { name: 'In Progress' } },
    'Assigned Date': { date: { start: today } },
    'Assigned By': tm.richText(opts.assignedBy || ''),
    'Steps': { number: path.steps.length },
    'Current Step': { number: 1 }
  };
  if (person.role) props['Role'] = { select: { name: person.role } };
  if (person.location) props['Location'] = { select: { name: person.location } };
  const pa = pathAssignmentFromPage(await createPage(PATH_ASSIGNMENTS_DB_ID, props));

  let first = null;
  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i];
    const a = await tm.createAssignment({
      moduleId: step.mod.id, moduleTitle: step.mod.title + ' (' + path.title + ', step ' + (i + 1) + ')', moduleVersion: step.mod.version,
      personId: person.id, personName: person.name, role: person.role, location: person.location,
      dueDate: i === 0 ? addDays(today, step.days) : null, status: i === 0 ? 'Assigned' : 'Locked',
      assignedBy: opts.assignedBy, phone: tm.normalizePhone(person.phone), email: person.email,
      pathAssignmentId: pa.id, pathStep: i + 1
    });
    if (i === 0) first = { assignment: a, mod: step.mod };
  }
  return { pathAssignment: pa, first: first };
}

// After a step is submitted. Unlocks and announces the next step, or
// completes the path. Returns { next: { title, link, dueDate } } or
// { pathCompleted: true, certificateId } (or {} when not in a path).
async function afterStepCompleted(assignment, deps, site) {
  if (!assignment.pathAssignmentId) return {};
  const pa = pathAssignmentFromPage(await getPage(assignment.pathAssignmentId));
  if (pa.status !== 'In Progress') return {};
  const path = await loadPath(pa.pathId);
  const rows = await stepRows(pa.id);
  const thisStep = assignment.pathStep || 0;
  const nextRow = rows.find(function (r) { return r.pathStep === thisStep + 1 && r.status === 'Locked'; });

  if (nextRow) {
    const stepDef = path.steps[thisStep] || { days: DEFAULT_DAYS };
    const due = addDays(tm.todayIso(), stepDef.days);
    await updatePage(nextRow.id, {
      'Status': { select: { name: 'Assigned' } },
      'Assigned Date': { date: { start: tm.todayIso() } },
      'Due Date': { date: { start: due } }
    });
    await updatePage(pa.id, { 'Current Step': { number: thisStep + 1 } });
    const unlocked = Object.assign({}, nextRow, { status: 'Assigned', dueDate: due, assignedDate: tm.todayIso() });
    const mod = await tm.loadModule(nextRow.moduleId);
    const prevMod = await tm.loadModule(assignment.moduleId);
    const link = tm.moduleLink(unlocked, site);
    let channel = '';
    try {
      const person = await tm.getPerson(assignment.personId);
      channel = await deps.notifyNextStep(person, { path: path, step: thisStep + 1, steps: rows.length, prevTitle: prevMod.title, mod: mod, assignment: unlocked, link: link });
      if (channel) await updatePage(nextRow.id, { 'Channel': { select: { name: channel } } });
    } catch (e) {
      console.error('Next-step notice failed for ' + assignment.personName, e);
    }
    return { next: { title: mod.title, link: link, dueDate: due, step: thisStep + 1, steps: rows.length, pathTitle: path.title } };
  }

  const allDone = rows.every(function (r) { return r.status === 'Completed' || r.id === assignment.id; });
  if (!allDone) return {};
  const completedAt = new Date().toISOString();
  await updatePage(pa.id, {
    'Status': { select: { name: 'Completed' } },
    'Completed At': { date: { start: completedAt } },
    'Current Step': { number: rows.length }
  });
  const cert = await issuePathCertificate(Object.assign({}, pa, { status: 'Completed', completedAt: completedAt }), path, site);
  return { pathCompleted: true, pathTitle: path.title, certificateId: cert.certificateId };
}

// Same flow as a module certificate (lib/training-modules.js
// issueCertificate), with the path's title and Certificate Line. The Zap
// resolves it through module-certificate-resolve, which reads the Path
// Assignments row the same way (it shares the certificate field names).
async function issuePathCertificate(pa, path, site) {
  const mod = { key: path.key, title: path.title, certificateLine: path.certificateLine, kindText: 'has completed the training path' };
  const asAssignment = Object.assign({}, pa, { moduleVersion: 1, certificateFile: '' });
  return tm.issueCertificate(asAssignment, mod, site, { filenamePrefix: 'Path' });
}

// Cancels a path and every step not yet completed.
async function cancelPath(pa) {
  await updatePage(pa.id, { 'Status': { select: { name: 'Cancelled' } } });
  for (const r of await stepRows(pa.id)) {
    if (r.status !== 'Completed' && r.status !== 'Cancelled') await updatePage(r.id, { 'Status': { select: { name: 'Cancelled' } } });
  }
}

// Text on a Locked step's link: which module to finish first.
async function lockedMessage(assignment) {
  const rows = assignment.pathAssignmentId ? await stepRows(assignment.pathAssignmentId) : [];
  const prev = rows.find(function (r) { return r.pathStep === (assignment.pathStep || 0) - 1; });
  if (!prev) return 'This module isn\'t open yet.';
  const mod = await tm.loadModule(prev.moduleId);
  return 'This module opens after you finish "' + mod.title + '". Use the link we sent you for that one first.';
}

module.exports = {
  DEFAULT_DAYS, addDays, loadPath, listPaths, pathAssignmentFromPage, listPathAssignments, stepRows,
  createPathAssignment, afterStepCompleted, issuePathCertificate, cancelPath, lockedMessage
};
