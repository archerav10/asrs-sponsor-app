const {
  findUnrenderedSignedCovers,
  findQuestionsForDate,
  findAnswers,
  markPdfGenerated
} = require('./lib/daily-progress-notes');
const { buildDailyProgressNotePdf } = require('./lib/daily-progress-note-pdf');

const WEBHOOK_URL = process.env.ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL;

function sanitizeForFilename(s) {
  return (s || '').replace(/[^a-zA-Z0-9]+/g, '');
}

// Scheduled (see netlify.toml) — runs every morning. Finds every signed
// Daily Progress Note that hasn't had a PDF generated yet, renders one,
// and hands it to the same Zapier Catch Hook -> Find/Create Folder ->
// Upload File pattern every other document upload in this app uses to
// land in Google Drive. Marks PDF Generated only after a successful
// upload, so a failed upload leaves the cover to retry the next night
// rather than silently getting skipped forever.
exports.handler = async function () {
  if (!WEBHOOK_URL) {
    console.error('ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL is not configured; skipping PDF generation.');
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  const covers = await findUnrenderedSignedCovers();
  let generated = 0;
  const errors = [];

  for (const cover of covers) {
    try {
      const questions = await findQuestionsForDate(cover.location, cover.residentInitials, cover.date);
      const answersByKey = await findAnswers(cover.location, cover.residentInitials, cover.date);

      const mergedQuestions = questions.map(function (q) {
        const answer = answersByKey[q.key];
        return {
          text: q.text,
          type: q.type,
          checklistItems: q.checklistItems,
          answerText: answer ? answer.answerText : '',
          checklistAnswers: answer ? answer.checklistAnswers : {}
        };
      });

      let signatureStrokes = [];
      try { signatureStrokes = JSON.parse(cover.signatureStrokes || '[]'); } catch (e) { signatureStrokes = []; }

      const pdfBytes = await buildDailyProgressNotePdf({
        resident: cover.residentInitials,
        residentFullName: cover.residentFullName,
        location: cover.location,
        date: cover.date,
        questions: mergedQuestions,
        signedBy: cover.signedBy,
        signedAt: cover.signedAt,
        signatureStrokes: signatureStrokes
      });

      const filename = 'DailyProgressNote_' + sanitizeForFilename(cover.location) + '_' +
        sanitizeForFilename(cover.residentInitials) + '_' + cover.date + '.pdf';

      const formData = new FormData();
      formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
      formData.append('location', cover.location);
      formData.append('residentInitials', cover.residentInitials);
      formData.append('date', cover.date);
      formData.append('filename', filename);

      const uploadRes = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        throw new Error('Upload webhook returned ' + uploadRes.status);
      }

      await markPdfGenerated(cover.id);
      generated++;
    } catch (err) {
      console.error('Failed to generate/upload PDF for cover ' + cover.id, err);
      errors.push({ coverId: cover.id, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ found: covers.length, generated: generated, errors: errors }) };
};
