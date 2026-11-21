const { queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { readXlsx, excelDate } = require('./xlsx');
const { id: configId } = require('./ids');
const qi = require('./qi-rm');

// Policy register (QI & RM > Policies): ASRS policies and the documents
// tied to them, from the ASRS-620-08 Policy-Document Register (one Excel
// file per licensed service: Policy Index and Document Register sheets),
// plus every review logged on the dashboard. Feeds the P&P review block of
// Section 9 of the monthly QI & RM report.
//
//   Import: a register .xlsx is matched to what's here by policy section +
//   title (documents by name + form ID); a policy in both services'
//   registers is one row with both services. Re-importing updates register
//   fields and keeps the dashboard's review history.
//   Mark reviewed: logs the review (scheduled or triggered), moves Last
//   Reviewed and Next Review Due (+12 months), and when the policy was
//   revised, records the new revised date and flags its related documents
//   In Sync = Review unless they were updated at the same time.
//   CAP citations of a section (e.g. 12VAC35-105-440.4) flag the policy as
//   triggered until a review after the citation is logged.

const POLICIES_DB = configId('POLICIES_DB_ID');
const DOCS_DB = configId('POLICY_DOCUMENTS_DB_ID');
const REVIEWS_DB = configId('POLICY_REVIEWS_DB_ID');
const CAP_ITEMS_DB = configId('CAP_ITEMS_DB_ID');
const CAPS_DB = configId('CAPS_DB_ID');
const SERVICES = ['Group Home', 'Sponsored Residential', 'Community Engagement'];
const TRIGGERS = ['Scheduled annual review', 'DBHDS regulation or guidance change', 'Citation', 'RCA or SRA finding', 'System change', 'Other'];

function httpError(s, m) { const e = new Error(m); e.statusCode = s; return e; }
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function key(s) { return norm(s).toLowerCase().replace(/[–—]/g, '-'); }
function richText(s) { const t = String(s == null ? '' : s); const runs = []; for (let i = 0; i < t.length && runs.length < 100; i += 2000) runs.push({ text: { content: t.slice(i, i + 2000) } }); return { rich_text: runs }; }
function title(s) { return { title: [{ text: { content: String(s || '').slice(0, 2000) } }] }; }
function dateProp(iso) { return { date: iso ? { start: iso } : null }; }
function multi(list) { return { multi_select: (list || []).map(function (n) { return { name: n }; }) }; }
function sameId(a, b) { return String(a || '').replace(/-/g, '').toLowerCase() === String(b || '').replace(/-/g, '').toLowerCase(); }
function addYear(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); }
function validIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s)); }

// 20261026 -> 2026-10-26; Excel serials and m/d/yyyy too.
function regDate(v) {
  const s = norm(v);
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return excelDate(typeof v === 'number' ? v : s);
}

// "1160-1235" contains 1180; "440" is 440.
function sectionMatches(section, num) {
  const s = norm(section);
  const r = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (r) return num >= Number(r[1]) && num <= Number(r[2]);
  return s === String(num);
}
// Policy numbers named in a document's "Governing policy" / "Policies that mention it".
function policyNumbers(text) { return (String(text || '').match(/\d{3,4}/g) || []).map(Number); }

// ---------- reading a register .xlsx ----------

function serviceFromName(name) {
  const n = String(name || '').toLowerCase();
  return SERVICES.find(function (s) { return n.indexOf(s.toLowerCase()) !== -1; }) || '';
}

function parseRegister(buffer) {
  let wb;
  try { wb = readXlsx(buffer); } catch (e) { throw httpError(400, 'Couldn\'t read that file as Excel (.xlsx): ' + e.message); }
  const pi = wb.sheet('Policy Index');
  const dr = wb.sheet('Document Register');
  if (!pi) throw httpError(400, 'This doesn\'t look like the Policy-Document Register: there is no Policy Index sheet.');
  const h = pi[0] || [];
  const col = function (rows, hr, re) { return (rows[hr] || []).findIndex(function (x) { return re.test(norm(x)); }); };
  const c = { section: col(pi, 0, /^section/i), title: col(pi, 0, /^title/i), status: col(pi, 0, /^status/i), folder: col(pi, 0, /folder/i), file: col(pi, 0, /^file name/i), effective: col(pi, 0, /^effective/i), revised: col(pi, 0, /last revised/i), due: col(pi, 0, /next .*review/i) };
  if (c.section < 0 || c.title < 0) throw httpError(400, 'The Policy Index needs Section and Title columns.');
  const policies = pi.slice(1).filter(function (r) { return norm(r[c.section]) && norm(r[c.title]); }).map(function (r) {
    const status = norm(r[c.status]);
    return {
      section: norm(r[c.section]), title: norm(r[c.title]), status: status,
      active: /^current/i.test(status) || /^internal/i.test(status),
      folder: norm(r[c.folder]), fileName: norm(r[c.file]),
      effective: regDate(r[c.effective]), lastRevised: regDate(r[c.revised]), nextDue: regDate(r[c.due])
    };
  });
  let documents = [];
  if (dr) {
    const hr = dr.findIndex(function (r) { return (r || []).some(function (x) { return norm(x) === 'Document'; }) && (r || []).some(function (x) { return norm(x) === '#'; }); });
    if (hr >= 0) {
      const d = { num: col(dr, hr, /^#$/), area: col(dr, hr, /^area/i), doc: col(dr, hr, /^document$/i), form: col(dr, hr, /form id/i), gov: col(dr, hr, /^governing/i), mention: col(dr, hr, /mention/i), kept: col(dr, hr, /where kept/i), status: col(dr, hr, /^status/i), file: col(dr, hr, /^file name/i), link: col(dr, hr, /^link/i), version: col(dr, hr, /document version/i), sync: col(dr, hr, /in sync/i), notes: col(dr, hr, /^notes/i) };
      documents = dr.slice(hr + 1).filter(function (r) { return norm(r[d.doc]); }).map(function (r) {
        const sync = norm(r[d.sync]);
        const link = norm(r[d.link]);
        return {
          number: Number(r[d.num]) || null, area: norm(r[d.area]), document: norm(r[d.doc]), formId: norm(r[d.form]),
          governing: norm(r[d.gov]), mentions: norm(r[d.mention]), whereKept: norm(r[d.kept]), status: norm(r[d.status]),
          fileName: norm(r[d.file]), link: /^https:\/\//.test(link) ? link : '', version: regDate(r[d.version]),
          inSync: /review/i.test(sync) ? 'Review' : /current/i.test(sync) ? 'Current' : 'N/A', notes: norm(r[d.notes])
        };
      });
    }
  }
  return { policies: policies, documents: documents };
}

// ---------- Notion rows ----------

function policyFromPage(p) {
  const r = p.properties;
  return {
    id: p.id, title: getPlainText(r['Title']), section: getPlainText(r['Section']),
    services: r['Services'] && r['Services'].multi_select ? r['Services'].multi_select.map(function (o) { return o.name; }) : [],
    status: getPlainText(r['Register Status']), active: !!getPlainText(r['Active']),
    folder: getPlainText(r['Folder']), fileName: getPlainText(r['File Name']),
    effective: getPlainText(r['Effective']), lastRevised: getPlainText(r['Last Revised']), lastReviewed: getPlainText(r['Last Reviewed']),
    nextDue: getPlainText(r['Next Review Due']), notes: getPlainText(r['Notes'])
  };
}
function docFromPage(p) {
  const r = p.properties;
  return {
    id: p.id, document: getPlainText(r['Document']), number: getPlainText(r['Number']), area: getPlainText(r['Area']), formId: getPlainText(r['Form ID']),
    governing: getPlainText(r['Governing Policy']), mentions: getPlainText(r['Policies That Mention It']), whereKept: getPlainText(r['Where Kept']),
    status: getPlainText(r['Register Status']), fileName: getPlainText(r['File Name']), link: getPlainText(r['Link']),
    services: r['Services'] && r['Services'].multi_select ? r['Services'].multi_select.map(function (o) { return o.name; }) : [],
    version: getPlainText(r['Document Version']), inSync: getPlainText(r['In Sync']) || 'N/A', notes: getPlainText(r['Notes']),
    reconciledBy: getPlainText(r['Reconciled By']), reconciledDate: getPlainText(r['Reconciled Date'])
  };
}
function reviewFromPage(p) {
  const r = p.properties;
  return {
    id: p.id, policyId: getPlainText(r['Policy ID']), section: getPlainText(r['Section']), date: getPlainText(r['Date']), by: getPlainText(r['Reviewed By']),
    trigger: getPlainText(r['Trigger']), triggerDetail: getPlainText(r['Trigger Detail']), revised: !!getPlainText(r['Revised']),
    whatChanged: getPlainText(r['What Changed']), newRevised: getPlainText(r['New Revised Date']), staffNotified: getPlainText(r['Staff Notified']),
    notifiedHow: getPlainText(r['Notified How']), docsUpdated: getPlainText(r['Documents Updated']), docsFlagged: getPlainText(r['Documents Flagged']),
    notes: getPlainText(r['Notes']), created: p.created_time || ''
  };
}
function policyKey(p) { return key(p.section) + '|' + key(p.title); }
function docKey(d) { return key(d.document) + '|' + key(d.formId); }

// Documents whose governing policy or "policies that mention it" include this section.
function relatedDocs(policy, docs) {
  if (!/^\d+(\s*-\s*\d+)?$/.test(norm(policy.section))) return [];
  return docs.filter(function (d) {
    return policyNumbers(d.governing + ' ' + d.mentions).some(function (n) { return sectionMatches(policy.section, n); });
  });
}

// ---------- import ----------

const CHUNK = 18;

// Preview (apply=false) or import one chunk (apply=true, from `offset`).
// The client calls again with the next offset until done.
async function importRegister(buffer, filename, serviceIn, apply, offset) {
  const service = serviceIn || serviceFromName(filename);
  if (SERVICES.indexOf(service) === -1) throw httpError(400, 'Choose which licensed service this register is for.');
  const reg = parseRegister(buffer);
  const [pPages, dPages] = await Promise.all([queryDatabaseAll(POLICIES_DB, null), queryDatabaseAll(DOCS_DB, null)]);
  const existingP = {}; pPages.map(policyFromPage).forEach(function (p) { existingP[policyKey(p)] = p; });
  const existingD = {}; dPages.map(docFromPage).forEach(function (d) { existingD[docKey(d)] = d; });
  const work = reg.policies.map(function (p) { return { kind: 'policy', row: p, existing: existingP[policyKey(p)] || null }; })
    .concat(reg.documents.map(function (d) { return { kind: 'doc', row: d, existing: existingD[docKey(d)] || null }; }));
  const summary = {
    service: service,
    policies: reg.policies.length, activePolicies: reg.policies.filter(function (p) { return p.active; }).length,
    documents: reg.documents.length,
    newPolicies: work.filter(function (w) { return w.kind === 'policy' && !w.existing; }).length,
    newDocuments: work.filter(function (w) { return w.kind === 'doc' && !w.existing; }).length,
    total: work.length
  };
  if (!apply) return summary;
  const start = Math.max(0, Number(offset) || 0);
  const slice = work.slice(start, start + CHUNK);
  const today = qi.todayIso();
  for (let i = 0; i < slice.length; i += 3) {
    await Promise.all(slice.slice(i, i + 3).map(function (w) {
      if (w.kind === 'policy') {
        const p = w.row, e = w.existing;
        const services = e ? Array.from(new Set(e.services.concat([service]))) : [service];
        // The dashboard's own review dates win over an older register date.
        const lastReviewed = e && e.lastReviewed && e.lastReviewed > (p.lastRevised || '') ? e.lastReviewed : (p.lastRevised || (e && e.lastReviewed) || '');
        const nextDue = e && e.lastReviewed && e.lastReviewed > (p.lastRevised || '') ? e.nextDue : (p.nextDue || (lastReviewed ? addYear(lastReviewed) : ''));
        const props = {
          'Title': title(p.title), 'Section': richText(p.section), 'Services': multi(services), 'Register Status': richText(p.status), 'Active': { checkbox: p.active },
          'Folder': richText(p.folder), 'File Name': richText(p.fileName), 'Effective': dateProp(p.effective),
          'Last Revised': dateProp(e && e.lastRevised && e.lastRevised > (p.lastRevised || '') ? e.lastRevised : p.lastRevised),
          'Last Reviewed': dateProp(p.active ? lastReviewed : ''), 'Next Review Due': dateProp(p.active ? nextDue : ''), 'Imported Date': dateProp(today)
        };
        return e ? updatePage(e.id, props) : createPage(POLICIES_DB, props);
      }
      const d = w.row, e = w.existing;
      const services = e ? Array.from(new Set(e.services.concat([service]))) : [service];
      const props = {
        'Document': title(d.document), 'Number': { number: d.number }, 'Area': richText(d.area), 'Form ID': richText(d.formId),
        'Governing Policy': richText(d.governing), 'Policies That Mention It': richText(d.mentions), 'Where Kept': richText(d.whereKept),
        'Register Status': richText(d.status), 'File Name': richText(d.fileName), 'Link': { url: d.link || (e && e.link) || null },
        'Services': multi(services), 'Notes': richText(d.notes)
      };
      // Keep the dashboard's sync state and version once a document is here.
      if (!e) { props['In Sync'] = { select: { name: d.inSync } }; props['Document Version'] = dateProp(d.version); }
      return e ? updatePage(e.id, props) : createPage(DOCS_DB, props);
    }));
  }
  const next = start + slice.length;
  return Object.assign(summary, { done: next >= work.length, next: next });
}

// ---------- view ----------

function capSection(standard) {
  const m = String(standard || '').match(/12VAC35-105-(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function registerData() {
  const [pPages, dPages, rPages, capItems, caps] = await Promise.all([
    queryDatabaseAll(POLICIES_DB, null), queryDatabaseAll(DOCS_DB, null), queryDatabaseAll(REVIEWS_DB, null),
    queryDatabaseAll(CAP_ITEMS_DB, null).catch(function () { return []; }),
    queryDatabaseAll(CAPS_DB, null).catch(function () { return []; })
  ]);
  const capInfo = {};
  caps.forEach(function (c) { capInfo[c.id.replace(/-/g, '')] = { importedDate: getPlainText(c.properties['Imported Date']), inspectionDate: getPlainText(c.properties['Inspection Date']), location: getPlainText(c.properties['Location']) }; });
  const citations = capItems.map(function (p) {
    const r = p.properties;
    const capId = getPlainText(r['CAP ID']).replace(/-/g, '');
    return { citation: getPlainText(r['Citation']), standard: getPlainText(r['Standard']), status: getPlainText(r['Status']), section: capSection(getPlainText(r['Standard'])), cap: capInfo[capId] || {} };
  });
  return { policies: pPages.map(policyFromPage), docs: dPages.map(docFromPage), reviews: rPages.map(reviewFromPage), citations: citations };
}

function decorate(data, today) {
  const month = today.slice(0, 7);
  return data.policies.map(function (p) {
    const reviews = data.reviews.filter(function (r) { return sameId(r.policyId, p.id); })
      .sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.created < b.created ? 1 : -1); });
    const related = relatedDocs(p, data.docs);
    // Open CAP citations of this section with no review logged since the
    // inspection that cited it.
    const lastReview = reviews[0] ? reviews[0].date : '';
    const cites = data.citations.filter(function (c) {
      return c.section && sectionMatches(p.section, c.section) && c.status !== 'Closed' && !(lastReview && lastReview >= (c.cap.inspectionDate || c.cap.importedDate || ''));
    }).map(function (c) { return c.citation; });
    return Object.assign(p, {
      reviews: reviews,
      related: related.map(function (d) { return { id: d.id, document: d.document, formId: d.formId, inSync: d.inSync }; }),
      relatedReview: related.filter(function (d) { return d.inSync === 'Review'; }).length,
      dueThisMonth: p.active && !!p.nextDue && p.nextDue.slice(0, 7) === month,
      overdue: p.active && !!p.nextDue && p.nextDue < today,
      capTriggers: p.active ? cites : []
    });
  });
}

async function registerView() {
  const data = await registerData();
  const today = qi.todayIso();
  const policies = decorate(data, today).sort(function (a, b) {
    const na = parseInt(a.section, 10) || 9999, nb = parseInt(b.section, 10) || 9999;
    return na - nb || a.title.localeCompare(b.title);
  });
  return { today: today, policies: policies, documents: data.docs.sort(function (a, b) { return (a.number || 999) - (b.number || 999); }), triggers: TRIGGERS, services: SERVICES };
}

// ---------- reviews ----------

async function policyById(id) {
  let page;
  try { page = await getPage(id); } catch (e) { throw httpError(404, 'That policy wasn\'t found.'); }
  return policyFromPage(page);
}

async function logReview(policyId, input, by) {
  const p = await policyById(policyId);
  const date = input.date || qi.todayIso();
  if (!validIso(date) || date > qi.todayIso()) throw httpError(400, 'Choose the review date (not in the future).');
  const trigger = input.trigger || 'Scheduled annual review';
  if (TRIGGERS.indexOf(trigger) === -1) throw httpError(400, 'Choose what prompted the review.');
  if (trigger !== 'Scheduled annual review' && !norm(input.triggerDetail)) throw httpError(400, 'Describe what triggered the review (e.g. citation L-01, RCA 7/5/2026).');
  const revised = !!input.revised;
  const newRevised = revised ? (input.newRevisedDate || date) : '';
  if (revised && !validIso(newRevised)) throw httpError(400, 'Choose the new revised date.');
  if (revised && !norm(input.whatChanged)) throw httpError(400, 'Say what changed in the policy.');
  const staff = input.staffNotified || (revised ? '' : 'N/A');
  if (revised && ['Yes', 'No', 'N/A'].indexOf(staff) === -1) throw httpError(400, 'Say whether staff were notified of the change.');

  const data = await registerData();
  const related = relatedDocs(p, data.docs);
  const updatedIds = (input.updatedDocs || []).filter(function (id) { return related.some(function (d) { return sameId(d.id, id); }); });
  const updated = related.filter(function (d) { return updatedIds.some(function (id) { return sameId(id, d.id); }); });
  const flagged = revised ? related.filter(function (d) { return updated.indexOf(d) === -1 && d.inSync !== 'N/A'; }) : [];

  await createPage(REVIEWS_DB, {
    'Summary': title(p.section + ' ' + p.title + ' - ' + (revised ? 'revised' : 'reviewed') + ' ' + qi.usDate(date)),
    'Policy ID': richText(p.id), 'Section': richText(p.section), 'Date': dateProp(date), 'Reviewed By': richText(by),
    'Trigger': { select: { name: trigger } }, 'Trigger Detail': richText(norm(input.triggerDetail)), 'Revised': { checkbox: revised },
    'What Changed': richText(norm(input.whatChanged)), 'New Revised Date': dateProp(newRevised),
    'Staff Notified': { select: staff ? { name: staff } : null }, 'Notified How': richText(norm(input.notifiedHow)),
    'Documents Updated': richText(updated.map(function (d) { return d.document; }).join('; ')),
    'Documents Flagged': richText(flagged.map(function (d) { return d.document; }).join('; ')),
    'Notes': richText(norm(input.notes))
  });
  const props = { 'Last Reviewed': dateProp(date > (p.lastReviewed || '') ? date : p.lastReviewed), 'Next Review Due': dateProp(addYear(date > (p.lastReviewed || '') ? date : p.lastReviewed)) };
  if (revised) props['Last Revised'] = dateProp(newRevised);
  await updatePage(p.id, props);
  for (const d of updated) await updatePage(d.id, { 'In Sync': { select: { name: 'Current' } }, 'Document Version': dateProp(newRevised || date), 'Reconciled By': richText(by), 'Reconciled Date': dateProp(date) });
  for (const d of flagged) await updatePage(d.id, { 'In Sync': { select: { name: 'Review' } } });
  return { policy: await policyById(p.id), updated: updated.length, flagged: flagged.length };
}

async function reconcileDocument(docId, input, by) {
  let page;
  try { page = await getPage(docId); } catch (e) { throw httpError(404, 'That document wasn\'t found.'); }
  const date = input.date || qi.todayIso();
  if (!validIso(date)) throw httpError(400, 'Choose a valid date.');
  await updatePage(page.id, { 'In Sync': { select: { name: 'Current' } }, 'Document Version': dateProp(input.version && validIso(input.version) ? input.version : date), 'Reconciled By': richText(by), 'Reconciled Date': dateProp(date), 'Notes': richText(norm(input.notes) || getPlainText(page.properties['Notes'])) });
  return docFromPage(await getPage(page.id));
}

// ---------- the report's P&P review block (Section 9) ----------

async function ppSummary(month) {
  const data = await registerData();
  const end = qi.monthEnd(month);
  const policies = decorate(data, end);
  const active = policies.filter(function (p) { return p.active; });
  const inMonth = function (iso) { return !!iso && iso.slice(0, 7) === month; };
  const monthReviews = data.reviews.filter(function (r) { return inMonth(r.date); });
  const label = function (r) { const p = policies.find(function (x) { return sameId(x.id, r.policyId); }); return p ? p.section + ' ' + p.title : r.section; };
  const scheduled = active.filter(function (p) { return (p.nextDue && p.nextDue.slice(0, 7) === month) || p.reviews.some(function (r) { return inMonth(r.date) && r.trigger === 'Scheduled annual review'; }); });
  const scheduledDone = scheduled.filter(function (p) { return p.reviews.some(function (r) { return inMonth(r.date); }); });
  const triggered = monthReviews.filter(function (r) { return r.trigger !== 'Scheduled annual review'; });
  const revised = monthReviews.filter(function (r) { return r.revised; });
  const yearAgo = (Number(end.slice(0, 4)) - 1) + end.slice(4);
  const overdue = active.filter(function (p) { return !p.lastReviewed || p.lastReviewed < yearAgo; });
  const nextDue = active.filter(function (p) { return p.nextDue && p.nextDue > end; }).sort(function (a, b) { return a.nextDue < b.nextDue ? -1 : 1; }).slice(0, 5);
  const reviewDocs = data.docs.filter(function (d) { return d.inSync === 'Review'; });
  return {
    loaded: data.policies.length > 0,
    activeCount: active.length,
    scheduled: { total: scheduled.length, done: scheduledDone.length, list: scheduled.map(function (p) { return p.section + ' ' + p.title + (scheduledDone.indexOf(p) === -1 ? ' (not yet)' : ''); }) },
    triggered: triggered.map(function (r) { return label(r) + ': ' + r.trigger + (r.triggerDetail ? ' (' + r.triggerDetail + ')' : ''); }),
    revised: revised.map(function (r) { return label(r) + ': ' + qi.usDate(r.newRevised || r.date); }),
    staffNotified: revised.length ? (revised.every(function (r) { return r.staffNotified === 'Yes' || r.staffNotified === 'N/A'; }) ? 'Yes' : 'No') : 'N/A',
    staffHow: revised.map(function (r) { return r.notifiedHow; }).filter(Boolean).join('; '),
    reconciled: reviewDocs.length ? 'No' : 'Yes',
    reviewDocs: reviewDocs.map(function (d) { return d.document + (d.formId ? ' (' + d.formId + ')' : ''); }),
    docsUpdated: revised.map(function (r) { return r.docsUpdated; }).filter(Boolean).join('; '),
    overdue: { count: overdue.length, of: active.length, list: overdue.map(function (p) { return p.section + ' ' + p.title; }) },
    nextDue: nextDue.map(function (p) { return p.section + ' ' + qi.usDate(p.nextDue); }),
    capTriggered: active.filter(function (p) { return p.capTriggers.length; }).map(function (p) { return p.section + ' (' + p.capTriggers.join(', ') + ')'; })
  };
}

module.exports = { SERVICES, TRIGGERS, parseRegister, serviceFromName, importRegister, registerView, logReview, reconcileDocument, ppSummary, sectionMatches, regDate, CHUNK };
