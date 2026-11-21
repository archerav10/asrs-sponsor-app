const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { usDate, todayIso } = require('./cap-review');

// CAP Review PDFs (admin dashboard):
//   buildCapReportPdf(detail)   one CAP, every citation (open and closed),
//                               with actions, updates and close-outs
//   buildOpenItemsPdf(groups)   every open citation, grouped by CAP

// The standard fonts only encode WinAnsi; anything else is swapped for a
// plain equivalent so a stray symbol can't break the report.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SWAPS = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '☐': '[ ]', '☑': '[x]', '\t': '  ', ' ': ' ', '‑': '-', '−': '-' };
function clean(s) {
  return Array.from(String(s == null ? '' : s)).map(function (ch) {
    if (SWAPS[ch] !== undefined) return SWAPS[ch];
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.indexOf(ch) !== -1) return ch;
    return '?';
  }).join('');
}

const W = 612, H = 792, M = 46, CW = W - 2 * M;
const INK = rgb(0.11, 0.14, 0.2), MUTED = rgb(0.4, 0.42, 0.46), LINE = rgb(0.85, 0.86, 0.88);
const GREEN = rgb(0.12, 0.45, 0.22), RED = rgb(0.68, 0.14, 0.1), AMBER = rgb(0.62, 0.42, 0.02), NAVY = rgb(0.12, 0.23, 0.37);

async function writer(docTitle) {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(docTitle));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = { doc: doc, page: null, y: 0, pageNo: 0 };

  function newPage() {
    w.page = doc.addPage([W, H]);
    w.pageNo++;
    w.y = H - M;
  }
  function need(h) { if (w.y - h < M + 14) newPage(); }
  function wrap(text, f, size, width) {
    const out = [];
    clean(text).split('\n').forEach(function (para) {
      let line = '';
      para.split(/ +/).forEach(function (word) {
        const t = line ? line + ' ' + word : word;
        if (f.widthOfTextAtSize(t, size) <= width) { line = t; return; }
        if (line) out.push(line);
        // A word wider than the line (a long link): break it.
        while (f.widthOfTextAtSize(word, size) > width) {
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
  }
  w.text = function (text, o) {
    o = o || {};
    const size = o.size || 9.5, f = o.bold ? bold : font, indent = o.indent || 0, lh = size * 1.3;
    wrap(text, f, size, CW - indent).forEach(function (l) {
      need(lh);
      w.page.drawText(l, { x: M + indent, y: w.y - size, size: size, font: f, color: o.color || INK });
      w.y -= lh;
    });
  };
  // "Label: value" with the label in bold.
  w.field = function (label, value, o) {
    o = o || {};
    if (!value) return;
    const size = o.size || 9.5, indent = o.indent || 0, lh = size * 1.3;
    const lw = bold.widthOfTextAtSize(clean(label) + ' ', size);
    const lines = wrap(value, font, size, CW - indent - lw);
    lines.forEach(function (l, i) {
      need(lh);
      if (i === 0) w.page.drawText(clean(label), { x: M + indent, y: w.y - size, size: size, font: bold, color: o.labelColor || INK });
      w.page.drawText(l, { x: M + indent + lw, y: w.y - size, size: size, font: font, color: o.color || INK });
      w.y -= lh;
    });
  };
  w.gap = function (h) { w.y -= h; };
  w.rule = function () { need(8); w.page.drawLine({ start: { x: M, y: w.y - 3 }, end: { x: W - M, y: w.y - 3 }, thickness: 0.6, color: LINE }); w.y -= 8; };
  w.need = need;
  w.newPage = newPage;
  w.finish = async function (footer) {
    const pages = doc.getPages();
    pages.forEach(function (p, i) {
      const t = clean(footer + '   ·   Page ' + (i + 1) + ' of ' + pages.length);
      p.drawText(t, { x: M, y: M - 18, size: 7.5, font: font, color: MUTED });
    });
    return doc.save();
  };
  newPage();
  return w;
}

function statusLine(i) {
  const bits = [i.status === 'Closed' ? 'CLOSED ' + usDate(i.closedDate) : (i.overdue ? 'OPEN - OVERDUE' : 'OPEN')];
  bits.push('OLR: ' + (i.olrStatus || 'Pending') + (i.olrDate ? ' ' + usDate(i.olrDate) : ''));
  bits.push('Planned completion: ' + (i.plannedDate ? usDate(i.plannedDate) : 'none'));
  if (i.compliance) bits.push('Comp: ' + i.compliance);
  return bits.join('   |   ');
}

function statusColor(i) {
  return i.status === 'Closed' ? GREEN : (i.overdue ? RED : AMBER);
}

function updateLine(u) {
  return usDate(u.date) + (u.by ? ' (' + u.by + ')' : '') + (u.kind && u.kind !== 'Update' && u.kind !== 'Imported' ? ' [' + u.kind + ']' : '') + ': ' + u.text;
}

function capHeader(w, cap) {
  w.field('License #: ', cap.licenseNumber + '     Location: ' + cap.location + '     Inspection: ' + usDate(cap.inspectionDate));
  w.field('Facility: ', [cap.facilityName, cap.organization].filter(Boolean).join(' - '));
  w.field('Licensing Specialist: ', cap.specialist);
}

function item(w, i, opts) {
  w.need(60);
  w.text(i.citation + '   ' + i.standard, { size: 11, bold: true, color: NAVY });
  w.text(statusLine(i), { size: 8.5, bold: true, color: statusColor(i) });
  if (i.standardText) w.text(i.standardText, { size: 8.5, color: MUTED });
  w.gap(3);
  if (opts.description && i.description) { w.text('Description of Noncompliance (DBHDS)', { size: 8.5, bold: true }); w.text(i.description, { size: 9, indent: 10 }); w.gap(2); }
  if (i.actions) { w.text('Actions to be Taken', { size: 8.5, bold: true }); w.text(i.actions, { size: 9, indent: 10 }); w.gap(2); }
  if (i.status === 'Closed') {
    w.text('Close-out', { size: 8.5, bold: true, color: GREEN });
    w.field('Closed: ', usDate(i.closedDate) + (i.closedBy ? ' by ' + i.closedBy : ''), { size: 9, indent: 10 });
    w.field('Reason: ', i.closureReason, { size: 9, indent: 10 });
    w.field('Supporting evidence: ', i.closureEvidence, { size: 9, indent: 10 });
    w.field('Evidence link: ', i.evidenceLink, { size: 9, indent: 10 });
    w.gap(2);
  }
  const ups = opts.updates === 'all' ? i.updates : i.updates.slice(0, opts.updates || 3);
  if (ups.length) {
    w.text('Status, notes and updates (newest first)' + (ups.length < i.updates.length ? ' - latest ' + ups.length + ' of ' + i.updates.length : ''), { size: 8.5, bold: true });
    ups.forEach(function (u) { w.text(updateLine(u), { size: 9, indent: 10 }); });
  } else {
    w.text('No updates yet.', { size: 9, indent: 10, color: MUTED });
  }
  w.gap(4);
  w.rule();
}

function summaryLine(c) {
  return c.total + ' citations: ' + c.open + ' open' + (c.overdue ? ' (' + c.overdue + ' overdue)' : '') + ', ' + c.closed + ' closed';
}

async function buildCapReportPdf(detail) {
  const cap = detail.cap;
  const w = await writer('CAP Report - ' + cap.title);
  w.text('Arch Support Residential Services', { size: 9, color: MUTED });
  w.text('Corrective Action Plan Report', { size: 17, bold: true });
  w.text(cap.title, { size: 11, bold: true, color: NAVY });
  w.gap(4);
  capHeader(w, cap);
  w.field('Status: ', (cap.status || 'Open') + '  -  ' + summaryLine(cap.counts));
  w.field('Generated: ', usDate(todayIso()));
  w.gap(4);
  w.rule();
  detail.items.forEach(function (i) { item(w, i, { description: true, updates: 'all' }); });
  if (cap.notes) {
    w.need(40);
    w.text('CAP notes (ECTA statement and DBHDS General Comments)', { size: 10, bold: true, color: NAVY });
    w.text(cap.notes, { size: 8.5 });
  }
  return w.finish('CAP Report - ' + cap.title + ' - generated ' + usDate(todayIso()));
}

async function buildOpenItemsPdf(groups, locations) {
  const w = await writer('CAP Open Items');
  const total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
  const late = groups.reduce(function (n, g) { return n + g.items.filter(function (i) { return i.overdue; }).length; }, 0);
  w.text('Arch Support Residential Services', { size: 9, color: MUTED });
  w.text('CAP Open Items', { size: 17, bold: true });
  w.field('Generated: ', usDate(todayIso()) + '     Locations: ' + locations.join(', '));
  w.field('Open citations: ', total + ' across ' + groups.length + ' CAP' + (groups.length === 1 ? '' : 's') + (late ? ' (' + late + ' past their planned completion date)' : ''));
  w.gap(4);
  w.rule();
  if (!groups.length) w.text('No open CAP citations.', { size: 10 });
  groups.forEach(function (g) {
    w.need(70);
    w.gap(2);
    w.text(g.cap.title, { size: 13, bold: true, color: NAVY });
    capHeader(w, g.cap);
    w.field('Open: ', summaryLine(g.cap.counts));
    w.gap(2);
    w.rule();
    g.items.forEach(function (i) { item(w, i, { description: true, updates: 3 }); });
  });
  return w.finish('CAP Open Items - generated ' + usDate(todayIso()));
}

function fileSafe(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

module.exports = { buildCapReportPdf, buildOpenItemsPdf, fileSafe };
