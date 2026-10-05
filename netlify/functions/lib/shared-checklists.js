const { queryDatabase, updatePage, createPage, getPage, getPlainText } = require('./notion');

const SHARED_CHECKLISTS_DB_ID = process.env.SHARED_CHECKLISTS_DB_ID;
const SHARED_CHECKLIST_ITEMS_DB_ID = process.env.SHARED_CHECKLIST_ITEMS_DB_ID;

// How far back the admin dashboard's "Recently completed" list reaches.
// Older completed checklists stay in Notion as the permanent record —
// they just stop crowding the dashboard.
const RECENTLY_COMPLETED_DAYS = 60;

// Fixed, code-level templates — same convention as Monthly Checklist's
// ITEMS and Staff Training's STEPS. Adding a new kind of shared
// checklist means adding an entry here; no Notion schema change is
// needed, since every item's state lives in its own row in the Shared
// Checklist Items database keyed by Item Key.
//
// Item keys are what saved progress is matched against, so never
// rename one on a checklist that's already in use — change the label
// instead.
const TEMPLATES = [
  {
    key: 'dsp-intake',
    name: 'DSP Intake',
    sections: [
      {
        title: 'Intake & Documentation',
        items: [
          { key: 'resume', label: 'Resume' },
          { key: 'screening-questionnaire', label: 'Screening Questionnaire' },
          { key: 'application', label: 'Completed Application' },
          { key: 'interview-notes', label: 'Interview Notes' },
          { key: 'reference-checks', label: 'Completed reference check forms' },
          { key: 'drivers-license', label: 'Driver’s license' },
          { key: 'dmv-record', label: 'DMV Driving Record' },
          { key: 'diploma-certifications', label: 'Diploma/Certifications' },
          { key: 'confidentiality-agreement', label: 'Signed Confidentiality Agreement' },
          { key: 'tb-test', label: 'TB Test/Assessment' },
          { key: 'background-disclosure', label: 'ASRS Background Check Disclosure Form' },
          { key: 'background-check', label: 'Completed Background Check' },
          { key: 'central-registry', label: 'Completed Central Registry Check' }
        ]
      },
      {
        title: 'Training',
        items: [
          { key: 'med-management', label: '32-Hour Medication Management Training/Refresher' },
          { key: 'dd-waiver-orientation', label: 'DBHDS DD Waiver Orientation Training' },
          { key: 'documentation-requirements', label: 'ASRS Documentation Requirements & Completion' },
          { key: 'therap-progress-notes', label: 'Therap Training – Daily Progress Notes' },
          { key: 'therap-mar', label: 'Therap Training – Medication Administration Records' },
          { key: 'hipaa', label: 'HIPAA' },
          { key: 'first-aid-cpr', label: 'First Aid/CPR' },
          { key: 'behavior-management', label: 'Behavior Management (TOVA/Crisis Wave)' },
          { key: 'universal-precautions', label: 'Universal Precautions and Infectious Controls' },
          { key: 'human-rights', label: 'Human Rights' },
          { key: 'hcbs', label: 'Home and Community Based Services (HCBS)' },
          { key: 'serious-incident-reporting', label: 'Serious Incident Reporting' },
          { key: 'shadow-training', label: 'Shadow Training (32 hours – dates and hours)' }
        ]
      },
      {
        title: 'Final',
        items: [
          { key: 'role-responsibilities', label: 'DSP Role and Responsibilities' },
          { key: 'orientation-form', label: 'ASRS Orientation Training Form' },
          { key: 'competency-assessment', label: 'DSP Competency Assessment' },
          { key: 'dd-waiver-assurance', label: 'DD Waiver Assurance Form' }
        ]
      }
    ]
  }
];

function findTemplate(key) {
  return TEMPLATES.find(function (t) { return t.key === key; }) || null;
}

function templateItems(template) {
  const items = [];
  template.sections.forEach(function (section) {
    section.items.forEach(function (item) { items.push(item); });
  });
  return items;
}

function checklistFromPage(page) {
  const props = page.properties;
  return {
    id: page.id,
    templateKey: getPlainText(props['Template']),
    subject: getPlainText(props['Subject']),
    location: getPlainText(props['Location']),
    createdBy: getPlainText(props['Created By']),
    createdDate: getPlainText(props['Created Date']),
    completed: !!props['Completed'].checkbox,
    completedBy: getPlainText(props['Completed By']),
    completedDate: getPlainText(props['Completed Date'])
  };
}

// Item rows are only created the first time someone touches an item,
// so a brand-new checklist costs one Notion write instead of thirty.
// Two people checking the same never-touched item at the same instant
// could each create a row — when that happens, the most recently
// edited row wins, both here and in setItem below.
async function itemStates(checklistId) {
  const result = await queryDatabase(SHARED_CHECKLIST_ITEMS_DB_ID, {
    property: 'Checklist ID',
    rich_text: { equals: checklistId }
  });
  const byKey = {};
  (result.results || []).forEach(function (page) {
    const key = getPlainText(page.properties['Item Key']);
    const existing = byKey[key];
    if (existing && existing.lastEdited >= page.last_edited_time) return;
    byKey[key] = {
      pageId: page.id,
      lastEdited: page.last_edited_time,
      done: !!page.properties['Done'].checkbox,
      doneBy: getPlainText(page.properties['Done By']),
      doneAt: getPlainText(page.properties['Done At']),
      note: getPlainText(page.properties['Note'])
    };
  });
  return byKey;
}

// The template merged with whatever's been saved, in template order.
function buildItems(template, states) {
  return template.sections.map(function (section) {
    return {
      title: section.title,
      items: section.items.map(function (item) {
        const state = states[item.key] || {};
        return {
          key: item.key,
          label: item.label,
          done: !!state.done,
          doneBy: state.doneBy || '',
          doneAt: state.doneAt || '',
          note: state.note || ''
        };
      })
    };
  });
}

function progressFor(template, states) {
  const items = templateItems(template);
  const done = items.filter(function (item) { return states[item.key] && states[item.key].done; }).length;
  return { done: done, total: items.length };
}

// Summary rows for a list view — one per checklist, with progress.
async function summarize(checklists) {
  return Promise.all(checklists.map(async function (checklist) {
    const template = findTemplate(checklist.templateKey);
    const states = template ? await itemStates(checklist.id) : {};
    return Object.assign({}, checklist, {
      templateName: template ? template.name : checklist.templateKey,
      progress: template ? progressFor(template, states) : { done: 0, total: 0 }
    });
  }));
}

async function listOpen(locations) {
  if (!locations.length) return [];
  const result = await queryDatabase(SHARED_CHECKLISTS_DB_ID, {
    and: [
      { property: 'Completed', checkbox: { equals: false } },
      { or: locations.map(function (location) { return { property: 'Location', select: { equals: location } }; }) }
    ]
  });
  return (result.results || []).map(checklistFromPage)
    .sort(function (a, b) { return a.createdDate < b.createdDate ? -1 : a.createdDate > b.createdDate ? 1 : 0; });
}

async function listRecentlyCompleted(locations) {
  if (!locations.length) return [];
  const since = new Date(Date.now() - RECENTLY_COMPLETED_DAYS * 86400000).toISOString().slice(0, 10);
  const result = await queryDatabase(SHARED_CHECKLISTS_DB_ID, {
    and: [
      { property: 'Completed', checkbox: { equals: true } },
      { property: 'Completed Date', date: { on_or_after: since } },
      { or: locations.map(function (location) { return { property: 'Location', select: { equals: location } }; }) }
    ]
  });
  return (result.results || []).map(checklistFromPage)
    .sort(function (a, b) { return b.completedDate < a.completedDate ? -1 : b.completedDate > a.completedDate ? 1 : 0; });
}

async function getChecklist(checklistId) {
  let page;
  try {
    page = await getPage(checklistId);
  } catch (e) {
    page = null;
  }
  if (!page || page.in_trash || page.archived || !page.parent || (page.parent.data_source_id || '').replace(/-/g, '') !== (SHARED_CHECKLISTS_DB_ID || '').replace(/-/g, '')) {
    const err = new Error('Checklist not found.');
    err.statusCode = 404;
    throw err;
  }
  return checklistFromPage(page);
}

// Which checklists a session may see/edit: the admin dashboard sees
// every location it's granted; the provider app (sponsor, or an admin
// logged in with one location's password) sees only that location, and
// only while the checklist is still open.
function sessionLocations(session) {
  if (session.accountType === 'admin-dashboard') return session.grantedLocations || [];
  return session.location ? [session.location] : [];
}

function assertCanAccess(session, checklist) {
  if (sessionLocations(session).indexOf(checklist.location) === -1) {
    const err = new Error('Not authorized for that checklist.');
    err.statusCode = 403;
    throw err;
  }
  if (session.accountType !== 'admin-dashboard' && checklist.completed) {
    const err = new Error('This checklist has been marked complete.');
    err.statusCode = 403;
    throw err;
  }
}

async function getDetail(checklist) {
  const template = findTemplate(checklist.templateKey);
  if (!template) {
    const err = new Error('Unknown checklist template: ' + checklist.templateKey);
    err.statusCode = 500;
    throw err;
  }
  const states = await itemStates(checklist.id);
  return Object.assign({}, checklist, {
    templateName: template.name,
    progress: progressFor(template, states),
    sections: buildItems(template, states)
  });
}

async function create(templateKey, subject, location, createdBy) {
  const template = findTemplate(templateKey);
  const today = new Date().toISOString().slice(0, 10);
  const page = await createPage(SHARED_CHECKLISTS_DB_ID, {
    'Record Title': { title: [{ text: { content: template.name + ' - ' + subject } }] },
    'Template': { rich_text: [{ text: { content: template.key } }] },
    'Subject': { rich_text: [{ text: { content: subject } }] },
    'Location': { select: { name: location } },
    'Created By': { rich_text: [{ text: { content: createdBy } }] },
    'Created Date': { date: { start: today } },
    'Completed': { checkbox: false }
  });
  return checklistFromPage(page);
}

// Writes one item's state. `changes` may carry `done` (boolean) and/or
// `note` (string); whatever's left out is kept as-is. Checking an item
// stamps who/when; unchecking clears that stamp.
async function setItem(checklist, itemKey, changes, actorName) {
  const template = findTemplate(checklist.templateKey);
  const item = template && templateItems(template).find(function (i) { return i.key === itemKey; });
  if (!item) {
    const err = new Error('Unknown checklist item.');
    err.statusCode = 400;
    throw err;
  }

  const props = {};
  if (typeof changes.done === 'boolean') {
    props['Done'] = { checkbox: changes.done };
    props['Done By'] = { rich_text: changes.done ? [{ text: { content: actorName } }] : [] };
    props['Done At'] = { date: changes.done ? { start: new Date().toISOString() } : null };
  }
  if (typeof changes.note === 'string') {
    const note = changes.note.slice(0, 2000);
    props['Note'] = { rich_text: note ? [{ text: { content: note } }] : [] };
  }

  const states = await itemStates(checklist.id);
  const existing = states[itemKey];
  if (existing) {
    await updatePage(existing.pageId, props);
  } else {
    await createPage(SHARED_CHECKLIST_ITEMS_DB_ID, Object.assign({
      'Record Title': { title: [{ text: { content: checklist.subject + ' - ' + item.label } }] },
      'Checklist ID': { rich_text: [{ text: { content: checklist.id } }] },
      'Item Key': { rich_text: [{ text: { content: itemKey } }] }
    }, props));
  }
}

async function setCompleted(checklist, completed, actorName) {
  const today = new Date().toISOString().slice(0, 10);
  await updatePage(checklist.id, {
    'Completed': { checkbox: completed },
    'Completed By': { rich_text: completed ? [{ text: { content: actorName } }] : [] },
    'Completed Date': { date: completed ? { start: today } : null }
  });
}

module.exports = {
  TEMPLATES,
  findTemplate,
  listOpen,
  listRecentlyCompleted,
  summarize,
  getChecklist,
  sessionLocations,
  assertCanAccess,
  getDetail,
  create,
  setItem,
  setCompleted
};
