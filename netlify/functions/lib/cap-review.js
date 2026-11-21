const { queryDatabaseAll, createPage, updatePage, trashPage, getPage, getPlainText } = require('./notion');
const { readDocx } = require('./docx');
const { id: configId } = require('./ids');

// CAP Review (admin dashboard): DBHDS Corrective Action Plans and their
// citations, tracked to close-out.
//
//   A CAP is imported from ASRS's "CAP Response and Tracker" .docx: a
//   header table (License #, Date of Inspection, Location, ...), a
//   citations table (#, Standard(s) Cited, Comp, Description, Actions to be
//   Taken, Planned Comp. Date) where each citation row is followed by its
//   status row ("L-01 status, notes and updates ...": "Status: Open" and
//   dated entries "11/18/2026 (AA): ..."), and the ECTA statement and DBHDS
//   General Comments as paragraphs.
//
//   Notion: CAPs (one per license + inspection), CAP Items (one per
//   citation), CAP Updates (dated entries: imported, added on the
//   dashboard, OLR responses, closures and reopenings).
//
//   Closing a citation needs a reason and a description of the supporting
//   evidence (a link to it is optional). When every citation on a CAP is
//   closed the CAP is Closed; reopening one reopens it.

const CAPS_DB_ID = configId('CAPS_DB_ID');
const ITEMS_DB_ID = configId('CAP_ITEMS_DB_ID');
const UPDATES_DB_ID = configId('CAP_UPDATES_DB_ID');
const TIME_ZONE = 'America/New_York';
const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];
const OLR_STATUSES = ['Pending', 'Accepted', 'Partially Accepted', 'Not Accepted'];
const COMPLIANCE = ['C', 'N', 'NS', 'ND'];

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

// "11/06/2026", "11-6-2026", "2026-11-06" -> "2026-11-06"; '' if none.
function isoFrom(s) {
  const t = String(s || '');
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = t.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return '';
}

function validIso(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
}

// Notion caps each text run at 2000 characters; a property takes up to 100.
function richText(s) {
  const t = String(s || '');
  const runs = [];
  for (let i = 0; i < t.length && runs.length < 100; i += 2000) runs.push({ text: { content: t.slice(i, i + 2000) } });
  return { rich_text: runs };
}

function title(s) {
  return { title: [{ text: { content: String(s || '').slice(0, 2000) } }] };
}

function dateProp(iso) {
  return { date: iso ? { start: iso } : null };
}

function select(name) {
  return { select: name ? { name: name } : null };
}

// Runs fn over items a few at a time (Notion allows ~3 requests a second).
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push.apply(out, await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// ---------- reading the tracker .docx ----------

const CITATION_RE = /^[A-Z]{1,3}-\d{1,3}$/;
const ENTRY_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:\(([^)]{1,40})\))?\s*[:\-–]\s*([\s\S]*)$/;
const OLR_RE = /OLR\s+(Not Accepted|Partially Accepted|Accepted)\s*(\d{1,2}\/\d{1,2}\/\d{4})?/i;

function olrFrom(text) {
  const m = OLR_RE.exec(text || '');
  if (!m) return null;
  const status = OLR_STATUSES.find(function (s) { return s.toLowerCase() === m[1].toLowerCase(); });
  return { status: status, date: isoFrom(m[2]) };
}

// "Status: Open" plus dated entries, newest first. Lines without a date
// continue the entry above them.
function parseStatusCell(text) {
  const lines = String(text || '').split('\n').slice(1);
  let status = 'Open';
  const entries = [];
  lines.forEach(function (raw) {
    const line = raw.trim();
    if (!line) return;
    const s = line.match(/^Status\s*:\s*(.+)$/i);
    if (s) { status = /closed/i.test(s[1]) ? 'Closed' : 'Open'; return; }
    const m = ENTRY_RE.exec(line);
    if (m) {
      const olr = olrFrom(m[3]);
      entries.push({ date: isoFrom(m[1]), by: (m[2] || '').trim(), text: m[3].trim(), olrStatus: olr ? olr.status : '', olrDate: olr ? olr.date : '' });
    } else if (entries.length) {
      entries[entries.length - 1].text += '\n' + line;
    } else {
      entries.push({ date: '', by: '', text: line, olrStatus: '', olrDate: '' });
    }
  });
  return { status: status, entries: entries };
}

function headerValue(table, label) {
  const want = label.toLowerCase();
  for (const row of table.rows) {
    for (let i = 0; i < row.length - 1; i++) {
      if (row[i].replace(/\s+/g, ' ').trim().toLowerCase() === want) return row[i + 1].trim();
    }
  }
  return '';
}

function columnIndex(header, re) {
  return header.findIndex(function (h) { return re.test(h); });
}

function parseCapDocx(buffer) {
  let blocks;
  try {
    blocks = readDocx(buffer);
  } catch (e) {
    throw httpError(400, 'Couldn\'t read that file: ' + e.message + ' Upload the CAP Response and Tracker as a Word (.docx) file.');
  }
  const tables = blocks.filter(function (b) { return b.type === 'table'; });
  const head = tables.find(function (t) { return t.rows.some(function (r) { return r.some(function (c) { return /^license\s*#?$/i.test(c.trim()); }); }); });
  const cites = tables.find(function (t) { return t.rows.length && t.rows[0][0].trim() === '#' && t.rows[0].some(function (c) { return /standard/i.test(c); }); });
  if (!head || !cites) throw httpError(400, 'This doesn\'t look like a CAP Response and Tracker: it needs the License # header table and the citations table (#, Standard(s) Cited, Comp, ...).');

  const cap = {
    licenseNumber: headerValue(head, 'License #'),
    inspectionDate: isoFrom(headerValue(head, 'Date of Inspection')),
    organization: headerValue(head, 'Organization Name'),
    facilityName: headerValue(head, 'Program Type / Facility Name'),
    location: headerValue(head, 'Location'),
    specialist: headerValue(head, 'Licensing Specialist')
  };
  const loc = LOCATIONS.find(function (l) { return l.toLowerCase() === cap.location.toLowerCase(); });
  if (!loc) throw httpError(400, 'The CAP\'s Location ("' + cap.location + '") isn\'t one of ' + LOCATIONS.join(', ') + '.');
  cap.location = loc;
  if (!cap.licenseNumber || !cap.inspectionDate) throw httpError(400, 'The CAP needs a License # and a Date of Inspection in its header table.');
  cap.title = cap.location + ' - Inspection ' + usDate(cap.inspectionDate) + ' (' + cap.licenseNumber + ')';

  const h = cites.rows[0];
  const col = {
    standard: columnIndex(h, /standard/i),
    comp: columnIndex(h, /^comp/i),
    description: columnIndex(h, /description/i),
    actions: columnIndex(h, /action/i),
    planned: columnIndex(h, /planned|comp\.?\s*date/i)
  };
  const items = [];
  cites.rows.slice(1).forEach(function (row) {
    const first = (row[0] || '').trim();
    if (CITATION_RE.test(first) && row.length >= 3) {
      const std = (row[col.standard] || '').split('\n');
      const comp = (row[col.comp] || '').trim().toUpperCase();
      items.push({
        citation: first,
        order: items.length + 1,
        standard: std[0].trim(),
        standardText: std.slice(1).join('\n').trim(),
        compliance: COMPLIANCE.indexOf(comp) !== -1 ? comp : '',
        description: (row[col.description] || '').trim(),
        actions: (row[col.actions] || '').trim(),
        plannedDate: isoFrom(row[col.planned]),
        status: 'Open',
        olrStatus: 'Pending',
        olrDate: '',
        updates: []
      });
      return;
    }
    const m = first.match(/^([A-Z]{1,3}-\d{1,3})\s+status/i);
    const item = m && items.find(function (i) { return i.citation === m[1].toUpperCase(); });
    if (item) {
      const st = parseStatusCell(row.join('\n'));
      item.status = st.status;
      item.updates = st.entries;
      // The newest entry naming an OLR response sets where it stands.
      const olr = st.entries.find(function (e) { return e.olrStatus; });
      if (olr) { item.olrStatus = olr.olrStatus; item.olrDate = olr.olrDate || olr.date; }
    }
  });
  if (!items.length) throw httpError(400, 'No citations (L-01, J-01 ...) were found in the citations table.');

  // ECTA statement and the DBHDS comments: the paragraphs after the
  // citations table, up to the compliance key or the signature block.
  const after = blocks.slice(blocks.indexOf(cites) + 1);
  const notes = [];
  for (const b of after) {
    if (b.type !== 'p') continue;
    if (/^C\s*=\s*Substantial Compliance/i.test(b.text) || /^Signature$/i.test(b.text)) break;
    notes.push(b.text);
  }
  // Some trackers put the ECTA statement before the table.
  const ecta = blocks.slice(0, blocks.indexOf(cites)).filter(function (b) { return b.type === 'p' && /ECTA|Mandatory Assistance|ASRS statement/i.test(b.text); });
  cap.notes = ecta.concat(notes.map(function (t) { return { text: t }; })).map(function (b) { return b.text; }).join('\n\n');
  return { cap: cap, items: items };
}

// ---------- reading from Notion ----------

function capFromPage(p) {
  const r = p.properties;
  return {
    id: p.id,
    title: getPlainText(r['CAP Title']),
    location: getPlainText(r['Location']),
    licenseNumber: getPlainText(r['License Number']),
    inspectionDate: getPlainText(r['Inspection Date']),
    facilityName: getPlainText(r['Facility Name']),
    specialist: getPlainText(r['Licensing Specialist']),
    organization: getPlainText(r['Organization']),
    status: getPlainText(r['Status']) || 'Open',
    notes: getPlainText(r['Notes']),
    sourceFile: getPlainText(r['Source File']),
    importedBy: getPlainText(r['Imported By']),
    importedDate: getPlainText(r['Imported Date'])
  };
}

function itemFromPage(p) {
  const r = p.properties;
  return {
    id: p.id,
    capId: getPlainText(r['CAP ID']),
    citation: getPlainText(r['Citation']),
    location: getPlainText(r['Location']),
    order: getPlainText(r['Order']) || 0,
    standard: getPlainText(r['Standard']),
    standardText: getPlainText(r['Standard Text']),
    compliance: getPlainText(r['Compliance']),
    description: getPlainText(r['Description']),
    actions: getPlainText(r['Actions']),
    plannedDate: getPlainText(r['Planned Completion Date']),
    status: getPlainText(r['Status']) || 'Open',
    olrStatus: getPlainText(r['OLR Status']) || 'Pending',
    olrDate: getPlainText(r['OLR Date']),
    closedDate: getPlainText(r['Closed Date']),
    closedBy: getPlainText(r['Closed By']),
    closureReason: getPlainText(r['Closure Reason']),
    closureEvidence: getPlainText(r['Closure Evidence']),
    evidenceLink: getPlainText(r['Evidence Link']),
    lastUpdated: getPlainText(r['Last Updated'])
  };
}

function updateFromPage(p) {
  const r = p.properties;
  return {
    id: p.id,
    itemId: getPlainText(r['Item ID']),
    capId: getPlainText(r['CAP ID']),
    date: getPlainText(r['Date']),
    by: getPlainText(r['By']),
    text: getPlainText(r['Text']),
    kind: getPlainText(r['Kind']) || 'Update',
    olrStatus: getPlainText(r['OLR Status']),
    created: p.created_time || ''
  };
}

function sameId(a, b) {
  return String(a || '').replace(/-/g, '').toLowerCase() === String(b || '').replace(/-/g, '').toLowerCase();
}

function byOrder(a, b) { return a.order - b.order; }
// Newest first; same day: the one entered later first.
function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.created < b.created ? 1 : a.created > b.created ? -1 : 0;
}

function locationFilter(locations) {
  return { or: locations.map(function (l) { return { property: 'Location', select: { equals: l } }; }) };
}

function overdue(item, today) {
  return item.status === 'Open' && !!item.plannedDate && item.plannedDate < (today || todayIso());
}

function counts(items) {
  const today = todayIso();
  return {
    total: items.length,
    open: items.filter(function (i) { return i.status === 'Open'; }).length,
    closed: items.filter(function (i) { return i.status === 'Closed'; }).length,
    overdue: items.filter(function (i) { return overdue(i, today); }).length
  };
}

async function capsForLocations(locations) {
  if (!locations.length) return [];
  const [capPages, itemPages] = await Promise.all([
    queryDatabaseAll(CAPS_DB_ID, locationFilter(locations)),
    queryDatabaseAll(ITEMS_DB_ID, locationFilter(locations))
  ]);
  const items = itemPages.map(itemFromPage);
  return capPages.map(capFromPage).map(function (c) {
    return Object.assign(c, { counts: counts(items.filter(function (i) { return sameId(i.capId, c.id); })) });
  }).sort(function (a, b) { return a.inspectionDate < b.inspectionDate ? 1 : a.inspectionDate > b.inspectionDate ? -1 : a.location.localeCompare(b.location); });
}

async function capById(capId) {
  let page;
  try { page = await getPage(capId); } catch (e) { throw httpError(404, 'That CAP wasn\'t found.'); }
  if (page.in_trash || page.archived) throw httpError(404, 'That CAP was deleted.');
  return capFromPage(page);
}

// A CAP with its citations, each with its updates (newest first).
async function capDetail(capId) {
  const cap = await capById(capId);
  const [itemPages, updatePages] = await Promise.all([
    queryDatabaseAll(ITEMS_DB_ID, { property: 'CAP ID', rich_text: { equals: cap.id } }),
    queryDatabaseAll(UPDATES_DB_ID, { property: 'CAP ID', rich_text: { equals: cap.id } })
  ]);
  const updates = updatePages.map(updateFromPage);
  const today = todayIso();
  const items = itemPages.map(itemFromPage).sort(byOrder).map(function (i) {
    return Object.assign(i, {
      overdue: overdue(i, today),
      updates: updates.filter(function (u) { return sameId(u.itemId, i.id); }).sort(newestFirst)
    });
  });
  return { cap: Object.assign(cap, { counts: counts(items) }), items: items };
}

// Every open citation at these locations, with its CAP and updates.
async function openItems(locations) {
  if (!locations.length) return [];
  const caps = await capsForLocations(locations);
  const openCaps = caps.filter(function (c) { return c.counts.open > 0; });
  const details = await inBatches(openCaps, 3, function (c) { return capDetail(c.id); });
  return details.map(function (d) {
    return { cap: d.cap, items: d.items.filter(function (i) { return i.status === 'Open'; }) };
  });
}

async function itemById(itemId) {
  let page;
  try { page = await getPage(itemId); } catch (e) { throw httpError(404, 'That citation wasn\'t found.'); }
  if (page.in_trash || page.archived) throw httpError(404, 'That citation was deleted.');
  return itemFromPage(page);
}

// ---------- writing ----------

async function addUpdateRow(item, kind, text, byName, date, olrStatus) {
  return createPage(UPDATES_DB_ID, {
    'Summary': title(item.citation + ' ' + kind + ' ' + usDate(date)),
    'Item ID': richText(item.id),
    'CAP ID': richText(item.capId),
    'Date': dateProp(date),
    'By': richText(byName),
    'Text': richText(text),
    'Kind': select(kind),
    'OLR Status': select(olrStatus || null)
  });
}

// Recomputes the CAP's Open/Closed from its citations.
async function syncCapStatus(capId) {
  const pages = await queryDatabaseAll(ITEMS_DB_ID, { property: 'CAP ID', rich_text: { equals: capId } });
  const anyOpen = pages.map(itemFromPage).some(function (i) { return i.status !== 'Closed'; });
  await updatePage(capId, { 'Status': select(anyOpen ? 'Open' : 'Closed') });
  return anyOpen ? 'Open' : 'Closed';
}

async function findExisting(cap) {
  const pages = await queryDatabaseAll(CAPS_DB_ID, { and: [
    { property: 'License Number', rich_text: { equals: cap.licenseNumber } },
    { property: 'Inspection Date', date: { equals: cap.inspectionDate } }
  ] });
  return pages.length ? capFromPage(pages[0]) : null;
}

// Preview (apply=false) or import (apply=true) a tracker .docx.
async function importCap(buffer, filename, byName, grantedLocations, apply) {
  const parsed = parseCapDocx(buffer);
  const cap = parsed.cap;
  if (grantedLocations.indexOf(cap.location) === -1) throw httpError(403, 'You don\'t have access to ' + cap.location + '.');
  const existing = await findExisting(cap);
  const summary = {
    cap: cap,
    items: parsed.items.map(function (i) {
      return { citation: i.citation, standard: i.standard, compliance: i.compliance, plannedDate: i.plannedDate, status: i.status, olrStatus: i.olrStatus, updates: i.updates.length };
    }),
    existing: existing ? { id: existing.id, title: existing.title } : null
  };
  if (!apply) return summary;
  if (existing) throw httpError(409, 'This CAP (' + cap.licenseNumber + ', inspection ' + usDate(cap.inspectionDate) + ') is already in CAP Review. Delete it there first to import it again.');

  const today = todayIso();
  const capPage = await createPage(CAPS_DB_ID, {
    'CAP Title': title(cap.title),
    'Location': select(cap.location),
    'License Number': richText(cap.licenseNumber),
    'Inspection Date': dateProp(cap.inspectionDate),
    'Facility Name': richText(cap.facilityName),
    'Licensing Specialist': richText(cap.specialist),
    'Organization': richText(cap.organization),
    'Status': select('Open'),
    'Notes': richText(cap.notes),
    'Source File': richText(filename),
    'Imported By': richText(byName),
    'Imported Date': dateProp(today)
  });

  const created = await inBatches(parsed.items, 3, async function (i) {
    const closed = i.status === 'Closed';
    const newest = i.updates[0];
    const page = await createPage(ITEMS_DB_ID, {
      'Citation': title(i.citation),
      'CAP ID': richText(capPage.id),
      'Location': select(cap.location),
      'Order': { number: i.order },
      'Standard': richText(i.standard),
      'Standard Text': richText(i.standardText),
      'Compliance': select(i.compliance || null),
      'Description': richText(i.description),
      'Actions': richText(i.actions),
      'Planned Completion Date': dateProp(i.plannedDate),
      'Status': select(i.status),
      'OLR Status': select(i.olrStatus),
      'OLR Date': dateProp(i.olrDate),
      // Closed before import: the tracker's newest entry is the record.
      'Closed Date': dateProp(closed ? (newest && newest.date) || today : ''),
      'Closed By': richText(closed ? (newest && newest.by) || byName : ''),
      'Closure Reason': richText(closed ? 'Closed in the tracker before import.' + (newest ? ' ' + newest.text : '') : ''),
      'Closure Evidence': richText(closed ? 'See the tracker\'s notes (imported from ' + filename + ').' : ''),
      'Last Updated': dateProp((newest && newest.date) || today)
    });
    return Object.assign({}, i, { id: page.id, capId: capPage.id });
  });

  const rows = [];
  created.forEach(function (i) {
    i.updates.forEach(function (u) { rows.push({ item: i, u: u }); });
  });
  await inBatches(rows, 3, function (r) {
    return addUpdateRow(r.item, 'Imported', r.u.text, r.u.by || 'Tracker', r.u.date || today, r.u.olrStatus);
  });
  await syncCapStatus(capPage.id);
  return Object.assign(summary, { imported: true, capId: capPage.id });
}

// A dated note on a citation. Optionally records OLR's response (status
// and date) and/or a revised planned completion date.
async function addUpdate(itemId, input, byName) {
  const item = await itemById(itemId);
  const text = String(input.text || '').trim();
  const olrStatus = input.olrStatus || '';
  const plannedDate = input.plannedDate || '';
  const date = input.date || todayIso();
  if (!validIso(date)) throw httpError(400, 'Choose a valid date for the update.');
  if (olrStatus && OLR_STATUSES.indexOf(olrStatus) === -1) throw httpError(400, 'Unknown OLR response.');
  if (plannedDate && !validIso(plannedDate)) throw httpError(400, 'Choose a valid planned completion date.');
  if (!text) throw httpError(400, 'Write the update.');

  const props = { 'Last Updated': dateProp(todayIso()) };
  let note = text;
  if (olrStatus) {
    const olrDate = input.olrDate && validIso(input.olrDate) ? input.olrDate : date;
    props['OLR Status'] = select(olrStatus);
    props['OLR Date'] = dateProp(olrDate);
    note = 'OLR ' + olrStatus + ' ' + usDate(olrDate) + ': ' + text;
  }
  if (plannedDate && plannedDate !== item.plannedDate) {
    props['Planned Completion Date'] = dateProp(plannedDate);
    note += '\n(Planned completion date changed from ' + (item.plannedDate ? usDate(item.plannedDate) : 'none') + ' to ' + usDate(plannedDate) + '.)';
  }
  await updatePage(item.id, props);
  await addUpdateRow(item, olrStatus ? 'OLR Response' : 'Update', note, byName, date, olrStatus);
  return itemById(item.id);
}

// Close-out: the reason and the supporting evidence are required.
async function closeItem(itemId, input, byName) {
  const item = await itemById(itemId);
  if (item.status === 'Closed') throw httpError(400, item.citation + ' is already closed.');
  const reason = String(input.reason || '').trim();
  const evidence = String(input.evidence || '').trim();
  const link = String(input.evidenceLink || '').trim();
  const date = input.date || todayIso();
  if (reason.length < 10) throw httpError(400, 'Explain why ' + item.citation + ' is being closed (at least a sentence).');
  if (evidence.length < 10) throw httpError(400, 'Describe the evidence that supports closing ' + item.citation + '.');
  if (link && !/^https:\/\/\S+$/.test(link)) throw httpError(400, 'The evidence link must start with https://');
  if (!validIso(date) || date > todayIso()) throw httpError(400, 'Choose a valid close-out date (not in the future).');

  await updatePage(item.id, {
    'Status': select('Closed'),
    'Closed Date': dateProp(date),
    'Closed By': richText(byName),
    'Closure Reason': richText(reason),
    'Closure Evidence': richText(evidence),
    'Evidence Link': { url: link || null },
    'Last Updated': dateProp(todayIso())
  });
  await addUpdateRow(item, 'Closed', 'Closed. Reason: ' + reason + '\nEvidence: ' + evidence + (link ? '\nLink: ' + link : ''), byName, date, '');
  const capStatus = await syncCapStatus(item.capId);
  return { item: await itemById(item.id), capStatus: capStatus };
}

// Reopen a closed citation (e.g. OLR didn't accept the close-out). The
// closure stays in the updates; the item's closure fields are cleared.
async function reopenItem(itemId, input, byName) {
  const item = await itemById(itemId);
  if (item.status !== 'Closed') throw httpError(400, item.citation + ' is already open.');
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw httpError(400, 'Say why ' + item.citation + ' is being reopened.');
  await updatePage(item.id, {
    'Status': select('Open'),
    'Closed Date': dateProp(''),
    'Closed By': richText(''),
    'Closure Reason': richText(''),
    'Closure Evidence': richText(''),
    'Evidence Link': { url: null },
    'Last Updated': dateProp(todayIso())
  });
  await addUpdateRow(item, 'Reopened', 'Reopened: ' + reason, byName, todayIso(), '');
  const capStatus = await syncCapStatus(item.capId);
  return { item: await itemById(item.id), capStatus: capStatus };
}

// Removes a CAP, its citations and updates (to Notion's trash, restorable
// there for 30 days), e.g. to import a corrected tracker.
async function deleteCap(capId) {
  const cap = await capById(capId);
  const [itemPages, updatePages] = await Promise.all([
    queryDatabaseAll(ITEMS_DB_ID, { property: 'CAP ID', rich_text: { equals: cap.id } }),
    queryDatabaseAll(UPDATES_DB_ID, { property: 'CAP ID', rich_text: { equals: cap.id } })
  ]);
  await inBatches(updatePages.concat(itemPages), 3, function (p) { return trashPage(p.id); });
  await trashPage(cap.id);
  return cap;
}

module.exports = {
  LOCATIONS, OLR_STATUSES, httpError, todayIso, usDate,
  parseCapDocx, parseStatusCell, capsForLocations, capById, capDetail, openItems, itemById,
  importCap, addUpdate, closeItem, reopenItem, deleteCap
};
