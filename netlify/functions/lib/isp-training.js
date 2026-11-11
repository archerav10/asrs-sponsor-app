const crypto = require('crypto');
const { queryDatabaseAll, updatePage, createPage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');
const annualPlanning = require('./annual-planning');

// ISP training: every active staff member at a location has to be trained
// on each resident's current Individualized Service Plan (the Congregate
// Residential plan from Annual Planning), and signs an ISP Training
// Acknowledgment (JotForm) as the evidence.
//
//   Which plan: the resident's Annual Planning cycle on file. Its plan date
//   is the cycle's Effective Date, or the Plan Revised Date when the plan
//   was revised mid-year (Plan revised on the Annual Planning screen).
//   Existing staff: due before the plan date, so a new cycle shows as due
//   as soon as it's set up. Anyone not trained on the current plan date
//   once it has passed (a revision, or a new staff member) is missing:
//   new staff are trained by the end of orientation, before they work
//   with the resident.
//
// One ISP Training row per signed acknowledgment (Location, Resident
// Initials, Plan Date, Staff ID/Name, Trained Date, Trained By, Filename,
// File URL). They feed Staff Training as extra Part A lines, one per
// resident ("Resident plans (ISP)"), so every place that reads staff
// training (oversight, the ASRS-450-01 report, Compliance, the digest)
// counts them too.

const ISP_TRAINING_DB_ID = configId('ISP_TRAINING_DB_ID');
const ISP_SERVICE = annualPlanning.DEFAULT_SERVICE;
const SECTION = 'Resident plans (ISP)';
const KEY_PREFIX = 'Plan_';
const CONTEXT_TTL_MS = 15 * 1000;

function sameId(a, b) {
  return (a || '').replace(/-/g, '').toLowerCase() === (b || '').replace(/-/g, '').toLowerCase() && !!a;
}

function usDate(iso) {
  const p = (iso || '').slice(0, 10).split('-');
  return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) + '/' + p[0] : (iso || '');
}

function todayEastern(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}

// { resident, effectiveDate, revisedDate, planDate, revised, recordId } for
// one Resident Annual Planning page (Congregate Residential only).
function planFromPage(page) {
  const effectiveDate = getPlainText(page.properties['Effective Date']) || '';
  const revisedDate = getPlainText(page.properties['Plan Revised Date']) || '';
  const revised = !!revisedDate && !!effectiveDate && revisedDate > effectiveDate;
  return {
    recordId: page.id,
    location: getPlainText(page.properties['Location']),
    resident: getPlainText(page.properties['Resident Initials']),
    effectiveDate: effectiveDate,
    revisedDate: revised ? revisedDate : '',
    planDate: revised ? revisedDate : effectiveDate,
    revised: revised
  };
}

async function plansForLocation(location) {
  const pages = await queryDatabaseAll(annualPlanning.ANNUAL_PLANNING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { or: [{ property: 'Service', select: { equals: ISP_SERVICE } }, { property: 'Service', select: { is_empty: true } }] }
    ]
  });
  return pages.map(planFromPage)
    .filter(function (p) { return p.resident && p.planDate; })
    .sort(function (a, b) { return a.resident.localeCompare(b.resident); });
}

function rowFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    resident: getPlainText(p['Resident Initials']),
    planDate: (getPlainText(p['Plan Date']) || '').slice(0, 10),
    staffId: getPlainText(p['Staff ID']),
    staffName: getPlainText(p['Staff Name']),
    trainedDate: (getPlainText(p['Trained Date']) || '').slice(0, 10),
    trainedBy: getPlainText(p['Trained By']),
    filename: getPlainText(p['Filename']),
    fileUrl: getPlainText(p['File URL'])
  };
}

async function rowsForLocation(location) {
  const pages = await queryDatabaseAll(ISP_TRAINING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return pages.map(rowFromPage);
}

// Plans and acknowledgments for a location, shared for a few seconds so a
// screen that works through several staff members reads them once.
const contextCache = {};
async function contextForLocation(location, options) {
  const hit = contextCache[location];
  if (!(options && options.fresh) && hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value;
  const results = await Promise.all([plansForLocation(location), rowsForLocation(location)]);
  const value = { plans: results[0], rows: results[1] };
  contextCache[location] = { at: Date.now(), value: value };
  return value;
}

function forget(location) { delete contextCache[location]; }

function rowFor(rows, plan, member) {
  return rows.filter(function (r) {
    return r.resident === plan.resident && r.planDate === plan.planDate &&
      (r.staffId ? sameId(r.staffId, member.id) : r.staffName === member.name);
  }).sort(function (a, b) { return a.trainedDate < b.trainedDate ? 1 : -1; })[0] || null;
}

// current: signed for this plan date; soon: not yet, and the plan date is
// still ahead (due by then); missing: not signed and the plan date has
// passed (a revision, or someone new).
function statusFor(plan, row, now) {
  if (row) return 'current';
  return todayEastern(now) < plan.planDate ? 'soon' : 'missing';
}

function planLabel(plan) {
  return plan.resident + ' · ISP ' + (plan.revised ? 'revised ' : 'effective ') + usDate(plan.planDate);
}

// Staff Training lines for one person: one per resident with a plan, in
// the same shape as lib/staff-training.js's fullStepList entries (plus
// `plan`), so every screen and report can treat them like any other item.
function planSteps(member, context, now) {
  return context.plans.map(function (plan) {
    const row = rowFor(context.rows, plan, member);
    const state = statusFor(plan, row, now);
    return {
      key: KEY_PREFIX + plan.resident,
      label: planLabel(plan),
      part: 'Annual training & certification',
      section: SECTION,
      renewYears: 0,
      formUrl: '',
      done: !!row,
      filename: row ? row.filename : '',
      completedDate: row ? row.trainedDate : '',
      expDate: row ? '' : plan.planDate,
      fromIntake: false,
      notApplicable: false,
      state: state,
      plan: {
        resident: plan.resident,
        planDate: plan.planDate,
        revised: plan.revised,
        trainedBy: row ? row.trainedBy : '',
        fileUrl: row ? row.fileUrl : ''
      }
    };
  });
}

// ---------- signing links ----------
// The acknowledgment's hidden app_filename field carries
// ISP_{staffId}_{resident}_{planDate YYYYMMDD}_{sig}; sig is a short HMAC,
// so a submission proves it came from a link the app made for that
// person, resident and plan (same idea as the intake form links), and the
// Zapier workflow needs no secret.
function signature(staffId, resident, planDate) {
  return crypto.createHmac('sha256', Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'hex'))
    .update('isp-training:' + staffId.replace(/-/g, '').toLowerCase() + ':' + resident + ':' + planDate)
    .digest('hex').slice(0, 16);
}

function trackingValue(staffId, resident, planDate) {
  return 'ISP_' + staffId.replace(/-/g, '').toLowerCase() + '_' + resident + '_' + planDate.replace(/-/g, '') + '_' + signature(staffId, resident, planDate);
}

// { staffId, resident, planDate } from a tracking value (it can sit inside
// a longer file name), or null when it's missing or the signature is wrong.
function parseTracking(text) {
  const m = (text || '').match(/ISP_([0-9a-f]{32})_([A-Za-z0-9]+)_(\d{8})_([0-9a-f]{16})/);
  if (!m) return null;
  const planDate = m[3].slice(0, 4) + '-' + m[3].slice(4, 6) + '-' + m[3].slice(6, 8);
  const expected = signature(m[1], m[2], planDate);
  if (!crypto.timingSafeEqual(Buffer.from(m[4]), Buffer.from(expected))) return null;
  return { staffId: m[1], resident: m[2], planDate: planDate, tracking: m[0] };
}

// The site a request came in on (so a deploy preview links to itself),
// else the site's own URL.
function siteFor(event) {
  const headers = (event && event.headers) || {};
  const host = headers['x-forwarded-host'] || headers.host || '';
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? 'https://' + host : (process.env.URL || '');
}

// The short link that opens the acknowledgment, safe to text: /isp/{tracking}
// (netlify.toml sends it to isp-sign.js, which fills in the form).
function signingLink(site, member, plan) {
  return (site || process.env.URL || '').replace(/\/+$/, '') + '/isp/' + trackingValue(member.id, plan.resident, plan.planDate);
}

// The JotForm URL with everything prefilled.
function formUrl(member, plan) {
  const url = new URL(configId('ISP_TRAINING_FORM_URL'));
  url.searchParams.set('staffName', member.name);
  url.searchParams.set('location', member.location);
  url.searchParams.set('resident', plan.resident);
  url.searchParams.set('planDate', usDate(plan.planDate) + (plan.revised ? ' (revised plan)' : ''));
  url.searchParams.set('app_filename', trackingValue(member.id, plan.resident, plan.planDate));
  return url.toString();
}

// The signed PDF's name in the staff member's Training folder. Starts
// with Plan_{resident} so the Drive check (lib/staff-training.js) knows it.
function evidenceFilename(member, plan, trainedDate) {
  const who = (member.name || '').replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
  return KEY_PREFIX + plan.resident + '_' + trainedDate + '_ISP-Acknowledgment_' + who + '.pdf';
}

// Records one acknowledgment (idempotent per person, resident and plan
// date: a second signature updates the same row).
async function recordTraining(member, plan, fields) {
  const rows = await rowsForLocation(member.location);
  const existing = rowFor(rows, plan, member);
  const props = {
    'Trained Date': { date: { start: fields.trainedDate } },
    'Trained By': { rich_text: fields.trainedBy ? [{ text: { content: String(fields.trainedBy).slice(0, 200) } }] : [] },
    'Filename': { rich_text: fields.filename ? [{ text: { content: fields.filename } }] : [] },
    'File URL': { url: fields.fileUrl || null },
    'Recorded By': { rich_text: [{ text: { content: fields.recordedBy || '' } }] }
  };
  if (existing) {
    await updatePage(existing.id, props);
  } else {
    await createPage(ISP_TRAINING_DB_ID, Object.assign({
      'Record Title': { title: [{ text: { content: member.location + ' - ' + plan.resident + ' - ' + plan.planDate + ' - ' + member.name } }] },
      'Location': { select: { name: member.location } },
      'Resident Initials': { rich_text: [{ text: { content: plan.resident } }] },
      'Plan Date': { date: { start: plan.planDate } },
      'Staff Name': { rich_text: [{ text: { content: member.name } }] },
      'Staff ID': { rich_text: [{ text: { content: member.id } }] },
      'Active': { checkbox: true }
    }, props));
  }
  forget(member.location);
}

// The plan a resident currently needs training on, or null.
async function currentPlan(location, resident) {
  const plans = await plansForLocation(location);
  return plans.find(function (p) { return p.resident === resident; }) || null;
}

// Plan revised: records the revision date on the resident's Annual
// Planning record. Staff then need training dated for the revision.
async function markRevised(location, resident, revisedDate, by) {
  const plan = await currentPlan(location, resident);
  if (!plan) {
    const err = new Error('Set up this resident\'s Annual Planning cycle first.');
    err.statusCode = 400;
    throw err;
  }
  if (revisedDate <= plan.effectiveDate) {
    const err = new Error('The revision date has to be after the plan\'s effective date (' + usDate(plan.effectiveDate) + ').');
    err.statusCode = 400;
    throw err;
  }
  await updatePage(plan.recordId, {
    'Plan Revised Date': { date: { start: revisedDate } },
    'Last Updated By': { rich_text: [{ text: { content: by || '' } }] },
    'Last Updated Date': { date: { start: todayEastern() } }
  });
  forget(location);
}

module.exports = {
  ISP_TRAINING_DB_ID, ISP_SERVICE, SECTION, KEY_PREFIX,
  usDate, todayEastern, sameId,
  plansForLocation, rowsForLocation, contextForLocation, forget,
  rowFor, statusFor, planLabel, planSteps,
  trackingValue, parseTracking, siteFor, signingLink, formUrl, evidenceFilename,
  recordTraining, currentPlan, markRevised
};
