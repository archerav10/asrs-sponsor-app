const { queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { adminsWithRole } = require('./roles');
const { id: configId } = require('./ids');

// QI & RM tab (admin dashboard): the Quality Improvement and Risk
// Management Plan's measurable objectives with a result and status every
// month (620.C.5), the follow-up when one is At risk or Not met (Policy
// 620 B), and the issues and opportunities log (QI Improvement Items
// Tracker, ASRS-620-09). Feeds Sections 2, 3 and 6 of the Monthly QI & RM
// Status and Compliance Report (ASRS-620-06).
//
//   Only admins holding the Executive Director or Risk Manager role
//   (Admin Accounts > Roles) can open it.
//
//   Plan versions: objectives and goals belong to the version in effect
//   (QI Plan Versions row with no Superseded On). Owner, data source and
//   review frequency change in place. A change to the objective's wording,
//   measure, baseline, target or target date, a new objective, or removing
//   one, is a draft for the next version (Policy 620 G): drafts take effect
//   when a new version is adopted here.

const VERSIONS_DB = configId('QI_PLAN_VERSIONS_DB_ID');
const GOALS_DB = configId('QI_GOALS_DB_ID');
const OBJECTIVES_DB = configId('QI_OBJECTIVES_DB_ID');
const RESULTS_DB = configId('QI_RESULTS_DB_ID');
const ITEMS_DB = configId('QI_ITEMS_DB_ID');
const ITEM_UPDATES_DB = configId('QI_ITEM_UPDATES_DB_ID');
const CAP_ITEMS_DB = configId('CAP_ITEMS_DB_ID');
const TIME_ZONE = 'America/New_York';

const STATUSES = ['On track', 'At risk', 'Not met', 'Met'];
const SERVICES = ['Group Home', 'Sponsored Residential', 'Community Engagement'];
const ITEM_STATUSES = ['Idea', 'Open', 'On hold', 'Completed', 'Dropped', 'Promoted to Plan'];
const ITEM_TYPES = ['Issue', 'Opportunity'];
const SOURCES = ['SRA', 'RCA', 'CAP', 'Input from individuals', 'Inspection', 'Leadership', 'Risk management', 'Reporting', 'Staff', 'Other'];
const AREAS = ['Compliance', 'Staff development', 'Client services', 'Physical environment', 'Risk management', 'Strategic', 'Marketing'];
const LOCATIONS = ['All', 'Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray', 'Community Engagement'];
const GOAL_OPTIONS = ['1 Community integration', '2 Health and safety', '3 Incident reporting', '4 Staff competence', '5 Satisfaction', '6 Licensing compliance', 'None'];
// Changing these needs a new Plan version (Policy 620 G).
const VERSIONED = ['objective', 'measureType', 'baseline', 'baselineValue', 'target', 'targetValue', 'targetDate', 'trend', 'service', 'goalNumber'];
const LABELS = { objective: 'wording', measureType: 'measure', baseline: 'baseline', baselineValue: 'baseline %', target: 'target', targetValue: 'target %', targetDate: 'target date', trend: 'how it is measured over time', service: 'service', goalNumber: 'goal' };

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
function validIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s)); }
function validMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(m || ''); }
function monthEnd(m) {
  const y = +m.slice(0, 4), mo = +m.slice(5, 7);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
function shiftMonth(m, n) {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function quarterOf(m) { return m.slice(0, 4) + '-Q' + (Math.floor((+m.slice(5, 7) - 1) / 3) + 1); }
function prevQuarter(q) {
  const y = +q.slice(0, 4), n = +q.slice(6);
  return n === 1 ? (y - 1) + '-Q4' : y + '-Q' + (n - 1);
}

function richText(s) {
  const t = String(s == null ? '' : s);
  const runs = [];
  for (let i = 0; i < t.length && runs.length < 100; i += 2000) runs.push({ text: { content: t.slice(i, i + 2000) } });
  return { rich_text: runs };
}
function title(s) { return { title: [{ text: { content: String(s || '').slice(0, 2000) } }] }; }
function dateProp(iso) { return { date: iso ? { start: iso } : null }; }
function select(name) { return { select: name ? { name: name } : null }; }
function num(v) { return { number: v === '' || v == null || isNaN(Number(v)) ? null : Number(v) }; }
function numVal(v) { return v === '' || v == null ? null : Number(v); }
function sameId(a, b) { return String(a || '').replace(/-/g, '').toLowerCase() === String(b || '').replace(/-/g, '').toLowerCase(); }
function clean(s, max) { return String(s == null ? '' : s).trim().slice(0, max || 4000); }

// ---------- access ----------

async function requireQiAccess(session) {
  const email = String(session.email || '').trim().toLowerCase();
  const [eds, rms] = await Promise.all([adminsWithRole('Executive Director'), adminsWithRole('Risk Manager')]);
  const ok = eds.concat(rms).some(function (a) { return a.email === email; });
  if (!ok) throw httpError(403, 'The QI & RM tab is for the Executive Director and the Risk Manager (Admin Accounts > Roles).');
}

// ---------- reading ----------

function versionFromPage(p) {
  const r = p.properties;
  return { id: p.id, version: getPlainText(r['Version']), effective: getPlainText(r['Effective Date']), supersededOn: getPlainText(r['Superseded On']), approvedBy: getPlainText(r['Approved By']), changes: getPlainText(r['Changes']) };
}
function goalFromPage(p) {
  const r = p.properties;
  return { id: p.id, name: getPlainText(r['Goal']), number: getPlainText(r['Number']), planVersion: getPlainText(r['Plan Version']), tag: getPlainText(r['Tag']), notes: getPlainText(r['Notes']) };
}
function objectiveFromPage(p) {
  const r = p.properties;
  return {
    id: p.id,
    code: getPlainText(r['Code']),
    planVersion: getPlainText(r['Plan Version']),
    goalNumber: getPlainText(r['Goal Number']),
    service: getPlainText(r['Service']),
    order: getPlainText(r['Order']) || 0,
    objective: getPlainText(r['Objective']),
    measureType: getPlainText(r['Measure Type']) || 'Count of total',
    baseline: getPlainText(r['Baseline']),
    baselineValue: getPlainText(r['Baseline Value']),
    target: getPlainText(r['Target']),
    targetValue: getPlainText(r['Target Value']),
    targetDate: getPlainText(r['Target Date']),
    trend: getPlainText(r['Trend']) || 'Reach by date',
    dataSource: getPlainText(r['Data Source']),
    owner: getPlainText(r['Owner']),
    review: getPlainText(r['Review']),
    fromCap: !!getPlainText(r['From CAP Review']),
    status: getPlainText(r['Status']) || 'Active',
    replaces: getPlainText(r['Replaces']),
    draftNote: getPlainText(r['Draft Note']),
    updatedBy: getPlainText(r['Updated By']),
    updatedDate: getPlainText(r['Updated Date'])
  };
}
function resultFromPage(p) {
  const r = p.properties;
  return {
    id: p.id,
    objectiveId: getPlainText(r['Objective ID']),
    code: getPlainText(r['Code']),
    month: getPlainText(r['Month']),
    planVersion: getPlainText(r['Plan Version']),
    count: getPlainText(r['Count']),
    total: getPlainText(r['Total']),
    percent: getPlainText(r['Percent']),
    valueText: getPlainText(r['Value Text']),
    status: getPlainText(r['Status']),
    suggested: getPlainText(r['Suggested Status']),
    comment: getPlainText(r['Comment']),
    cause: getPlainText(r['Cause']),
    revisedAction: getPlainText(r['Revised Action']),
    followOwner: getPlainText(r['Follow-up Owner']),
    followDue: getPlainText(r['Follow-up Due']),
    enteredBy: getPlainText(r['Entered By']),
    enteredDate: getPlainText(r['Entered Date'])
  };
}

async function planInEffect() {
  const versions = (await queryDatabaseAll(VERSIONS_DB, null)).map(versionFromPage);
  const current = versions.filter(function (v) { return !v.supersededOn; })
    .sort(function (a, b) { return a.effective < b.effective ? 1 : -1; })[0];
  if (!current) throw httpError(500, 'No QI & RM Plan version is in effect (QI Plan Versions has no row without a Superseded On date).');
  return { current: current, versions: versions.sort(function (a, b) { return a.effective < b.effective ? 1 : -1; }) };
}

// How a result reads: "11 of 20 (55%)", or the text value.
function resultText(r) {
  if (!r) return '';
  if (r.total !== '' && r.total !== null && r.total !== undefined && Number(r.total) > 0) {
    return r.count + ' of ' + r.total + ' (' + Math.round(Number(r.count) / Number(r.total) * 100) + '%)';
  }
  return r.valueText || '';
}

// Suggested status. "Reach by date": compared with a straight line from
// the baseline (on the Plan's effective date) to the target (on the target
// date). "Hold each period": must be at the target. null when there's
// nothing to compare.
function suggestStatus(o, count, total, month, planEffective) {
  if (o.measureType !== 'Count of total') return null;
  const t = Number(total);
  if (!(t > 0) || count === '' || count == null || isNaN(Number(count))) return null;
  const pct = Math.round(Number(count) / t * 100);
  const target = Number(o.targetValue);
  if (o.targetValue === '' || o.targetValue == null || isNaN(target)) return { pct: pct, status: null, why: '' };
  if (o.trend === 'Hold each period') return { pct: pct, status: pct >= target ? 'On track' : 'Not met', why: 'needs ' + target + '% every period' };
  if (pct >= target) return { pct: pct, status: 'Met', why: 'target reached' };
  const base = Number(o.baselineValue);
  if (o.baselineValue === '' || o.baselineValue == null || isNaN(base) || !o.targetDate) return { pct: pct, status: 'On track', why: 'below the ' + target + '% target' };
  const end = monthEnd(month);
  const span = Date.parse(o.targetDate) - Date.parse(planEffective);
  const share = span > 0 ? Math.max(0, Math.min(1, (Date.parse(end) - Date.parse(planEffective)) / span)) : 1;
  const expected = Math.round(base + (target - base) * share);
  const status = pct >= expected ? 'On track' : pct >= expected - 10 ? 'At risk' : 'Not met';
  return { pct: pct, status: status, why: 'expected about ' + expected + '% by ' + usDate(end) };
}

// Consecutive quarters, ending with the month's quarter, whose latest
// result is Not met.
function quartersNotMet(results, month) {
  const byQuarter = {};
  results.filter(function (r) { return r.month <= month; }).forEach(function (r) {
    const q = quarterOf(r.month);
    if (!byQuarter[q] || byQuarter[q].month < r.month) byQuarter[q] = r;
  });
  let q = quarterOf(month), n = 0;
  while (byQuarter[q] && byQuarter[q].status === 'Not met') { n++; q = prevQuarter(q); }
  return n;
}

// CAP Review: citations closed of all citations (objective 6a).
async function capProgress() {
  const items = await queryDatabaseAll(CAP_ITEMS_DB, null);
  const closed = items.filter(function (p) { return getPlainText(p.properties['Status']) === 'Closed'; }).length;
  return { closed: closed, total: items.length };
}

async function objectivesView(month) {
  if (!validMonth(month)) throw httpError(400, 'Choose a month.');
  const [plan, goalPages, objPages, resultPages, cap] = await Promise.all([
    planInEffect(),
    queryDatabaseAll(GOALS_DB, null),
    queryDatabaseAll(OBJECTIVES_DB, null),
    queryDatabaseAll(RESULTS_DB, null),
    capProgress().catch(function () { return null; })
  ]);
  const version = plan.current.version;
  const goals = goalPages.map(goalFromPage).filter(function (g) { return g.planVersion === version; })
    .sort(function (a, b) { return a.number - b.number; });
  const all = objPages.map(objectiveFromPage);
  const results = resultPages.map(resultFromPage);
  const last = shiftMonth(month, -1);
  // An objective's results include those of the objective it replaced
  // (and so on back), so history carries across Plan versions.
  function lineage(o) {
    const ids = [o.id];
    let cur = o, guard = 0;
    while (cur && cur.replaces && guard++ < 10) {
      ids.push(cur.replaces);
      cur = all.find(function (x) { return sameId(x.id, cur.replaces); });
    }
    return ids;
  }
  function decorate(o) {
    const ids = lineage(o);
    const mine = results.filter(function (r) { return ids.some(function (id) { return sameId(r.objectiveId, id); }); });
    const now = mine.find(function (r) { return r.month === month; }) || null;
    const before = mine.filter(function (r) { return r.month < month; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0] || null;
    const s = now ? suggestStatus(o, now.count, now.total, month, plan.current.effective) : null;
    return Object.assign(o, {
      result: now,
      lastResult: before && before.month === last ? before : null,
      previousResult: before,
      suggestion: s,
      quartersNotMet: quartersNotMet(mine, month)
    });
  }
  const byOrder = function (a, b) { return a.goalNumber - b.goalNumber || a.order - b.order; };
  const active = all.filter(function (o) { return (o.status === 'Active' || o.status === 'Retire at next version') && o.planVersion === version; }).sort(byOrder).map(decorate);
  const drafts = all.filter(function (o) { return o.status === 'Draft'; }).sort(byOrder);
  return {
    month: month,
    plan: plan.current,
    versions: plan.versions,
    goals: goals,
    objectives: active,
    drafts: drafts,
    cap: cap,
    statuses: STATUSES
  };
}

// ---------- writing: results ----------

async function objectiveById(id) {
  let page;
  try { page = await getPage(id); } catch (e) { throw httpError(404, 'That objective wasn\'t found.'); }
  if (page.in_trash || page.archived) throw httpError(404, 'That objective was deleted.');
  return objectiveFromPage(page);
}

async function saveResult(input, by) {
  const month = input.month;
  if (!validMonth(month)) throw httpError(400, 'Choose a month.');
  const o = await objectiveById(input.objectiveId);
  const plan = (await planInEffect()).current;
  let count = numVal(input.count), total = numVal(input.total);
  if (o.fromCap) {
    const cap = await capProgress();
    count = cap.closed; total = cap.total;
  }
  if (o.measureType === 'Count of total' && !o.fromCap) {
    if ((count === null) !== (total === null)) throw httpError(400, o.code + ': enter both the count and the total.');
    if (total !== null && (total <= 0 || count < 0 || count > total || !Number.isInteger(count) || !Number.isInteger(total))) throw httpError(400, o.code + ': the count must be a whole number from 0 to the total.');
  }
  const valueText = clean(input.valueText, 2000);
  const status = input.status || '';
  if (status && STATUSES.indexOf(status) === -1) throw httpError(400, 'Unknown status.');
  if (input.followDue && !validIso(input.followDue)) throw httpError(400, 'Choose a valid follow-up due date.');
  const s = suggestStatus(o, count, total, month, plan.effective);
  const props = {
    'Summary': title(o.code + (o.service ? ' ' + o.service : '') + ' ' + month),
    'Objective ID': richText(o.id),
    'Code': richText(o.code),
    'Month': richText(month),
    'Plan Version': richText(o.planVersion),
    'Count': num(count),
    'Total': num(total),
    'Percent': num(total ? Math.round(count / total * 100) : null),
    'Value Text': richText(valueText),
    'Status': select(status || null),
    'Suggested Status': select(s && s.status ? s.status : null),
    'Comment': richText(clean(input.comment, 2000)),
    'Cause': richText(clean(input.cause, 2000)),
    'Revised Action': richText(clean(input.revisedAction, 2000)),
    'Follow-up Owner': richText(clean(input.followOwner, 200)),
    'Follow-up Due': dateProp(input.followDue || ''),
    'Entered By': richText(by),
    'Entered Date': dateProp(todayIso())
  };
  const existing = (await queryDatabaseAll(RESULTS_DB, { and: [
    { property: 'Objective ID', rich_text: { equals: o.id } },
    { property: 'Month', rich_text: { equals: month } }
  ] }))[0];
  const page = existing ? await updatePage(existing.id, props) : await createPage(RESULTS_DB, props);
  return Object.assign(resultFromPage(page), { suggestion: s });
}

// ---------- writing: objectives and Plan versions ----------

function objectiveProps(f) {
  const p = {};
  if ('code' in f) p['Code'] = title(f.code);
  if ('planVersion' in f) p['Plan Version'] = richText(f.planVersion);
  if ('goalNumber' in f) p['Goal Number'] = num(f.goalNumber);
  if ('service' in f) p['Service'] = select(f.service || null);
  if ('order' in f) p['Order'] = num(f.order);
  if ('objective' in f) p['Objective'] = richText(f.objective);
  if ('measureType' in f) p['Measure Type'] = select(f.measureType);
  if ('baseline' in f) p['Baseline'] = richText(f.baseline);
  if ('baselineValue' in f) p['Baseline Value'] = num(f.baselineValue);
  if ('target' in f) p['Target'] = richText(f.target);
  if ('targetValue' in f) p['Target Value'] = num(f.targetValue);
  if ('targetDate' in f) p['Target Date'] = dateProp(f.targetDate || '');
  if ('trend' in f) p['Trend'] = select(f.trend || null);
  if ('dataSource' in f) p['Data Source'] = richText(f.dataSource);
  if ('owner' in f) p['Owner'] = richText(f.owner);
  if ('review' in f) p['Review'] = richText(f.review);
  if ('status' in f) p['Status'] = select(f.status);
  if ('replaces' in f) p['Replaces'] = richText(f.replaces);
  if ('draftNote' in f) p['Draft Note'] = richText(f.draftNote);
  if ('fromCap' in f) p['From CAP Review'] = { checkbox: !!f.fromCap };
  return p;
}

function cleanObjectiveInput(f) {
  const out = {};
  ['code', 'objective', 'baseline', 'target', 'dataSource', 'owner', 'review', 'draftNote'].forEach(function (k) { if (k in f) out[k] = clean(f[k], 2000); });
  if ('measureType' in f) { if (['Count of total', 'Text'].indexOf(f.measureType) === -1) throw httpError(400, 'Unknown measure type.'); out.measureType = f.measureType; }
  if ('trend' in f) { if (f.trend && ['Reach by date', 'Hold each period'].indexOf(f.trend) === -1) throw httpError(400, 'Unknown trend.'); out.trend = f.trend || ''; }
  if ('service' in f) { if (f.service && SERVICES.indexOf(f.service) === -1) throw httpError(400, 'Unknown service.'); out.service = f.service || ''; }
  ['baselineValue', 'targetValue', 'goalNumber'].forEach(function (k) { if (k in f) out[k] = numVal(f[k]); });
  if ('targetDate' in f) { if (f.targetDate && !validIso(f.targetDate)) throw httpError(400, 'Choose a valid target date.'); out.targetDate = f.targetDate || ''; }
  return out;
}

// Plan objectives must be measurable (620.C.2).
function requireMeasurable(o) {
  if (!o.objective) throw httpError(400, 'Write the objective.');
  if (!o.baseline) throw httpError(400, 'A Plan objective needs a baseline.');
  if (!o.target) throw httpError(400, 'A Plan objective needs a target (how much, by when).');
  if (o.measureType === 'Count of total' && (o.targetValue === null || o.targetValue === undefined || isNaN(o.targetValue))) throw httpError(400, 'Give the target amount as a percentage.');
  if (!o.goalNumber) throw httpError(400, 'Choose the goal.');
}

function nextCode(all, goalNumber) {
  const used = all.filter(function (o) { return Number(o.goalNumber) === Number(goalNumber) && o.status !== 'Retired'; })
    .map(function (o) { return o.code.replace(/^\d+/, ''); });
  for (let c = 97; c < 123; c++) { if (used.indexOf(String.fromCharCode(c)) === -1) return goalNumber + String.fromCharCode(c); }
  return goalNumber + 'x';
}

// Owner, data source and review change in place; anything else makes (or
// updates) a draft that replaces this objective at the next version.
async function editObjective(id, changes, by) {
  const o = await objectiveById(id);
  const f = cleanObjectiveInput(changes);
  const free = {};
  ['owner', 'dataSource', 'review'].forEach(function (k) { if (k in f && f[k] !== o[k]) free[k] = f[k]; });
  const versioned = {};
  VERSIONED.forEach(function (k) { if (k in f && String(f[k] == null ? '' : f[k]) !== String(o[k] == null ? '' : o[k])) versioned[k] = f[k]; });
  if (o.status === 'Draft') {
    const merged = Object.assign({}, o, free, versioned);
    requireMeasurable(merged);
    await updatePage(o.id, Object.assign(objectiveProps(Object.assign({}, free, versioned)), { 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) }));
    return { updated: Object.keys(free).concat(Object.keys(versioned)), draft: null };
  }
  if (Object.keys(free).length) {
    await updatePage(o.id, Object.assign(objectiveProps(free), { 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) }));
  }
  let draft = null;
  if (Object.keys(versioned).length) {
    const all = (await queryDatabaseAll(OBJECTIVES_DB, null)).map(objectiveFromPage);
    const existing = all.find(function (d) { return d.status === 'Draft' && sameId(d.replaces, o.id); });
    const merged = Object.assign({}, existing || o, free, versioned);
    requireMeasurable(merged);
    // The note lists every field the draft changes from the objective in effect.
    const diff = VERSIONED.filter(function (k) { return String(merged[k] == null ? '' : merged[k]) !== String(o[k] == null ? '' : o[k]); });
    const note = 'Changes ' + o.code + (o.service ? ' (' + o.service + ')' : '') + ': ' + diff.map(function (k) { return LABELS[k] || k; }).join(', ') + '.';
    if (existing) {
      await updatePage(existing.id, Object.assign(objectiveProps(Object.assign({}, versioned, { draftNote: note })), { 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) }));
      draft = existing.id;
    } else {
      const fields = Object.assign({}, o, free, versioned, { status: 'Draft', replaces: o.id, planVersion: '', draftNote: note });
      delete fields.id;
      const page = await createPage(OBJECTIVES_DB, Object.assign(objectiveProps(fields), { 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) }));
      draft = page.id;
    }
  }
  return { updated: Object.keys(free), draft: draft, versionTrigger: !!draft };
}

async function addDraftObjective(input, by, extraNote) {
  const f = cleanObjectiveInput(input);
  f.measureType = f.measureType || 'Count of total';
  f.trend = f.trend || 'Reach by date';
  requireMeasurable(f);
  const all = (await queryDatabaseAll(OBJECTIVES_DB, null)).map(objectiveFromPage);
  const code = f.code || nextCode(all, f.goalNumber);
  const order = Math.max.apply(null, [0].concat(all.map(function (o) { return Number(o.order) || 0; }))) + 1;
  const page = await createPage(OBJECTIVES_DB, Object.assign(objectiveProps(Object.assign({}, f, {
    code: code, order: order, status: 'Draft', planVersion: '', draftNote: extraNote || ('New objective ' + code + ' proposed for the next Plan version.')
  })), { 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) }));
  return objectiveFromPage(page);
}

async function setRetire(id, retire, by) {
  const o = await objectiveById(id);
  if (o.status === 'Draft') {
    await updatePage(o.id, { 'Status': select('Retired'), 'Draft Note': richText('Draft discarded by ' + by + ' on ' + usDate(todayIso()) + '.') });
    return { discarded: true };
  }
  if (o.status !== 'Active' && o.status !== 'Retire at next version') throw httpError(400, 'That objective isn\'t in the current Plan.');
  await updatePage(o.id, { 'Status': select(retire ? 'Retire at next version' : 'Active'), 'Updated By': richText(by), 'Updated Date': dateProp(todayIso()) });
  return { retire: !!retire };
}

async function editGoalNotes(id, notes) {
  let page;
  try { page = await getPage(id); } catch (e) { throw httpError(404, 'That goal wasn\'t found.'); }
  await updatePage(page.id, { 'Notes': richText(clean(notes, 4000)) });
  return goalFromPage(await getPage(page.id));
}

// Adopt a new Plan version: drafts become Active, the objectives they
// replace and those marked to retire become Retired, everything else
// carries over; the previous version gets its Superseded On date.
async function adoptVersion(input, by) {
  const version = clean(input.version, 20);
  if (!/^\d{8}$/.test(version)) throw httpError(400, 'Name the version yyyymmdd (the adoption date), e.g. 20270115.');
  const effective = input.effective;
  if (!validIso(effective)) throw httpError(400, 'Choose the date the new version takes effect.');
  const plan = await planInEffect();
  if (plan.versions.some(function (v) { return v.version === version; })) throw httpError(409, 'Version ' + version + ' already exists.');
  if (effective < plan.current.effective) throw httpError(400, 'The new version can\'t take effect before the current one (' + usDate(plan.current.effective) + ').');
  const all = (await queryDatabaseAll(OBJECTIVES_DB, null)).map(objectiveFromPage);
  const goals = (await queryDatabaseAll(GOALS_DB, null)).map(goalFromPage).filter(function (g) { return g.planVersion === plan.current.version; });
  const replaced = all.filter(function (o) { return o.status === 'Draft' && o.replaces; }).map(function (o) { return o.replaces; });
  const writes = [];
  all.forEach(function (o) {
    // Replaces stays set, so the revised objective keeps the earlier months' results.
    if (o.status === 'Draft') writes.push([o.id, { 'Status': select('Active'), 'Plan Version': richText(version), 'Draft Note': richText('') }]);
    else if (o.planVersion === plan.current.version && (o.status === 'Retire at next version' || replaced.some(function (r) { return sameId(r, o.id); }))) writes.push([o.id, { 'Status': select('Retired') }]);
    else if (o.planVersion === plan.current.version && o.status === 'Active') writes.push([o.id, { 'Plan Version': richText(version) }]);
  });
  goals.forEach(function (g) { writes.push([g.id, { 'Plan Version': richText(version) }]); });
  for (let i = 0; i < writes.length; i += 3) {
    await Promise.all(writes.slice(i, i + 3).map(function (w) { return updatePage(w[0], w[1]); }));
  }
  await updatePage(plan.current.id, { 'Superseded On': dateProp(effective) });
  await createPage(VERSIONS_DB, {
    'Version': title(version),
    'Effective Date': dateProp(effective),
    'Approved By': richText(clean(input.approvedBy, 200) || by),
    'Changes': richText(clean(input.changes, 4000))
  });
  return { version: version, superseded: plan.current.version, changed: writes.length };
}

// ---------- issues and opportunities (QI Improvement Items Tracker) ----------

function itemFromPage(p) {
  const r = p.properties;
  const idProp = r['ID'];
  const multi = function (prop) { return prop && prop.multi_select ? prop.multi_select.map(function (o) { return o.name; }) : []; };
  return {
    id: p.id,
    number: idProp && idProp.unique_id ? idProp.unique_id.number : null,
    title: getPlainText(r['Improvement and measure']),
    type: getPlainText(r['Type']),
    status: getPlainText(r['Status']) || 'Open',
    description: getPlainText(r['Description']),
    source: getPlainText(r['Source']),
    sourceDetail: getPlainText(r['Source Detail']),
    area: getPlainText(r['Area']),
    locations: multi(r['Location / service']),
    goals: multi(r['Supports goal']),
    owner: getPlainText(r['Owner']),
    due: getPlainText(r['Due date']),
    completed: getPlainText(r['Completed date']),
    evidence: getPlainText(r['Evidence']),
    latestUpdate: getPlainText(r['Latest update']),
    notes: getPlainText(r['Notes']),
    promotedTo: getPlainText(r['Promoted to Plan objective']),
    addedBy: getPlainText(r['Added By']),
    dateAdded: getPlainText(r['Date Added']) || (p.created_time || '').slice(0, 10),
    lastUpdated: getPlainText(r['Last Updated'])
  };
}
function itemUpdateFromPage(p) {
  const r = p.properties;
  return { id: p.id, itemId: getPlainText(r['Item ID']), date: getPlainText(r['Date']), by: getPlainText(r['By']), text: getPlainText(r['Text']), kind: getPlainText(r['Kind']) || 'Update', created: p.created_time || '' };
}
function isOverdue(i, today) { return (i.status === 'Open' || i.status === 'On hold') && !!i.due && i.due < (today || todayIso()); }

async function itemsView() {
  const [pages, ups] = await Promise.all([queryDatabaseAll(ITEMS_DB, null), queryDatabaseAll(ITEM_UPDATES_DB, null)]);
  const updates = ups.map(itemUpdateFromPage);
  const today = todayIso();
  const items = pages.map(itemFromPage).map(function (i) {
    return Object.assign(i, {
      overdue: isOverdue(i, today),
      updates: updates.filter(function (u) { return sameId(u.itemId, i.id); })
        .sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.created < b.created ? 1 : -1); })
    });
  }).sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
  return { items: items, options: { types: ITEM_TYPES, statuses: ITEM_STATUSES, sources: SOURCES, areas: AREAS, locations: LOCATIONS, goals: GOAL_OPTIONS } };
}

async function itemById(id) {
  let page;
  try { page = await getPage(id); } catch (e) { throw httpError(404, 'That item wasn\'t found.'); }
  if (page.in_trash || page.archived) throw httpError(404, 'That item was deleted.');
  return itemFromPage(page);
}

function itemLabel(i) { return 'QI-' + (i.number || '?'); }

function itemFields(f, creating) {
  const p = {};
  if ('title' in f) { const t = clean(f.title, 300); if (!t) throw httpError(400, 'Give the item a short title.'); p['Improvement and measure'] = title(t); }
  if ('type' in f) { if (ITEM_TYPES.indexOf(f.type) === -1) throw httpError(400, 'Choose Issue or Opportunity.'); p['Type'] = select(f.type); }
  if ('status' in f) { if (['Idea', 'Open', 'On hold'].indexOf(f.status) === -1) throw httpError(400, 'Use Complete, Drop or Promote to close an item.'); p['Status'] = select(f.status); }
  if ('description' in f) p['Description'] = richText(clean(f.description, 4000));
  if ('source' in f) { if (f.source && SOURCES.indexOf(f.source) === -1) throw httpError(400, 'Unknown source.'); p['Source'] = select(f.source || null); }
  if ('sourceDetail' in f) p['Source Detail'] = richText(clean(f.sourceDetail, 500));
  if ('area' in f) { if (f.area && AREAS.indexOf(f.area) === -1) throw httpError(400, 'Unknown area.'); p['Area'] = select(f.area || null); }
  if ('locations' in f) { const l = (f.locations || []).filter(function (x) { return LOCATIONS.indexOf(x) !== -1; }); p['Location / service'] = { multi_select: l.map(function (n) { return { name: n }; }) }; }
  if ('goals' in f) { const g = (f.goals || []).filter(function (x) { return GOAL_OPTIONS.indexOf(x) !== -1; }); p['Supports goal'] = { multi_select: g.map(function (n) { return { name: n }; }) }; }
  if ('owner' in f) p['Owner'] = richText(clean(f.owner, 200));
  if ('due' in f) { if (f.due && !validIso(f.due)) throw httpError(400, 'Choose a valid due date.'); p['Due date'] = dateProp(f.due || ''); }
  if (creating && !p['Type']) throw httpError(400, 'Choose Issue or Opportunity.');
  return p;
}

async function addItemUpdateRow(item, kind, text, by, date) {
  await createPage(ITEM_UPDATES_DB, {
    'Summary': title(itemLabel(item) + ' ' + kind + ' ' + usDate(date)),
    'Item ID': richText(item.id),
    'Date': dateProp(date),
    'By': richText(by),
    'Text': richText(text),
    'Kind': select(kind)
  });
  await updatePage(item.id, { 'Latest update': richText(usDate(date) + ' (' + by + '): ' + text), 'Last Updated': dateProp(todayIso()) });
}

async function createItem(input, by) {
  const props = itemFields(Object.assign({ status: input.status || 'Open' }, input), true);
  props['Added By'] = richText(by);
  props['Date Added'] = dateProp(todayIso());
  props['Last Updated'] = dateProp(todayIso());
  return itemFromPage(await createPage(ITEMS_DB, props));
}

async function editItem(id, changes, by) {
  const item = await itemById(id);
  if (['Completed', 'Dropped', 'Promoted to Plan'].indexOf(item.status) !== -1) throw httpError(400, itemLabel(item) + ' is closed (' + item.status + ').');
  const props = itemFields(changes, false);
  props['Last Updated'] = dateProp(todayIso());
  await updatePage(item.id, props);
  return itemById(item.id);
}

async function addItemUpdate(id, input, by) {
  const item = await itemById(id);
  if (['Completed', 'Dropped', 'Promoted to Plan'].indexOf(item.status) !== -1) throw httpError(400, itemLabel(item) + ' is closed (' + item.status + ').');
  const text = clean(input.text, 4000);
  if (!text) throw httpError(400, 'Write the update.');
  const date = input.date || todayIso();
  if (!validIso(date)) throw httpError(400, 'Choose a valid date.');
  const changes = {};
  if (input.status && input.status !== item.status) changes.status = input.status;
  if ('due' in input && (input.due || '') !== (item.due || '')) changes.due = input.due;
  let note = text;
  if (changes.status) note += '\n(Status: ' + item.status + ' -> ' + changes.status + '.)';
  if ('due' in changes) note += '\n(Due date: ' + (item.due ? usDate(item.due) : 'none') + ' -> ' + (changes.due ? usDate(changes.due) : 'none') + '.)';
  if (Object.keys(changes).length) await updatePage(item.id, itemFields(changes, false));
  await addItemUpdateRow(item, 'Update', note, by, date);
  return itemById(item.id);
}

async function completeItem(id, input, by) {
  const item = await itemById(id);
  if (['Completed', 'Dropped', 'Promoted to Plan'].indexOf(item.status) !== -1) throw httpError(400, itemLabel(item) + ' is already ' + item.status + '.');
  const evidence = clean(input.evidence, 4000);
  const link = clean(input.evidenceLink, 1000);
  const date = input.date || todayIso();
  if (evidence.length < 10) throw httpError(400, 'Describe the evidence that ' + itemLabel(item) + ' is done.');
  if (link && !/^https:\/\/\S+$/.test(link)) throw httpError(400, 'The evidence link must start with https://');
  if (!validIso(date) || date > todayIso()) throw httpError(400, 'Choose a valid completed date (not in the future).');
  await updatePage(item.id, { 'Status': select('Completed'), 'Completed date': dateProp(date), 'Evidence': { url: link || null } });
  await addItemUpdateRow(item, 'Completed', 'Completed. Evidence: ' + evidence + (link ? '\nLink: ' + link : ''), by, date);
  return itemById(item.id);
}

async function dropItem(id, input, by) {
  const item = await itemById(id);
  if (['Completed', 'Dropped', 'Promoted to Plan'].indexOf(item.status) !== -1) throw httpError(400, itemLabel(item) + ' is already ' + item.status + '.');
  const reason = clean(input.reason, 2000);
  if (reason.length < 5) throw httpError(400, 'Say why ' + itemLabel(item) + ' is being dropped.');
  await updatePage(item.id, { 'Status': select('Dropped') });
  await addItemUpdateRow(item, 'Dropped', 'Dropped: ' + reason, by, todayIso());
  return itemById(item.id);
}

// Promote: a draft objective for the next Plan version (baseline and
// target required), and the item is marked Promoted to Plan.
async function promoteItem(id, input, by) {
  const item = await itemById(id);
  if (['Completed', 'Dropped', 'Promoted to Plan'].indexOf(item.status) !== -1) throw httpError(400, itemLabel(item) + ' is already ' + item.status + '.');
  const draft = await addDraftObjective(Object.assign({ objective: input.objective || item.title }, input), by, 'Promoted from ' + itemLabel(item) + ' (' + item.title + ').');
  await updatePage(item.id, { 'Status': select('Promoted to Plan'), 'Promoted to Plan objective': richText('Draft objective ' + draft.code + ' for the next Plan version') });
  await addItemUpdateRow(item, 'Promoted', 'Promoted to a draft Plan objective (' + draft.code + ') for the next Plan version.', by, todayIso());
  return { item: await itemById(item.id), draft: draft };
}

module.exports = {
  STATUSES, httpError, todayIso, usDate, monthEnd, shiftMonth, quarterOf,
  requireQiAccess, planInEffect, objectivesView, suggestStatus, quartersNotMet, resultText, capProgress,
  saveResult, editObjective, addDraftObjective, setRetire, editGoalNotes, adoptVersion,
  itemsView, createItem, editItem, addItemUpdate, completeItem, dropItem, promoteItem, isOverdue
};
