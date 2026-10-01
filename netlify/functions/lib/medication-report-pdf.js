const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const logoBase64 = require('./arch-support-logo');

// Landscape letter — a day-by-day grid for a full month (up to 31
// columns) needs the extra width a portrait page doesn't have, the same
// reason a printed paper MAR chart is usually landscape.
const PAGE_WIDTH = 792; // 11in @ 72dpi
const PAGE_HEIGHT = 612; // 8.5in
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LOGO_MAX = 42;
const LABEL_WIDTH = 190;
const ROW_HEIGHT = 15;

function pad2(n) { return String(n).padStart(2, '0'); }

function daysInMonth(yearMonth) {
  const parts = yearMonth.split('-').map(Number);
  return new Date(parts[0], parts[1], 0).getDate();
}

function monthLabel(yearMonth) {
  const parts = yearMonth.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// "September 2026" for a full-month report; "Sep 10 – Sep 20, 2026" for
// a partial (ad hoc) one — printed right on the PDF so a partial report
// is never mistaken for covering the whole month at a glance.
function rangeLabel(yearMonth, startDay, endDay, totalDays) {
  if (startDay === 1 && endDay === totalDays) return monthLabel(yearMonth);
  const parts = yearMonth.split('-').map(Number);
  function fmt(day) {
    return new Date(parts[0], parts[1] - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return fmt(startDay) + ' – ' + fmt(endDay) + ', ' + parts[0];
}

// "Ovetis Cooper" -> "OC" (first + last initial), matching the
// initials-in-a-cell style of the Therap MAR report this is modeled on.
// A single-word name just takes its first two letters, since there's no
// second word to draw a last initial from.
function initialsFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Renders one resident's full month as a grid: one block per scheduled
// medication/time-of-day pair, a day-number header row, and one row of
// day cells. Cell meaning:
//   - blank/white: the medication wasn't in effect that day (before its
//     Effective Date or on/after its Termination Date) — nothing was
//     expected here, so nothing is flagged.
//   - initials, plain: Given.
//   - initials in a red circle: Refused.
//   - initials in an amber circle: Held.
//   - solid grey, no initials: expected but never logged at all — the
//     one state meant to visually stand out as a real gap.
// PRN (as-needed) doses have no fixed schedule to grid against, so
// they're listed separately below as a simple dated list instead.
async function buildMedicationReportPdf(data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await doc.embedJpg(Buffer.from(logoBase64, 'base64'));

  const totalDays = daysInMonth(data.yearMonth);
  const startDay = data.startDay || 1;
  const endDay = data.endDay || totalDays;
  const rangeDays = endDay - startDay + 1;
  const dayColWidth = (CONTENT_WIDTH - LABEL_WIDTH) / rangeDays;
  const logoScale = Math.min(LOGO_MAX / logoImage.width, LOGO_MAX / logoImage.height);
  const logoWidth = logoImage.width * logoScale;
  const logoHeight = logoImage.height * logoScale;

  let page;
  let y;

  function drawPageHeader() {
    page.drawImage(logoImage, {
      x: PAGE_WIDTH - MARGIN - logoWidth,
      y: PAGE_HEIGHT - MARGIN - logoHeight + 6,
      width: logoWidth,
      height: logoHeight
    });
    page.drawText('Medication Administration Report', { x: MARGIN, y: y - 14, size: 14, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(
      data.residentFullName + ' (' + data.residentInitials + ')  ·  ' + data.location + '  ·  ' + rangeLabel(data.yearMonth, startDay, endDay, totalDays),
      { x: MARGIN, y: y - 30, size: 10, font: font, color: rgb(0.25, 0.25, 0.25) }
    );
    y -= 44;
  }

  function addPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawPageHeader();
  }

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN) addPage();
  }

  addPage();

  function dayColX(d) { return MARGIN + LABEL_WIDTH + (d - startDay) * dayColWidth; }

  function drawDayHeaderRow(topY) {
    page.drawRectangle({ x: MARGIN, y: topY - ROW_HEIGHT, width: LABEL_WIDTH, height: ROW_HEIGHT, borderColor: rgb(0.65, 0.65, 0.65), borderWidth: 0.5 });
    for (let d = startDay; d <= endDay; d++) {
      const cx = dayColX(d);
      page.drawRectangle({ x: cx, y: topY - ROW_HEIGHT, width: dayColWidth, height: ROW_HEIGHT, borderColor: rgb(0.65, 0.65, 0.65), borderWidth: 0.5 });
      const label = String(d);
      const textWidth = boldFont.widthOfTextAtSize(label, 6.5);
      page.drawText(label, { x: cx + dayColWidth / 2 - textWidth / 2, y: topY - 10.5, size: 6.5, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
    }
  }

  function drawCell(cx, topY, cell) {
    page.drawRectangle({ x: cx, y: topY - ROW_HEIGHT, width: dayColWidth, height: ROW_HEIGHT, borderColor: rgb(0.82, 0.82, 0.82), borderWidth: 0.5 });
    if (!cell || cell.status === 'not-applicable') return;

    if (cell.status === 'missing') {
      page.drawRectangle({
        x: cx + 0.5, y: topY - ROW_HEIGHT + 0.5, width: dayColWidth - 1, height: ROW_HEIGHT - 1,
        color: rgb(0.76, 0.76, 0.76)
      });
      return;
    }

    if (cell.status === 'refused' || cell.status === 'held') {
      const markColor = cell.status === 'refused' ? rgb(0.74, 0.12, 0.12) : rgb(0.8, 0.58, 0.04);
      page.drawEllipse({
        x: cx + dayColWidth / 2, y: topY - ROW_HEIGHT / 2,
        xScale: dayColWidth / 2 - 1.5, yScale: ROW_HEIGHT / 2 - 1.5,
        borderColor: markColor, borderWidth: 1
      });
    }

    const label = initialsFromName(cell.givenBy);
    const textWidth = font.widthOfTextAtSize(label, 6.5);
    page.drawText(label, {
      x: cx + dayColWidth / 2 - textWidth / 2,
      y: topY - ROW_HEIGHT / 2 - 2.3,
      size: 6.5, font: font, color: rgb(0, 0, 0)
    });
  }

  // Both drawDayHeaderRow and drawCell take `topY` meaning the row's top
  // edge, drawing their boxes spanning [topY-ROW_HEIGHT, topY] — so the
  // header row is drawn at the current y, then y steps down by one row
  // height BEFORE the data cells are drawn, so the two rows land stacked
  // rather than on top of each other.
  function drawMedicationBlock(row) {
    newPageIfNeeded(ROW_HEIGHT * 2 + 16);
    page.drawText(row.itemName + (row.dosage ? ' — ' + row.dosage : ''), { x: MARGIN, y: y - 9, size: 9, font: boldFont, color: rgb(0, 0, 0) });
    y -= 13;
    drawDayHeaderRow(y);
    y -= ROW_HEIGHT;
    for (let d = startDay; d <= endDay; d++) {
      drawCell(dayColX(d), y, row.cellsByDay[d]);
    }
    page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT, width: LABEL_WIDTH, height: ROW_HEIGHT, borderColor: rgb(0.65, 0.65, 0.65), borderWidth: 0.5 });
    page.drawText(row.slot, { x: MARGIN + 5, y: y - ROW_HEIGHT / 2 - 3, size: 7.5, font: font, color: rgb(0, 0, 0) });
    y -= ROW_HEIGHT + 9;
  }

  (data.medicationRows || []).forEach(drawMedicationBlock);
  if (!(data.medicationRows || []).length) {
    page.drawText('No scheduled medications with a Time of Day set were on file this month.', { x: MARGIN, y: y - 4, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
    y -= 20;
  }

  newPageIfNeeded(16);
  page.drawText('Legend:  initials = given   ·   red circle = refused   ·   amber circle = held   ·   solid grey = never logged', {
    x: MARGIN, y: y - 2, size: 7.5, font: font, color: rgb(0.35, 0.35, 0.35)
  });
  y -= 24;

  const prnLogs = data.prnLogs || [];
  if (prnLogs.length) {
    newPageIfNeeded(18);
    page.drawText('As-Needed (PRN) Doses', { x: MARGIN, y: y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    y -= 16;
    prnLogs.forEach(function (log) {
      newPageIfNeeded(13);
      const line = log.date + '   ' + log.itemName + '   ' + initialsFromName(log.givenBy) + '   ' + (log.reason || '');
      page.drawText(line, { x: MARGIN, y: y, size: 8, font: font, color: rgb(0.1, 0.1, 0.1) });
      y -= 13;
    });
  }

  return doc.save();
}

module.exports = { buildMedicationReportPdf, initialsFromName, daysInMonth, monthLabel };
