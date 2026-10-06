const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const logoBase64 = require('./arch-support-logo');

const PAGE_WIDTH = 612; // 8.5in @ 72dpi
const PAGE_HEIGHT = 792; // 11in @ 72dpi
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LOGO_MAX_WIDTH = 70;
const LOGO_MAX_HEIGHT = 70;

function wrapText(text, font, size, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach(function (word) {
    const candidate = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// Renders one Daily Progress Note as a PDF: the required header fields
// (resident name, location, "DailyProgressNote", the date the note was
// entered for), every question and its answer, and the signature —
// replayed as vector line-drawing from the raw pen-stroke points rather
// than an image, since this app has no way to read an image back out of
// Google Drive once it's uploaded (see lib/daily-progress-notes.js).
async function buildDailyProgressNotePdf(data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await doc.embedJpg(Buffer.from(logoBase64, 'base64'));

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  // Scaled down to fit within LOGO_MAX_WIDTH/HEIGHT while keeping its
  // aspect ratio, anchored top-right of the first page only.
  const logoScale = Math.min(LOGO_MAX_WIDTH / logoImage.width, LOGO_MAX_HEIGHT / logoImage.height);
  const logoWidth = logoImage.width * logoScale;
  const logoHeight = logoImage.height * logoScale;
  page.drawImage(logoImage, {
    x: PAGE_WIDTH - MARGIN - logoWidth,
    y: PAGE_HEIGHT - MARGIN - logoHeight + 10,
    width: logoWidth,
    height: logoHeight
  });

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawLine(text, options) {
    options = options || {};
    const size = options.size || 11;
    const useFont = options.bold ? boldFont : font;
    const lines = wrapText(text, useFont, size, options.maxWidth || CONTENT_WIDTH);
    lines.forEach(function (line) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x: MARGIN, y: y - size, size: size, font: useFont, color: rgb(0, 0, 0) });
      y -= size + 4;
    });
  }

  // Narrower than CONTENT_WIDTH so a long resident name, location, or
  // date string wraps before it reaches under the logo, rather than
  // running text directly beneath/behind it. Only matters for these
  // first few header lines — everything below sits under the logo's
  // bottom edge regardless of width.
  const headerMaxWidth = CONTENT_WIDTH - logoWidth - 10;

  drawLine('DailyProgressNote', { size: 18, bold: true, maxWidth: headerMaxWidth });
  y -= 4;
  drawLine('Resident: ' + data.residentFullName + ' (' + data.resident + ')', { size: 12, bold: true, maxWidth: headerMaxWidth });
  drawLine('Location: ' + data.location, { size: 12, bold: true, maxWidth: headerMaxWidth });
  drawLine('Date: ' + data.date, { size: 12, bold: true, maxWidth: headerMaxWidth });
  if (data.timesCovered) {
    drawLine('Times Covered: ' + data.timesCovered, { size: 12, bold: true, maxWidth: headerMaxWidth });
  }
  y -= 10;

  data.questions.forEach(function (q, index) {
    newPageIfNeeded(20);
    drawLine((index + 1) + '. ' + q.text, { size: 11, bold: true });
    if (q.type === 'Checklist') {
      const items = q.checklistItems || [];
      items.forEach(function (item) {
        const value = (q.checklistAnswers && q.checklistAnswers[item]) || '—';
        drawLine('   • ' + item + ': ' + value, { size: 10 });
      });
    } else {
      drawLine(q.answerText || '—', { size: 10 });
    }
    y -= 8;
  });

  y -= 10;
  newPageIfNeeded(110);
  if (data.enteredBy) {
    drawLine('Entered by: ' + data.enteredBy, { size: 11, bold: true });
  }
  drawLine('Signed by: ' + data.signedBy, { size: 11, bold: true });
  y -= 6;

  const sigBoxHeight = 70;
  newPageIfNeeded(sigBoxHeight + 10);
  const sigBoxY = y - sigBoxHeight;
  page.drawRectangle({
    x: MARGIN, y: sigBoxY, width: CONTENT_WIDTH, height: sigBoxHeight,
    borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1
  });

  const strokes = data.signatureStrokes || [];
  if (strokes.length) {
    const xs = [];
    const ys = [];
    strokes.forEach(function (stroke) {
      (stroke || []).forEach(function (pt) { xs.push(pt.x); ys.push(pt.y); });
    });
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    const sourceWidth = Math.max(maxX - minX, 1);
    const sourceHeight = Math.max(maxY - minY, 1);
    const padding = 8;
    const scale = Math.min(
      (CONTENT_WIDTH - padding * 2) / sourceWidth,
      (sigBoxHeight - padding * 2) / sourceHeight
    );

    function toPdfPoint(pt) {
      return {
        x: MARGIN + padding + (pt.x - minX) * scale,
        y: sigBoxY + sigBoxHeight - padding - (pt.y - minY) * scale
      };
    }

    strokes.forEach(function (stroke) {
      for (let i = 1; i < (stroke || []).length; i++) {
        const from = toPdfPoint(stroke[i - 1]);
        const to = toPdfPoint(stroke[i]);
        page.drawLine({ start: from, end: to, thickness: 1.5, color: rgb(0, 0, 0.4) });
      }
    });
  }

  y = sigBoxY - 14;

  return doc.save();
}

module.exports = { buildDailyProgressNotePdf };
