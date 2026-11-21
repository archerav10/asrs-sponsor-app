const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ASRS-620-06 Monthly QI & RM Status and Compliance Report as a PDF that
// follows the Word template: landscape, the same sections, tables, header
// and footer. What the dashboard knows is printed; what has to be decided
// at the review (Sections 8-11, and anything the dashboard couldn't find)
// is a fillable field (checkbox, Yes/No/N/A list or text box), shaded
// yellow like the template's fill-in cells.

const TEMPLATE = { form: 'ASRS-620-06', name: 'Monthly QI & RM Status and Compliance Report', version: '20261025', policy: 'Governing policy: 12VAC35-105-620, last reviewed 20261025 · Also: 520 (20261025), 160 (20261025), 170 (20261022)' };

const W = 792, H = 612, M = 34, CW = W - 2 * M;
const NAVY = rgb(0.12, 0.23, 0.42), INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.38, 0.4, 0.44), LINE = rgb(0.62, 0.68, 0.76);
const HEAD = rgb(0.86, 0.9, 0.95), GROUP = rgb(0.93, 0.95, 0.97), FILL = rgb(1, 0.97, 0.84), WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.1, 0.42, 0.2), RED = rgb(0.66, 0.13, 0.1), AMBER = rgb(0.55, 0.38, 0.02);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SWAPS = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'Yes', '✔': 'Yes', '☐': '[ ]', '☑': '[x]', '\t': ' ', '\r': '', ' ': ' ', '‑': '-', '−': '-' };
function clean(s) {
  return Array.from(String(s == null ? '' : s)).map(function (ch) {
    if (SWAPS[ch] !== undefined) return SWAPS[ch];
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.indexOf(ch) !== -1) return ch;
    return '?';
  }).join('');
}
function us(iso) { if (!iso) return ''; const p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0]; }
function resultText(r) {
  if (!r) return '';
  if (r.total !== null && r.total !== '' && r.total !== undefined && Number(r.total) > 0) return r.count + ' of ' + r.total + ' (' + Math.round(r.count / r.total * 100) + '%)';
  return r.valueText || '';
}
function statusColor(s) { return s === 'On track' || s === 'Met' ? GREEN : s === 'At risk' ? AMBER : s === 'Not met' ? RED : INK; }

async function writer(d) {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(TEMPLATE.name + ' - ' + d.monthLabel));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();
  const w = { doc: doc, font: font, bold: bold, page: null, y: 0, fieldNo: 0 };

  w.newPage = function () {
    w.page = doc.addPage([W, H]);
    const hdr = clean('Arch Support Residential Services · ' + TEMPLATE.name);
    w.page.drawText(hdr, { x: W - M - font.widthOfTextAtSize(hdr, 7.5), y: H - 22, size: 7.5, font: font, color: MUTED });
    w.y = H - 38;
  };
  w.room = function (h) { if (w.y - h < M + 16) w.newPage(); };
  w.wrap = function (text, f, size, width) {
    const out = [];
    clean(text).split('\n').forEach(function (para) {
      let line = '';
      para.split(/ +/).forEach(function (word) {
        const t = line ? line + ' ' + word : word;
        if (f.widthOfTextAtSize(t, size) <= width) { line = t; return; }
        if (line) out.push(line);
        while (f.widthOfTextAtSize(word, size) > width && word.length > 1) {
          let n = word.length;
          while (n > 1 && f.widthOfTextAtSize(word.slice(0, n), size) > width) n--;
          out.push(word.slice(0, n));
          word = word.slice(n);
        }
        line = word;
      });
      out.push(line);
    });
    return out;
  };
  w.text = function (text, o) {
    o = o || {};
    const size = o.size || 8.5, f = o.bold ? bold : o.italic ? ital : font, lh = size * 1.28, indent = o.indent || 0;
    w.wrap(text, f, size, (o.width || CW) - indent).forEach(function (l) {
      w.room(lh);
      w.page.drawText(l, { x: M + indent, y: w.y - size, size: size, font: f, color: o.color || INK });
      w.y -= lh;
    });
  };
  w.gap = function (h) { w.y -= h; };
  w.h1 = function (t) { w.room(40); w.text(t, { size: 16, bold: true, color: NAVY }); w.gap(2); };
  w.h2 = function (t, keep) { w.room(keep || 60); w.gap(6); w.text(t, { size: 11.5, bold: true, color: NAVY }); w.gap(2); };
  w.note = function (t) { w.text(t, { size: 7.8, italic: true, color: MUTED }); w.gap(2); };

  function fieldName(prefix) { w.fieldNo++; return (prefix || 'f') + '_' + w.fieldNo; }
  function addField(spec, x, y, width, height) {
    const page = w.page;
    if (spec.type === 'check') {
      const cb = form.createCheckBox(fieldName(spec.name));
      cb.addToPage(page, { x: x, y: y + (height - 9) / 2, width: 9, height: 9, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.8, backgroundColor: WHITE });
      if (spec.checked) cb.check();
      return;
    }
    if (spec.type === 'select') {
      const dd = form.createDropdown(fieldName(spec.name));
      dd.addOptions(spec.options.map(clean));
      if (spec.value) dd.select(clean(spec.value));
      dd.addToPage(page, { x: x, y: y, width: width, height: height, font: font, backgroundColor: FILL, borderWidth: 0 });
      dd.setFontSize(8);
      return;
    }
    const tf = form.createTextField(fieldName(spec.name));
    if (spec.multiline) tf.enableMultiline();
    if (spec.value) tf.setText(clean(spec.value));
    tf.addToPage(page, { x: x, y: y, width: width, height: height, font: font, backgroundColor: FILL, borderWidth: 0 });
    tf.setFontSize(spec.size || 8);
  }

  // A table: cols [{ label, w }] (w = share of the width), rows of cells.
  // A cell is a string, { text, bold, color }, or { field: spec, text? }.
  // Row options: { group: true } spans all columns as a goal/heading band.
  w.table = function (cols, rows, opts) {
    opts = opts || {};
    const width = opts.width || CW;
    const total = cols.reduce(function (s, c) { return s + c.w; }, 0);
    const widths = cols.map(function (c) { return c.w / total * width; });
    const size = opts.size || 7.8, lh = size * 1.25, pad = 3;
    function cellLines(cell, i) {
      if (cell == null) return [''];
      if (typeof cell === 'string' || typeof cell === 'number') return w.wrap(String(cell), font, size, widths[i] - 2 * pad);
      if (cell.field && cell.field.type === 'text' && cell.field.value) {
        // Room for a pre-filled value: the box grows and wraps.
        const l = w.wrap(cell.field.value, font, 8, widths[i] - 6);
        if (l.length > 1) cell.field.multiline = true;
        return l;
      }
      if (cell.field && !cell.text) return [''];
      return w.wrap(cell.text || '', cell.bold ? bold : font, size, widths[i] - 2 * pad - (cell.field && cell.field.type === 'check' ? 12 : 0));
    }
    function drawRow(cells, kind) {
      let h;
      const lines = kind === 'group' ? [w.wrap(cells[0], bold, size, width - 2 * pad)] : cells.map(cellLines);
      if (kind === 'group') h = lines[0].length * lh + 2 * pad;
      else {
        h = Math.max.apply(null, lines.map(function (l) { return l.length; })) * lh + 2 * pad;
        cells.forEach(function (c) { if (c && c.field) h = Math.max(h, c.field.height || (c.field.multiline ? 26 : 15)); });
      }
      return { h: h, lines: lines };
    }
    function paint(cells, kind, m) {
      const top = w.y;
      let x = M;
      if (kind === 'group') {
        w.page.drawRectangle({ x: M, y: top - m.h, width: width, height: m.h, color: GROUP, borderColor: LINE, borderWidth: 0.5 });
        m.lines[0].forEach(function (l, k) { w.page.drawText(l, { x: M + pad, y: top - pad - size - k * lh + 1, size: size, font: bold, color: NAVY }); });
        w.y -= m.h;
        return;
      }
      cells.forEach(function (c, i) {
        const cw = widths[i];
        const isField = c && c.field;
        const bg = kind === 'head' ? HEAD : (isField && c.field.type !== 'check') ? FILL : WHITE;
        w.page.drawRectangle({ x: x, y: top - m.h, width: cw, height: m.h, color: bg, borderColor: LINE, borderWidth: 0.5 });
        if (isField) {
          if (c.field.type === 'check') {
            addField(c.field, x + pad, top - pad - 11, 9, 11);
            m.lines[i].forEach(function (l, k) { w.page.drawText(l, { x: x + pad + 12, y: top - pad - size - k * lh + 1, size: size, font: font, color: INK }); });
          } else {
            addField(c.field, x + 1, top - m.h + 1, cw - 2, m.h - 2);
          }
        } else {
          // (Strings have a built-in .bold method, so check for an object.)
          const obj = c && typeof c === 'object';
          const f = kind === 'head' || (obj && c.bold) ? bold : font;
          const color = kind === 'head' ? NAVY : (obj && c.color) || INK;
          m.lines[i].forEach(function (l, k) { w.page.drawText(l, { x: x + pad, y: top - pad - size - k * lh + 1, size: size, font: f, color: color }); });
        }
        x += cw;
      });
      w.y -= m.h;
    }
    const head = cols.some(function (c) { return c.label; }) ? cols.map(function (c) { return c.label; }) : null;
    const headM = head ? drawRow(head, 'head') : null;
    if (head) { w.room(headM.h + 20); paint(head, 'head', headM); }
    rows.forEach(function (r) {
      const kind = r.group ? 'group' : 'row';
      const cells = r.group ? [r.group] : (r.cells || r);
      const m = drawRow(cells, kind);
      if (w.y - m.h < M + 16) { w.newPage(); if (head) paint(head, 'head', headM); }
      paint(cells, kind, m);
    });
    w.gap(opts.after == null ? 6 : opts.after);
  };
  // Checkbox list (one per line), like the template's "☐ ..." lines.
  w.checks = function (items, name) {
    items.forEach(function (it) {
      const lines = w.wrap(it.label, font, 8.3, CW - 16);
      const h = lines.length * 10.6 + 2;
      w.room(h);
      addField({ type: 'check', name: name, checked: !!it.checked }, M, w.y - 11, 9, 11);
      lines.forEach(function (l, k) { w.page.drawText(l, { x: M + 14, y: w.y - 8.5 - k * 10.6, size: 8.3, font: font, color: INK }); });
      w.y -= h;
    });
    w.gap(4);
  };
  w.finish = async function () {
    form.updateFieldAppearances(font);
    const pages = doc.getPages();
    pages.forEach(function (p, i) {
      const f1 = clean(TEMPLATE.form + ' ' + TEMPLATE.name + ' · Version ' + TEMPLATE.version);
      p.drawText(f1, { x: M, y: 22, size: 7, font: bold, color: MUTED });
      p.drawText(clean(TEMPLATE.policy), { x: M, y: 13, size: 6.5, font: font, color: MUTED });
      const pn = 'Page ' + (i + 1) + ' of ' + pages.length;
      p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7), y: 22, size: 7, font: font, color: MUTED });
    });
    return doc.save();
  };
  w.newPage();
  return w;
}

const YNA = ['', 'Yes', 'No', 'N/A'];
function txt(name, value, opts) { return { field: Object.assign({ type: 'text', name: name, value: value || '' }, opts || {}) }; }
function sel(name, options, value) { return { field: { type: 'select', name: name, options: options, value: value || '' } }; }
function chk(name, checked, label) { return { field: { type: 'check', name: name, checked: !!checked }, text: label || '' }; }

async function buildQiReportPdf(d) {
  const w = await writer(d);
  const info = d.info;
  const r = d.risk;

  // ---- Title and how-to ----
  w.h1('ASRS Monthly QI & RM Status and Compliance Report');
  w.text('Monthly review of the QI & RM Plan: objectives, CAPs, serious incidents and risk, input from individuals, and compliance (12VAC35-105-620, 520, 160). For QI & RM Plan Version ' + d.plan.version + '. Generated from the ASRS admin dashboard; yellow fields are filled in at the review.', { size: 8.3, color: MUTED });
  if (d.problems.length) { w.gap(3); w.text('Could not read: ' + d.problems.join(' · ') + ' Those parts are left to fill in by hand.', { size: 8, color: RED }); }
  w.h2('How to complete this report');
  w.table([{ label: '', w: 1.3 }, { label: '', w: 8 }], [
    [{ text: 'Purpose', bold: true }, 'This report holds the monthly status, monitoring and compliance review of the QI & RM Plan. The Plan holds goals, objectives and the risk management plan and changes only when its content changes; this report records progress every month.'],
    [{ text: 'When', bold: true }, 'Complete for each month by the 15th of the following month and present it at the monthly leadership review. The report is the meeting record (attendees, results reviewed, action items) required by Policy 620 B.'],
    [{ text: 'Before you start', bold: true }, 'Finish the month in the Risk Tracking Tool (Individual Log, every Compliance Log row, Review Log), update each open CAP in CAP Review and the issues and opportunities log, enter every objective\'s result on the QI & RM tab, and complete the Notion monthly checklist.'],
    [{ text: 'Yellow cells', bold: true }, 'Fill in or replace. Write N/A with a reason when an item does not apply. Do not leave a section blank.'],
    [{ text: 'Status words', bold: true }, 'On track, At risk, Not met, Met. Anything At risk or Not met goes in Section 3 with a cause and revised action within 30 days; two quarters in a row Not met goes to the Executive Director and into a new Plan version.'],
    [{ text: 'Quarter-end months', bold: true }, 'January, April, July and October: also complete Section 7 for the quarter just ended. January: also complete Section 10 (annual compliance checklist).'],
    [{ text: 'Plan changes', bold: true }, 'Section 8 checks the six version triggers and lists the steps for adopting a new version and marking the previous one superseded.'],
    [{ text: 'Where it is kept', bold: true }, 'Save as "Monthly QI & RM Status and Compliance Report - yyyy-mm" (signed PDF) in "QI & RM / Monthly Reports". The twelve monthly reports and the Plan\'s version history are the evidence of ongoing monitoring (620.C.5).']
  ], { size: 7.6 });

  // ---- 1. Report information ----
  w.h2('1. Report information');
  w.table([{ label: '', w: 2 }, { label: '', w: 3 }, { label: '', w: 2 }, { label: '', w: 3 }], [
    [{ text: 'Report month', bold: true }, d.monthLabel, { text: 'Report due', bold: true }, us(d.due)],
    [{ text: 'Prepared by (Risk Manager)', bold: true }, txt('prepared_by', info.preparedBy), { text: 'Date prepared', bold: true }, txt('date_prepared', us(info.datePrepared))],
    [{ text: 'Leadership review meeting date', bold: true }, txt('meeting_date', us(info.meetingDate)), { text: 'Attendees', bold: true }, txt('attendees', info.attendees)],
    [{ text: 'QI & RM Plan version in effect', bold: true }, 'Version ' + d.plan.version, { text: 'Quarter-end month?', bold: true }, d.quarterEnd ? 'Yes - Section 7 completed below' : 'No']
  ]);
  w.text('Sources reviewed', { size: 10, bold: true, color: NAVY });
  w.note('Check each source reviewed for this month. Pre-checked where the dashboard found the record for the month; uncheck any you did not review.');
  const sp = d.prechecks.sources;
  w.checks([
    { label: 'ASRS Risk Tracking Tool: Individual Log, Compliance Log (every row for the month marked), Compliance Summary, Review Log' + (r ? ' (read: ' + r.file.name + (r.reviews.length ? '; Review Log entry ' + us(r.reviews[0].date) : '; no Review Log entry for the month') + ')' : ''), checked: sp.riskTool },
    { label: 'RCA Log and detailed-RCA threshold check for the month (Policy 160)', checked: sp.rcaLog },
    { label: 'CAP Response and Tracker for each open CAP (CAP Review: every open citation updated this month)', checked: sp.capTrackers },
    { label: 'QI & RM Monthly Checklist in Notion for the month', checked: sp.notionChecklist },
    { label: 'Objective data sources listed in the Plan (Therap, training tracker, care plan audit, survey log, CHRIS)' + ' (' + d.entered + ' of ' + d.objectives.length + ' objectives have a result)', checked: sp.objectiveSources },
    { label: 'Resident conversations and AR contacts documented this month (620.E)' + (d.questionnaires ? ' (' + d.questionnaires.length + ' Liaison app questionnaire' + (d.questionnaires.length === 1 ? '' : 's') + ')' : ''), checked: sp.residentInput },
    { label: 'QI Improvement Items Tracker (issues and opportunities log)', checked: sp.qiTracker }
  ], 'source');

  // ---- 2. Objectives ----
  w.newPage();
  w.h2('2. Progress on every Plan objective (620.C.5)');
  w.note('Every objective in the current Plan, with its baseline, target and this month\'s result (entered on the QI & RM tab).');
  const rows2 = [];
  d.goals.forEach(function (g) {
    rows2.push({ group: 'Goal ' + g.number + ' - ' + g.name + (g.tag ? ' (' + g.tag + ')' : '') });
    d.objectives.filter(function (o) { return Number(o.goalNumber) === Number(g.number); }).forEach(function (o) {
      const res = o.result;
      const has = res && (res.status || res.valueText || res.total);
      rows2.push([
        { text: o.code, bold: true },
        (o.service ? o.service + ': ' : '') + o.objective,
        o.target, o.baseline,
        resultText(o.lastResult) + (o.lastResult && o.lastResult.status ? ' (' + o.lastResult.status + ')' : ''),
        has ? resultText(res) : txt('obj_now', ''),
        has && res.status ? { text: res.status, bold: true, color: statusColor(res.status) } : sel('obj_status', ['', 'On track', 'At risk', 'Not met', 'Met'], ''),
        has ? (res.comment || '') : txt('obj_comment', '')
      ]);
    });
  });
  w.table([{ label: 'Obj.', w: 0.5 }, { label: 'Objective (from the Plan)', w: 4.2 }, { label: 'Target', w: 1.6 }, { label: 'Baseline', w: 1.1 }, { label: 'Last month', w: 1.3 }, { label: 'This month', w: 1.3 }, { label: 'Status', w: 0.9 }, { label: 'Comment / evidence', w: 2.4 }], rows2, { size: 7.2 });

  // ---- 3. Follow-up ----
  w.h2('3. Follow-up on objectives At risk or Not met (Policy 620 B)');
  const rows3 = d.followUps.map(function (o) {
    const res = o.result;
    return [
      { text: o.code + (o.service ? ' ' + o.service : ''), bold: true },
      { text: res.status, bold: true, color: statusColor(res.status) },
      res.cause ? res.cause : txt('fu_cause', '', { multiline: true }),
      res.revisedAction ? res.revisedAction : txt('fu_action', '', { multiline: true }),
      res.followOwner || o.owner || '',
      res.followDue ? us(res.followDue) : txt('fu_due', ''),
      String(o.quartersNotMet || (res.status === 'Not met' ? 1 : 0))
    ];
  });
  if (!rows3.length) rows3.push([{ text: 'None', bold: true }, '-', 'No objective was At risk or Not met this month.', '', '', '', '']);
  w.table([{ label: 'Obj.', w: 0.9 }, { label: 'Status', w: 0.8 }, { label: 'Why (brief cause)', w: 3 }, { label: 'Revised action', w: 3 }, { label: 'Owner', w: 1.2 }, { label: 'Due', w: 0.8 }, { label: 'Quarters not met', w: 0.8 }], rows3);

  // ---- 4. CAP monitoring ----
  w.h2('4. CAP monitoring (620.C.4, 620.D.3; 12VAC35-105-170)');
  if (!d.caps) {
    w.text('CAP Review could not be read. Summarize each open CAP here.', { color: RED });
    w.table([{ label: 'Notes', w: 1 }], [[txt('cap_notes', '', { multiline: true, height: 60 })]]);
  } else {
    w.note('From CAP Review: every open citation, and citations closed since ' + us(d.caps.since) + ' (start of the previous quarter). Detail and dated notes are in CAP Review.');
    w.table([{ label: 'CAP', w: 3.4 }, { label: 'Items', w: 0.6 }, { label: 'Open', w: 0.6 }, { label: 'Closed this month', w: 1 }, { label: 'Recurrence?', w: 1 }, { label: 'Notes', w: 3.4 }],
      d.caps.caps.map(function (c) {
        return [c.cap.licenseNumber + ' ' + c.cap.location + ' - Inspection ' + us(c.cap.inspectionDate), String(c.total), String(c.open), String(c.closedThisMonth), sel('cap_recur', ['', 'No', 'Yes'], ''), txt('cap_note', '')];
      }));
    const open = [];
    d.caps.caps.forEach(function (c) {
      c.openItems.forEach(function (i) {
        const u = i.updates[0];
        open.push([c.cap.location, { text: i.citation, bold: true }, i.standard, i.plannedDate ? { text: us(i.plannedDate) + (i.overdue ? ' (overdue)' : ''), color: i.overdue ? RED : INK } : '', i.olrStatus + (i.olrDate ? ' ' + us(i.olrDate) : ''), u ? us(u.date) + ': ' + u.text : 'No update yet']);
      });
    });
    w.text('Open citations (' + open.length + ')', { size: 9.5, bold: true, color: NAVY });
    if (open.length) w.table([{ label: 'CAP', w: 1 }, { label: '#', w: 0.55 }, { label: 'Standard', w: 1.6 }, { label: 'Planned completion', w: 1.1 }, { label: 'OLR', w: 1.3 }, { label: 'Latest update', w: 6 }], open, { size: 7 });
    else w.text('None.', { size: 8 });
    const closed = [];
    d.caps.caps.forEach(function (c) {
      c.closedSince.forEach(function (i) { closed.push([c.cap.location, { text: i.citation, bold: true }, i.standard, us(i.closedDate) + (i.closedBy ? ' (' + i.closedBy + ')' : ''), 'Reason: ' + i.closureReason + '\nEvidence: ' + i.closureEvidence + (i.evidenceLink ? '\n' + i.evidenceLink : '')]); });
    });
    w.text('Closed since ' + us(d.caps.since) + ' (' + closed.length + ')', { size: 9.5, bold: true, color: NAVY });
    if (closed.length) w.table([{ label: 'CAP', w: 1 }, { label: '#', w: 0.55 }, { label: 'Standard', w: 1.6 }, { label: 'Closed', w: 1.2 }, { label: 'Reason and evidence', w: 7 }], closed, { size: 7 });
    else w.text('None.', { size: 8 });
    w.gap(2);
  }
  w.checks([
    { label: 'Status updated in CAP Review for every open citation (dated)', checked: d.caps && d.caps.caps.every(function (c) { return !c.open || c.updatedAll; }) },
    { label: 'Months compliant counted for items in monitoring; items that met their period (3 consecutive compliant months, or 6 if systemic or repeat) closed with evidence', checked: false },
    { label: 'Any recurrence: RCA within 30 days and the Policy 620 D decision recorded (revised CAP to DBHDS, or continue with added measures)', checked: false },
    { label: 'A CAP opened, or all items of a CAP closed? If yes, the Plan\'s Open Corrective Action Plans list needs a new version (Section 8)', checked: d.prechecks.version.cap }
  ], 'cap_check');

  // ---- 5. Serious incidents and risk ----
  w.h2('5. Serious incidents and risk (160, 520.C, 520.D)', 140);
  if (!r) w.text('The Risk Tracking Tool could not be read, so this section is left to fill in.', { color: RED, size: 8 });
  else w.note('From the Risk Tracking Tool (' + r.file.name + ').');
  const inc = r ? r.incidents : null;
  const locTypes = inc && inc.list.length ? inc.list.map(function (i) { return i.level + ': ' + i.risk + ' (' + i.location + ', ' + us(i.date) + ')'; }).join('; ') : (r ? 'None' : '');
  w.table([{ label: 'Serious incidents this month (Individual Log)', w: 3 }, { label: 'Level I', w: 1 }, { label: 'Level II', w: 1 }, { label: 'Level III', w: 1 }, { label: 'Locations and types', w: 5 }], [
    ['Count', inc ? String(inc.levelI) : txt('lvl1', ''), inc ? String(inc.levelII) : txt('lvl2', ''), inc ? String(inc.levelIII) : txt('lvl3', ''), r ? locTypes : txt('lvl_types', '')]
  ]);
  const cc = r && r.careConcerns;
  const c2 = inc ? inc.list.filter(function (i) { return /level\s*(ii|iii)$/i.test(i.level); }) : [];
  const comp = r ? r.compliance : null;
  const byItem = {};
  if (comp) comp.findings.forEach(function (f) { (byItem[f.item] = byItem[f.item] || []).push(f.location); });
  const findingText = Object.keys(byItem).map(function (k) { return k + ' at ' + byItem[k].join(', '); }).join('; ');
  w.table([{ label: 'Check', w: 4.6 }, { label: 'Result', w: 1.2 }, { label: 'Notes / evidence', w: 5 }], [
    ['Every Level II/III reported in CHRIS within 24 hours (160.D)', sel('chris', ['', 'Yes', 'No', 'N/A'], inc ? (c2.length ? '' : 'N/A') : ''), txt('chris_notes', c2.length ? c2.map(function (i) { return i.initials + ' ' + us(i.date) + ' ' + i.level + ' (' + i.location + ')'; }).join('; ') : (inc ? 'No Level II or III incidents this month.' : ''))],
    ['RCAs due this month completed within 30 days and entered in the RCA Log (160.E.1)', sel('rca', ['', 'Yes', 'No', 'N/A'], inc ? (inc.rcaDue.length ? '' : 'N/A') : ''), txt('rca_notes', inc && inc.rcaDue.length ? inc.rcaDue.map(function (i) { return i.initials + ' (' + i.location + ') RCA due ' + us(i.due); }).join('; ') : (inc ? 'No RCAs due this month.' : ''))],
    ['Detailed-RCA thresholds checked (Policy 160): any met?', cc ? { text: cc.detailedRcaMet ? 'Yes' : 'No', bold: true } : sel('thr', ['', 'No', 'Yes'], ''), cc ? (cc.detailedRcaMet ? cc.detailedRca.filter(function (e) { return e.count; }).map(function (e) { return e.label + ' (' + e.count + ')'; }).join('; ') : 'Checked in Care Concerns & Risk Triggers: none of the ' + cc.detailedRca.length + ' ASRS thresholds met.') : txt('thr_notes', '')],
    ['DBHDS care concerns and risk triggers (520.D): any met?', cc ? { text: cc.careConcernsMet ? 'Yes' : 'No', bold: true } : sel('cc', ['', 'No', 'Yes'], ''), cc ? (cc.careConcernsMet ? cc.careConcerns.filter(function (e) { return e.count; }).map(function (e) { return e.label + ' (' + e.count + ')'; }).join('; ') : 'None of the ' + cc.careConcerns.length + ' DBHDS care concerns met.') : txt('cc_notes', '')],
    ['Restraint, seclusion or restrictions used (520.C.4)', cc ? { text: cc.restraintCount ? String(cc.restraintCount) : 'None', bold: true } : txt('restraint', ''), txt('restraint_notes', '')],
    ['Serious injuries to staff, contractors or visitors (520.F)', txt('injuries', ''), txt('injuries_notes', '')],
    ['Monthly compliance reports received and reviewed: Location Compliance Reports (ASRS-520-03, due the 5th); Community Engagement Individual (ASRS-CE-07) and Staff (ASRS-CE-08) reports (due the 10th)', sel('reports', ['', 'Yes', 'No'], ''), txt('reports_notes', 'Missing or late: ')],
    ['Compliance Log complete: every row marked for every location (Compliance Summary shows a check)', comp ? { text: comp.complete ? 'Yes' : 'No', bold: true, color: comp.complete ? INK : RED } : sel('cl', ['', 'Yes', 'No'], ''), comp ? (comp.rows ? comp.rows + ' rows for the month, ' + comp.unmarked + ' unmarked' + (comp.reviewedMark ? '; Compliance Summary: ' + comp.reviewedMark : '') : 'No Compliance Log rows for this month yet.') : txt('cl_notes', '')],
    ['Compliance Log findings this month (item and location)', comp ? { text: comp.findings.length + ' finding' + (comp.findings.length === 1 ? '' : 's'), bold: true } : txt('findings', ''), comp ? (findingText || 'None') : txt('findings_notes', '')],
    ['New risks to add to the Plan as an objective or improvement item', txt('new_risks', ''), txt('new_risks_notes', '')]
  ], { size: 7.4 });
  if (comp && comp.findings.length) {
    w.text('Compliance Log findings', { size: 9, bold: true, color: NAVY });
    w.table([{ label: 'Item', w: 0.5 }, { label: 'Location', w: 1 }, { label: 'Finding', w: 4 }, { label: 'Action taken', w: 4 }, { label: 'Status', w: 0.8 }], comp.findings.map(function (f) { return [f.item, f.location, f.finding, f.action, f.status]; }), { size: 7 });
  }

  // ---- 6. Input from individuals, improvement items ----
  w.h2('6. Input from individuals and ARs (620.E) and improvement items', 120);
  w.text('Questionnaires completed this month (Liaison app)', { size: 9.5, bold: true, color: NAVY });
  if (!d.questionnaires) w.table([{ label: 'Notes', w: 1 }], [[txt('qs_notes', '', { multiline: true, height: 40 })]]);
  else if (!d.questionnaires.length) w.text('None completed this month.', { size: 8 });
  else w.table([{ label: 'Date', w: 0.8 }, { label: 'Location', w: 1 }, { label: 'Questionnaire', w: 1.3 }, { label: 'Resident / spoke with', w: 1.6 }, { label: 'Liaison', w: 1.2 }, { label: 'Filed PDF', w: 4 }],
    d.questionnaires.map(function (q) { return [us(q.submittedAt), q.location, q.audience, [q.resident, q.spokeWith].filter(Boolean).join(' / '), q.liaison, q.pdfLink || '(PDF pending)']; }), { size: 7 });
  w.text('QI Improvement Items Tracker (ASRS-620-09)', { size: 9.5, bold: true, color: NAVY });
  const it = d.items;
  w.table([{ label: 'Item', w: 4 }, { label: 'Count', w: 0.7 }, { label: 'Notes', w: 5 }], [
    ['Open items reviewed; latest update entered on each', it.updated + ' of ' + it.active, it.notUpdated.length ? 'No update this month: ' + it.notUpdated.join(', ') : 'Every active item updated this month.'],
    ['Items overdue', String(it.overdue.length), it.overdue.join(', ') || 'None'],
    ['Completed this month (completed date and evidence entered)', String(it.completed.length), it.completed.join(', ') || 'None'],
    ['New items or ideas added this month', String(it.added.length), it.added.join(', ') || 'None'],
    ['Promoted to a Plan objective, or dropped', String(it.promotedDropped.length), (it.promotedDropped.join(', ') || 'None') + (it.promotedDropped.some(function (x) { return /promoted/.test(x); }) ? ' (promotion needs a new Plan version, Section 8)' : '')]
  ], { size: 7.4 });

  // ---- 7. Quarter-end ----
  const q = r && r.quarter;
  w.h2('7. Quarter-end summary' + (d.quarterEnd ? ' - Q' + (q ? q.n + ' ' + q.year : '') : ''), 100);
  if (!d.quarterEnd) {
    w.text('N/A - not a quarter-end month (completed in January, April, July and October for the quarter just ended).', { size: 8.3 });
  } else {
    const ws = q && q.worksheet;
    const wsRow = function (re) { const x = ws && ws.rows.find(function (rr) { return re.test(rr.label); }); return x ? [x.incidents, x.triggers].filter(Boolean).join(' Triggers/care concerns: ') : ''; };
    const one = function (code, svc) { const o = d.objectives.find(function (x) { return x.code === code && (!svc || x.service === svc); }); return o && o.result ? resultText(o.result) + (o.result.status ? ' (' + o.result.status + ')' : '') : 'not entered'; };
    const statusCounts = {};
    d.objectives.forEach(function (o) { const s = (o.result && o.result.status) || 'Not entered'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
    const rows7 = [
      ['Location Systemic Risk Assessment reviews, all five areas, every location (520.C; due the 15th)', chk('q_sra', q && q.sra && q.sra.done), q && q.sra ? q.sra.sheet + ': ' + (q.sra.completed || 'not completed') : txt('q_sra_notes', '')],
      ['Level I-III incident trends, causes and remediation (160.C)', chk('q_trends', !!(ws && ws.filled)), ws && ws.filled ? ['Summary: ' + wsRow(/^summary/i), 'Trends: ' + wsRow(/^analysis/i), 'Remediation: ' + wsRow(/^indicated/i)].join('\n') : txt('q_trends_notes', 'Quarterly & Annual Worksheet not filled in for the quarter yet.', { multiline: true, height: 40 })],
      ['Compliance Log findings for the quarter', chk('q_findings', !!(q && q.findings)), q && q.findings ? q.findings.text : txt('q_findings_notes', '')],
      ['SRA items escalated to the Plan', chk('q_escalated', !!(q && q.sra)), q && q.sra ? (q.sra.escalated.length ? q.sra.escalated.map(function (e) { return e.item + ' - ' + e.action; }).join('\n') : 'None escalated.') : txt('q_escalated_notes', '')],
      ['Each objective\'s result and status for the quarter (from Section 2)', chk('q_objectives', d.entered === d.objectives.length), Object.keys(statusCounts).map(function (k) { return statusCounts[k] + ' ' + k; }).join(', ')],
      ['Community integration result for each licensed service (620.C.3)', chk('q_ci', true), 'Group Home ' + one('1a', 'Group Home') + ' · Sponsored Residential ' + one('1a', 'Sponsored Residential') + ' · Community Engagement ' + one('1a', 'Community Engagement')],
      ['New-hire orientation audit and training audit (Policies 440, 450)', chk('q_training', false), '4a training current: ' + one('4a') + ' · 4b orientation on time: ' + one('4b')],
      ['Satisfaction results (June and December quarters)', chk('q_sat', false), '5a offered: ' + one('5a') + ' · 5b satisfied: ' + one('5b')]
    ];
    w.table([{ label: 'Quarter-end item', w: 4 }, { label: 'Done?', w: 0.7 }, { label: 'Summary', w: 6 }], rows7, { size: 7.3 });
  }

  // ---- 8. Plan version ----
  w.h2('8. Does the QI & RM Plan need a new version? (620.C.1; Policy 620 G)', 160);
  w.note('Check every trigger that occurred this month. Pre-checked where the dashboard recorded it; confirm at the review. If any did, adopt a new version within 30 days.');
  const vp = d.prechecks.version;
  const anyV = vp.goal || vp.objective || vp.service || vp.riskManager || vp.cap || vp.annual;
  w.checks([
    { label: 'A goal was added, removed or reworded', checked: vp.goal },
    { label: 'An objective was added or removed, or its measure, target amount or target date changed' + (d.draftsThisMonth.length ? ' (' + d.draftsThisMonth.length + ' draft change' + (d.draftsThisMonth.length === 1 ? '' : 's') + ' this month: ' + d.draftsThisMonth.map(function (x) { return x.code; }).join(', ') + ')' : ''), checked: vp.objective },
    { label: 'A licensed service or location was added or closed', checked: vp.service },
    { label: 'The Risk Manager changed', checked: vp.riskManager },
    { label: 'A CAP was opened, or all items of a CAP were closed', checked: vp.cap },
    { label: 'Annual review (January): a new version is adopted even if nothing else changed', checked: vp.annual },
    { label: 'None of the above: the current version stays in effect (results, CAP item updates, improvement items, notes, other owner changes and typo fixes do not need a new version)', checked: !anyV }
  ], 'version');
  w.table([{ label: '', w: 2 }, { label: '', w: 8 }], [[{ text: 'New version adopted', bold: true }, txt('new_version', d.versionAdopted ? 'Version ' + d.versionAdopted.version + ' adopted ' + us(d.versionAdopted.effective) + (d.versions.find(function (v) { return v.supersededOn === d.versionAdopted.effective; }) ? '; Version ' + d.versions.find(function (v) { return v.supersededOn === d.versionAdopted.effective; }).version + ' superseded' : '') : '')]]);
  w.text('How to make a new Plan version', { size: 9, bold: true, color: NAVY });
  ['1. Save a copy of the current Plan named "ASRS Quality Improvement and Risk Management Plan - Version yyyymmdd" using the adoption date. Never edit an earlier version.',
    '2. Make the changes. Update the version date in the title, header and footer, and the effective statement under Scope.',
    '3. In the Version History, add the new version\'s row and enter the Superseded on date on the previous version\'s row.',
    '4. Sign and date the Approval section. The new version takes effect that day and the previous version ends the same day.',
    '5. Save the signed PDF in "QI & RM Plan / Version History". Rename the previous version\'s PDF to end with "- SUPERSEDED yyyy-mm-dd".',
    '6. Record it here, adopt it on the dashboard (QI & RM > Plan & drafts > Adopt a new Plan version), add it to the Review Log, and tell staff about any change that affects their work.'
  ].forEach(function (s) { w.text(s, { size: 7.8, indent: 6 }); });

  // ---- 9. Monthly compliance checklist ----
  w.h2('9. Monthly compliance checklist', 200);
  w.note('Every month. Any "No" becomes an action item in Section 11.');
  const rows9 = [
    ['620.C.5', 'A result and status for every objective in the current Plan', 'Section 2'],
    ['620.C.3', 'The community integration measure for each licensed service', 'Section 2, Goal 1'],
    ['Policy 620 B', 'A cause and revised action for every objective At risk or Not met (within 30 days)', 'Section 3'],
    ['620.C.4', 'Every open CAP item reviewed; status updated; closures only after the monitoring period, with evidence', 'Section 4; CAP Review'],
    ['620.D.3', 'Recurrence of a CAP citation handled (RCA; revised CAP or added measures)', 'Section 4'],
    ['160.D', 'Level II/III incidents reported in CHRIS within 24 hours', 'Section 5'],
    ['160.E.1-2', 'RCAs within 30 days; detailed-RCA threshold check documented', 'Section 5; RCA Log'],
    ['520.C-D', 'Compliance Log complete for every location; care concerns and risk triggers reviewed', 'Section 5; Risk Tracking Tool'],
    ['520.C.4', 'Restraint, seclusion and restrictions reviewed', 'Section 5'],
    ['620.E', 'Input from individuals and ARs documented; survey results recorded in survey months; improvements noted', 'Section 6'],
    ['Policy 620 A', 'QI Improvement Items Tracker reviewed: every open item updated; overdue items addressed', 'Section 6; tracker'],
    ['440 / 450', 'New hires oriented within 15 business days; overdue retraining flagged, including annual ASRS Hospitality and Person-Centered Thinking training', 'Section 2 (4a, 4b)'],
    ['620.C.1; 620 G', 'Plan version check done; new version made within 30 days of any trigger', 'Section 8'],
    ['Policy 620 B.5', 'Review Log entry made and the Notion monthly checklist completed', 'Risk Tracking Tool; Notion'],
    ['150; 470; P&P review', 'Scheduled and triggered policy reviews done; related documents reconciled; overdue policies on a catch-up schedule', 'Section 9 policy review block; P&P Monthly Review Form']
  ].map(function (x) { return [{ text: x[0], bold: true }, x[1], sel('m9', YNA, ''), x[2]]; });
  w.table([{ label: 'Reg.', w: 1.2 }, { label: 'This month\'s review includes...', w: 6 }, { label: 'Yes / No / N/A', w: 1.1 }, { label: 'Where (section or record)', w: 2.3 }], rows9, { size: 7.4 });
  w.text('Policy and procedure review', { size: 9.5, bold: true, color: NAVY });
  w.note('Summarize this month\'s P&P Monthly Review Form here and attach the signed form.');
  const pp = d.policies;
  if (pp) w.note('From the policy register (QI & RM > Policies): ' + pp.activeCount + ' active policies.' + (pp.capTriggered.length ? ' Policies with open CAP citations not yet reviewed: ' + pp.capTriggered.join(', ') + '.' : ''));
  const ppList = function (a, none) { return a && a.length ? a.join('; ') : none; };
  w.table([{ label: 'Policy and procedure review (P&P Monthly Review Form, ASRS-620-03)', w: 5 }, { label: 'Result', w: 1.3 }, { label: 'Notes / evidence', w: 4 }], [
    ['Policies scheduled for review this month (next annual review due this month)', pp ? { text: pp.scheduled.done + ' of ' + pp.scheduled.total + ' reviewed', bold: true } : txt('pp_sched', '__ of __ reviewed'), pp ? ppList(pp.scheduled.list, 'None due this month.') : txt('pp_sched_n', '')],
    ['Triggered reviews: DBHDS regulation or guidance change, citation, RCA/SRA finding, or system change', pp ? { text: pp.triggered.length ? String(pp.triggered.length) : 'None', bold: true } : txt('pp_trig', ''), pp ? ppList(pp.triggered, 'None.') : txt('pp_trig_n', '')],
    ['Policies updated (new review/revised date entered in the policy header and Appendix A)', pp ? { text: String(pp.revised.length), bold: true } : txt('pp_upd', ''), pp ? ppList(pp.revised, 'None.') : txt('pp_upd_n', '')],
    ['Staff notified of changes that affect their work', pp ? { text: pp.staffNotified, bold: true } : sel('pp_staff', ['', 'Yes', 'N/A'], ''), pp ? (pp.staffHow || (pp.revised.length ? '' : 'No policy changes this month.')) : txt('pp_staff_n', '')],
    ['Related forms, checklists and reports reconciled for each updated policy (no documents flagged Review)', pp ? { text: pp.reconciled, bold: true, color: pp.reconciled === 'No' ? RED : INK } : sel('pp_rel', ['', 'Yes', 'No'], ''), pp ? (pp.reviewDocs.length ? 'Still to reconcile: ' + pp.reviewDocs.join('; ') : (pp.docsUpdated ? 'Updated: ' + pp.docsUpdated : 'No documents flagged.')) : txt('pp_rel_n', '')],
    ['Policies overdue (last reviewed more than 12 months ago)', pp ? { text: pp.overdue.count + ' of ' + pp.overdue.of, bold: true, color: pp.overdue.count ? RED : INK } : txt('pp_over', '__ of __'), pp ? (pp.overdue.count ? ppList(pp.overdue.list, '') : 'None. Next due: ' + ppList(pp.nextDue, '-')) : txt('pp_over_n', '')],
    ['P&P Monthly Review Form completed, signed and attached to this report', sel('pp_form', ['', 'Yes', 'No'], ''), txt('pp_form_n', '')]
  ], { size: 7.4 });

  // ---- 10. Annual ----
  w.h2('10. Annual compliance checklist (January report only)', d.january ? 200 : 60);
  if (!d.january) {
    w.text('N/A - completed in the January report only.', { size: 8.3 });
  } else {
    w.note('Complete after the annual SRA and before the Plan\'s annual version.');
    const A = [
      { group: 'Quality improvement program (12VAC35-105-620)' },
      ['620.A', 'Written QI policies and procedures are implemented; the program identifies, monitors and evaluates clinical and service quality on an ongoing basis', 'Policy 620; QI & RM Plan; monthly reports'],
      ['620.B', 'Standard QI tools are used, including root cause analysis, and a QI plan is in place', 'Policy 620 F; RCA Log; QI & RM Plan'],
      ['620.C.1', 'The Plan was reviewed and a version adopted within the last 12 months', 'Plan Version History; signed version'],
      ['620.C.2', 'Every goal has a measurable objective with baseline, target amount, target date, data source and owner', 'Plan: Goals and Measurable Objectives'],
      ['620.C.3', 'The DBHDS statewide measure is included and reported: community inclusion or meaningful work', 'Plan Goal 1; monthly reports by service'],
      ['620.C.4', 'Every approved CAP is referenced in the Plan and its items are monitored monthly with the monitoring period applied', 'Plan: Open Corrective Action Plans; CAP Review; monthly reports'],
      ['620.C.5', 'Progress on every objective was reviewed every month, with follow-up when At risk or Not met', '12 monthly reports'],
      ['620.D.1-3', 'Policy states the criteria for setting goals, updating the Plan, and revised vs. continued CAPs', 'Policy 620 A, G and D'],
      ['150; P&P review', 'Every policy reviewed within the last 12 months; Appendix A index current; related documents in sync', 'P&P Monthly Review Form Appendix A; Policy-Document Register'],
      ['620.E', 'Input from individuals and ARs is part of the Plan; improvements made when indicated', 'Plan: Input section and Goal 5; monthly reports'],
      { group: 'Risk management (12VAC35-105-520)' },
      ['520.A', 'A designated Risk Manager has completed DBHDS-approved training; current attestation on file', 'Policy 520; attestation'],
      ['520.B', 'The written plan covers personal injury, infectious disease, property damage or loss, and other liability for each licensed service', 'Plan: Risk Management Plan'],
      ['520.C', 'A systemic risk assessment was completed within the last 12 months for every licensed service, covering all five areas', 'Annual SRA'],
      ['520.D', 'The assessment uses DBHDS risk triggers and thresholds', 'Care Concerns & Risk Triggers tab'],
      ['520.E', 'Each location had a documented safety inspection within the last 12 months; recommendations implemented', 'Inspection reports'],
      ['520.F', 'Serious injuries to staff, contractors, students, volunteers and visitors documented, kept three years and evaluated annually', 'Injury log; annual SRA'],
      { group: 'Serious incidents, training and emergency preparedness' },
      ['160.C', 'Level I, II and III incidents reviewed at least quarterly for trends, causes and remediation', 'Quarter-end summaries; Quarterly & Annual Worksheet'],
      ['160.E', 'RCA within 30 days for every Level II and III; detailed-RCA thresholds checked monthly', 'RCA Log; monthly reports'],
      ['440 / 450', 'Orientation within 15 business days; retraining schedule followed', 'New-hire and training audits'],
      ['530.C-D', 'Annual emergency preparedness training held; emergency plan reviewed within the last 12 months', 'Training records; EP plan']
    ].map(function (x) { return x.group ? x : [{ text: x[0], bold: true }, x[1], x[2], sel('a10', ['', 'Yes', 'No'], '')]; });
    w.table([{ label: 'Reg.', w: 1.2 }, { label: 'Requirement', w: 5.5 }, { label: 'Evidence / where it is met', w: 3 }, { label: 'Yes / No', w: 0.9 }], A, { size: 7.3 });
  }

  // ---- 11. Action items and sign-off ----
  w.h2('11. Action items and sign-off', 200);
  const acts = [];
  for (let i = 1; i <= 5; i++) acts.push([String(i), txt('act', ''), txt('act_owner', ''), txt('act_due', ''), txt('act_status', '')]);
  w.table([{ label: '#', w: 0.4 }, { label: 'Action item from this review', w: 6 }, { label: 'Owner', w: 1.5 }, { label: 'Due', w: 1 }, { label: 'Status', w: 1.2 }], acts);
  w.table([{ label: 'Role', w: 3 }, { label: 'Signature', w: 4.5 }, { label: 'Date', w: 1.5 }], [
    [{ text: 'Risk Manager (prepared)', bold: true }, txt('sig_rm', ''), txt('sig_rm_date', '')],
    [{ text: 'Executive Director (reviewed)', bold: true }, txt('sig_ed', ''), txt('sig_ed_date', '')]
  ]);

  return w.finish();
}

function reportFilename(d) {
  return 'Monthly QI & RM Status and Compliance Report - ' + d.month + '.pdf';
}

module.exports = { buildQiReportPdf, reportFilename };
