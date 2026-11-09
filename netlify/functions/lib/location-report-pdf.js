// PDF for the Monthly Location Compliance Report (ASRS-520-03), from the
// report object lib/location-report builds. Page 1 is the dashboard (one
// light per area); the detail pages follow, then findings and, on the
// Final, sign-off for the Residential Liaison and the Executive Director.

const W = 612, H = 792, M = 40, CW = W - 2 * M;
const COLORS = {
  ink: [0.114, 0.141, 0.129], muted: [0.369, 0.396, 0.373], line: [0.851, 0.867, 0.839], forest: [0.086, 0.2, 0.169],
  g: [0.18, 0.545, 0.341], y: [0.878, 0.659, 0], r: [0.784, 0.216, 0.176], m: [0.604, 0.631, 0.608], n: [0.788, 0.808, 0.784],
  redBg: [0.984, 0.925, 0.922], yellowBg: [0.992, 0.961, 0.863], greenBg: [0.914, 0.957, 0.933]
};
const LABEL_FINAL = { y: 'DUE SOON', r: 'ACTION NEEDED', m: 'TO ANSWER' };
const LABEL_MTD = { y: 'STILL DUE', r: 'ACTION NEEDED', m: 'TO ANSWER' };
const ALLOWED = /[^\x20-\x7E\n -ÿ–—‘’“”•…€]/g;

function clean(s) {
  return String(s == null ? '' : s).replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(ALLOWED, '');
}

function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return String(iso || ''); }
}
function fmt(iso) { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) + '/' + p[0] : ''; }

async function buildLocationReportPdf(report) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const C = function (k) { const c = COLORS[k]; return rgb(c[0], c[1], c[2]); };
  const final = report.mode === 'final';
  const LBL = final ? LABEL_FINAL : LABEL_MTD;
  const modeText = final ? 'Final' : 'Preview through ' + fmt(report.asOf);

  function wrap(text, f, size, width) {
    const out = [];
    clean(text).split('\n').forEach(function (para) {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach(function (w) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function text(page, s, x, y, opts) {
    opts = opts || {};
    page.drawText(clean(s), { x: x, y: y, size: opts.size || 9, font: opts.bold ? bold : font, color: C(opts.color || 'ink') });
  }
  function dot(page, s, cx, cy, r) {
    if (s === 'm') page.drawCircle({ x: cx, y: cy, size: r - 0.8, borderColor: C('m'), borderWidth: 1.6, color: rgb(1, 1, 1) });
    else page.drawCircle({ x: cx, y: cy, size: r, color: C(s) });
  }
  function hline(page, y, color, th) { page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: th || 0.6, color: C(color || 'line') }); }

  const counts = function (items) {
    const c = { r: 0, y: 0, m: 0 };
    items.forEach(function (i) { if (c[i.s] !== undefined) c[i.s]++; });
    const out = [];
    if (c.r) out.push(c.r + ' action');
    if (c.y) out.push(c.y + (final ? ' due soon' : ' still due'));
    if (c.m) out.push(c.m + ' to answer');
    return out.join(', ') || '—';
  };
  const summary = function (a) {
    const open = a.items.filter(function (i) { return i.s === 'r' || i.s === 'y'; });
    if (!open.length) {
      const g = a.items.filter(function (i) { return i.s === 'g'; }).length;
      return g ? 'All ' + g + ' item' + (g === 1 ? '' : 's') + ' compliant.' : (a.items[0] ? a.items[0].found : '');
    }
    return open.slice(0, 2).map(function (i) { return i.req.replace(/ \([0-9.,A-Z ]+\)$/, '') + ': ' + i.found; }).join(' ') + (open.length > 2 ? ' +' + (open.length - 2) + ' more.' : '');
  };

  // ---- Detail pages (drawn first so the dashboard knows page numbers) ----
  const detailPages = [];
  let page = null, y = 0;
  function newDetailPage(label) {
    page = doc.addPage([W, H]);
    detailPages.push(page);
    y = H - M;
    text(page, report.form + ' · ' + report.location + ' · ' + report.monthLabel + ' · ' + modeText, M, y - 8, { size: 7.5, color: 'muted' });
    const lw = font.widthOfTextAtSize(label, 7.5);
    text(page, label, W - M - lw, y - 8, { size: 7.5, color: 'muted' });
    y -= 14; hline(page, y);
    y -= 10;
  }
  const COLS = { dot: M + 6, req: M + 18, reqW: 180, found: M + 206, foundW: 220, src: M + 434, srcW: CW - 434 };
  function tableHead(cols) {
    cols.forEach(function (c) { text(page, c[0], c[1], y - 8, { size: 6.5, bold: true, color: 'muted' }); });
    y -= 12; hline(page, y, 'ink', 0.9); y -= 2;
  }
  const areaPage = {};
  newDetailPage('Detail');
  report.areas.forEach(function (a) {
    const rows = a.items.map(function (i) {
      const req = wrap(i.req, bold, 8, COLS.reqW);
      if (LBL[i.s]) req.push('\u0000' + LBL[i.s]);
      const found = wrap(i.found, font, 8, COLS.foundW);
      const src = wrap(i.src, font, 7, COLS.srcW);
      return { i: i, req: req, found: found, src: src, h: Math.max(req.length * 10, found.length * 10, src.length * 9) + 7 };
    });
    const firstH = 46 + (rows[0] ? rows[0].h : 0);
    if (y - firstH < M + 20) newDetailPage('Detail');
    areaPage[a.key] = detailPages.length + 1;
    // Area heading
    y -= 6;
    page.drawRectangle({ x: M, y: y - 14, width: 15, height: 15, color: C('forest') });
    page.drawText(a.key, { x: M + 7.5 - bold.widthOfTextAtSize(a.key, 9) / 2, y: y - 10.5, size: 9, font: bold, color: rgb(1, 1, 1) });
    text(page, a.title, M + 21, y - 11, { size: 11, bold: true, color: 'forest' });
    dot(page, a.status, M + 27 + bold.widthOfTextAtSize(clean(a.title), 11) + 2, y - 7, 4.5);
    const cnt = counts(a.items);
    text(page, cnt, W - M - font.widthOfTextAtSize(cnt, 8), y - 11, { size: 8, color: 'muted' });
    y -= 22;
    tableHead([['REQUIREMENT', COLS.req], ['WHAT THE APP FOUND', COLS.found], ['SOURCE', COLS.src]]);
    rows.forEach(function (row) {
      if (y - row.h < M + 20) { newDetailPage('Detail'); tableHead([['REQUIREMENT', COLS.req], ['WHAT THE APP FOUND', COLS.found], ['SOURCE', COLS.src]]); }
      const top = y - 4;
      dot(page, row.i.s, COLS.dot, top - 4, 4);
      row.req.forEach(function (l, k) {
        if (l.charAt(0) === '\u0000') text(page, l.slice(1), COLS.req, top - 8 - k * 10, { size: 6.5, bold: true, color: row.i.s === 'y' ? 'y' : row.i.s === 'r' ? 'r' : 'muted' });
        else text(page, l, COLS.req, top - 8 - k * 10, { size: 8, bold: true });
      });
      row.found.forEach(function (l, k) { text(page, l, COLS.found, top - 8 - k * 10, { size: 8 }); });
      row.src.forEach(function (l, k) { text(page, l, COLS.src, top - 8 - k * 9, { size: 7, color: 'muted' }); });
      y -= row.h;
      hline(page, y);
    });
    y -= 8;
  });

  // ---- Findings and sign-off ----
  newDetailPage(final ? 'Findings & sign-off' : 'Findings');
  const findingsPage = detailPages.length + 1;
  y -= 4;
  page.drawRectangle({ x: M, y: y - 14, width: 15, height: 15, color: C('forest') });
  page.drawText('K', { x: M + 4.5, y: y - 10.5, size: 9, font: bold, color: rgb(1, 1, 1) });
  text(page, 'Findings & corrective actions' + (final ? '' : ' (open so far)'), M + 21, y - 11, { size: 11, bold: true, color: 'forest' });
  y -= 22;
  wrap('Red items the app finds land here automatically. Concerns from interviews and questionnaires land here when the liaison flags them; the liaison escalates them to the QA/Issues log as needed. Owner and fix-by date are suggestions the reviewer can change.', font, 7.5, CW).forEach(function (l) { text(page, l, M, y - 8, { size: 7.5, color: 'muted' }); y -= 10; });
  y -= 4;
  const FC = { dot: M + 6, area: M + 16, finding: M + 42, findingW: 192, by: M + 240, owner: M + 290, ownerW: 70, fix: M + 366, action: M + 404, actionW: 90, log: M + 500 };
  const fHead = function () { tableHead([['AREA', FC.area], ['FINDING', FC.finding], ['RAISED BY', FC.by], ['OWNER', FC.owner], ['FIX BY', FC.fix], ['CORRECTIVE ACTION', FC.action], ['QA/ISSUES LOG', FC.log]]); };
  fHead();
  if (!report.findings.length) { text(page, 'No findings this month.', FC.finding, y - 10, { size: 8.5 }); y -= 18; }
  report.findings.forEach(function (f) {
    const lines = wrap(f.finding, bold, 8, FC.findingW);
    const owner = wrap(f.owner, font, 7.5, FC.ownerW);
    const h = Math.max(lines.length * 10, owner.length * 9, 20) + 8;
    if (y - h < M + 20) { newDetailPage('Findings'); fHead(); }
    const top = y - 4;
    dot(page, 'r', FC.dot, top - 4, 4);
    text(page, f.area, FC.area, top - 8, { size: 8 });
    lines.forEach(function (l, k) { text(page, l, FC.finding, top - 8 - k * 10, { size: 8, bold: true }); });
    text(page, f.raisedBy, FC.by, top - 8, { size: 7.5 });
    owner.forEach(function (l, k) { text(page, l, FC.owner, top - 8 - k * 9, { size: 7.5 }); });
    text(page, fmt(f.fixBy).replace(/\/\d{4}$/, ''), FC.fix, top - 8, { size: 7.5 });
    page.drawRectangle({ x: FC.log, y: top - 10, width: 7, height: 7, borderColor: C('ink'), borderWidth: 0.7 });
    if (f.escalated) { page.drawLine({ start: { x: FC.log + 1.2, y: top - 6.5 }, end: { x: FC.log + 3, y: top - 9 }, thickness: 1, color: C('ink') }); page.drawLine({ start: { x: FC.log + 3, y: top - 9 }, end: { x: FC.log + 6.5, y: top - 3.5 }, thickness: 1, color: C('ink') }); }
    text(page, 'Escalated', FC.log + 10, top - 9.5, { size: 7 });
    y -= h; hline(page, y);
  });
  if (final) {
    if (y < M + 120) newDetailPage('Sign-off');
    y -= 24;
    text(page, 'Sign-off', M, y, { size: 11, bold: true, color: 'forest' });
    y -= 8;
    ['Residential Liaison', 'Executive Director'].forEach(function (role) {
      y -= 30;
      text(page, role, M, y + 4, { size: 9, bold: true });
      page.drawLine({ start: { x: M + 150, y: y }, end: { x: M + 400, y: y }, thickness: 0.8, color: C('ink') });
      page.drawLine({ start: { x: M + 420, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: C('ink') });
      text(page, 'Signature', M + 150, y - 9, { size: 6.5, color: 'muted' });
      text(page, 'Date', M + 420, y - 9, { size: 6.5, color: 'muted' });
    });
    y -= 26;
    text(page, 'Governing policy 12VAC35-105-520; also 530, 550, 620, 665–680, 720–810, 880.', M, y, { size: 7, color: 'muted' });
  } else {
    y -= 16;
    wrap('No sign-off on the preview. The final report for ' + report.monthLabel + ' is generated once the month ends and signed by the Residential Liaison and the Executive Director.', font, 7.5, CW).forEach(function (l) { text(page, l, M, y, { size: 7.5, color: 'muted' }); y -= 10; });
  }

  // ---- Page 1: dashboard ----
  const p1 = doc.insertPage(0, [W, H]);
  page = p1; y = H - M;
  text(page, 'ARCH SUPPORT RESIDENTIAL SERVICES', M, y - 8, { size: 7.5, color: 'muted' });
  text(page, 'Monthly Location Compliance Report', M, y - 26, { size: 17, bold: true, color: 'forest' });
  const right = report.form + ' · Governing policy 12VAC35-105-520';
  text(page, right, W - M - font.widthOfTextAtSize(right, 7.5), y - 8, { size: 7.5, color: 'muted' });
  const rib = (final ? 'MONTH-END REPORT' : 'MONTH-TO-DATE PREVIEW · THROUGH ' + fmt(report.asOf)).toUpperCase();
  const ribW = bold.widthOfTextAtSize(rib, 7) + 12;
  page.drawRectangle({ x: W - M - ribW, y: y - 28, width: ribW, height: 13, color: final ? C('forest') : C('yellowBg'), borderColor: final ? undefined : C('y'), borderWidth: final ? 0 : 0.6 });
  page.drawText(rib, { x: W - M - ribW + 6, y: y - 24, size: 7, font: bold, color: final ? rgb(1, 1, 1) : rgb(0.48, 0.36, 0) });
  y -= 36;
  page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 2.2, color: C('forest') });
  y -= 10;
  function metaRow(cells) {
    const cw = CW / 4;
    page.drawRectangle({ x: M, y: y - 30, width: CW, height: 30, borderColor: C('line'), borderWidth: 0.7 });
    cells.forEach(function (c, i) {
      if (i) page.drawLine({ start: { x: M + i * cw, y: y }, end: { x: M + i * cw, y: y - 30 }, thickness: 0.7, color: C('line') });
      text(page, c[0].toUpperCase(), M + i * cw + 7, y - 10, { size: 6.5, bold: true, color: 'muted' });
      const v = wrap(c[1] || '—', bold, 9, cw - 12)[0];
      text(page, v, M + i * cw + 7, y - 23, { size: 9, bold: true });
    });
    y -= 36;
  }
  metaRow([['Location', report.location], ['Month', report.monthLabel], ['Licensed service', report.homeType], ['Residents', String(report.residents.length) + (report.residents.length ? ' (' + report.residents.join(', ') + ')' : '')]]);
  metaRow([['Sponsor', report.sponsors.join(', ')], ['Residential Liaison', report.liaisons.join(', ')], ['Generated', fmtDateTime(report.generatedAt)], [final ? 'Signed' : 'Status', final ? '' : 'Not for signature']]);
  if (!final) {
    const note = wrap('Preview. Shows the month so far, recalculated whenever it is generated. Anything not done yet but still due before ' + fmt(report.areas.length ? report.month + '-' + new Date(Date.UTC(+report.month.slice(0, 4), +report.month.slice(5, 7), 0)).getUTCDate() : '') + ' is yellow, not red. The final report is made once the month ends, frozen, and signed.', font, 7.5, CW - 16);
    const nh = note.length * 10 + 8;
    page.drawRectangle({ x: M, y: y - nh, width: CW, height: nh, color: rgb(1, 0.984, 0.933), borderColor: C('y'), borderWidth: 0.6 });
    note.forEach(function (l, k) { text(page, l, M + 8, y - 11 - k * 10, { size: 7.5 }); });
    y -= nh + 8;
  }
  const allItems = [];
  report.areas.forEach(function (a) { a.items.forEach(function (i) { allItems.push(i); }); });
  const nr = allItems.filter(function (i) { return i.s === 'r'; }).length;
  const ny = allItems.filter(function (i) { return i.s === 'y'; }).length;
  const ov = report.overall;
  page.drawRectangle({ x: M, y: y - 34, width: CW, height: 34, color: C(ov === 'r' ? 'redBg' : ov === 'y' ? 'yellowBg' : 'greenBg') });
  dot(page, ov, M + 18, y - 17, 7);
  text(page, ov === 'r' ? 'Action needed' : ov === 'y' ? 'Items coming due' : 'In compliance', M + 32, y - 15, { size: 11.5, bold: true });
  text(page, report.areas.length + ' areas · ' + nr + ' item' + (nr === 1 ? '' : 's') + ' need action · ' + ny + (final ? ' coming due' : ' still due this month') + ' · ' + report.findings.length + ' finding' + (report.findings.length === 1 ? '' : 's') + ' on page ' + findingsPage, M + 32, y - 27, { size: 7.5, color: 'muted' });
  y -= 44;
  const D = { dot: M + 8, area: M + 22, areaW: 140, sum: M + 168, sumW: 240, open: M + 416, openW: 70, pg: W - M };
  [['AREA', D.area], ['THIS MONTH', D.sum], ['OPEN ITEMS', D.open]].forEach(function (c) { text(page, c[0], c[1], y - 8, { size: 6.5, bold: true, color: 'muted' }); });
  text(page, 'PAGE', W - M - bold.widthOfTextAtSize('PAGE', 6.5), y - 8, { size: 6.5, bold: true, color: 'muted' });
  y -= 12; hline(page, y, 'ink', 0.9);
  const dashRows = report.areas.map(function (a) { return { s: a.status, area: a.key + '. ' + a.title, sum: summary(a), open: counts(a.items), pg: 'p. ' + areaPage[a.key] }; });
  dashRows.push({ s: report.findings.length ? 'r' : 'g', area: 'K. Findings & corrective actions', sum: report.findings.filter(function (f) { return f.raisedBy === 'App'; }).length + ' found by the app, ' + report.findings.filter(function (f) { return f.raisedBy !== 'App'; }).length + ' flagged by the liaison.', open: report.findings.length + ' open', pg: 'p. ' + findingsPage });
  dashRows.forEach(function (r) {
    const al = wrap(r.area, bold, 8.5, D.areaW);
    const sl = wrap(r.sum, font, 7.5, D.sumW).slice(0, 3);
    const ol = wrap(r.open, font, 7, D.openW);
    const h = Math.max(al.length * 11, sl.length * 9.5, ol.length * 9) + 12;
    const mid = y - h / 2;
    dot(page, r.s === 'n' ? 'n' : r.s, D.dot, mid, 6);
    al.forEach(function (l, k) { text(page, l, D.area, mid + (al.length - 1) * 5.5 - 3 - k * 11, { size: 8.5, bold: true }); });
    sl.forEach(function (l, k) { text(page, l, D.sum, mid + (sl.length - 1) * 4.75 - 2.5 - k * 9.5, { size: 7.5 }); });
    ol.forEach(function (l, k) { text(page, l, D.open, mid + (ol.length - 1) * 4.5 - 2.5 - k * 9, { size: 7, color: 'muted' }); });
    text(page, r.pg, W - M - font.widthOfTextAtSize(r.pg, 7.5), mid - 2.5, { size: 7.5, color: 'muted' });
    y -= h; hline(page, y);
  });
  y -= 12;
  let lx = M;
  [['g', 'Green: compliant, nothing due in 30 days'], ['y', final ? 'Yellow: due within 30 days' : 'Yellow: still due this month, or due within 30 days'], ['r', 'Red: No, missing, overdue, or flagged'], ['m', 'Open circle: a person still answers it']].forEach(function (l) {
    if (lx + font.widthOfTextAtSize(l[1], 7) + 12 > W - M) { lx = M; y -= 12; }
    dot(page, l[0], lx + 4, y + 2.5, 3.5);
    text(page, l[1], lx + 11, y, { size: 7, color: 'muted' });
    lx += font.widthOfTextAtSize(l[1], 7) + 24;
  });
  y -= 14;
  text(page, 'Each area shows its worst item. Items a person still has to answer don’t change the light. Interview and questionnaire concerns count only when the liaison flags them.', M, y, { size: 7, color: 'muted' });

  // ---- Footers ----
  const pages = doc.getPages();
  pages.forEach(function (pg, i) {
    const f = report.form + ' · ' + report.location + ' · ' + report.monthLabel + ' · ' + modeText + ' · Page ' + (i + 1) + ' of ' + pages.length;
    pg.drawText(clean(f), { x: W / 2 - font.widthOfTextAtSize(clean(f), 7) / 2, y: 22, size: 7, font: font, color: C('muted') });
  });
  return doc.save();
}

function reportFilename(report) {
  return 'ASRS-520-03 ' + report.location + ' ' + report.month + (report.mode === 'final' ? ' Final' : ' Preview ' + report.asOf) + '.pdf';
}

module.exports = { buildLocationReportPdf, reportFilename };
