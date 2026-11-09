const qn = require('./lib/questionnaires');
const lz = require('./lib/liaison');
const { updatePage, getPlainText } = require('./lib/notion');

// Zapier-facing, from the "ASRS Questionnaires" workflow after a Jotform
// submission: { tracking, formId, formTitle, submissionId, submittedAt,
// answers: [{ question, answer }] }. The signed tracking value (made by
// liaison-questionnaire-link) is the credential: without it nothing is
// recorded. Records the response once per submission, then files a PDF
// in Drive:
//   Resident interview  Facility Reporting/{Location}/Residents/{Full Name}/Resident Interviews
//                       (Liaison Visits/Questionnaires when the resident has no full name on file)
//   Sponsor / DSP       Facility Reporting/{Location}/Liaison Visits/Questionnaires
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.submissionId) return { statusCode: 400, body: JSON.stringify({ error: 'submissionId is required.' }) };

    let rawAnswers = body.answers;
    if (typeof rawAnswers === 'string') { try { rawAnswers = JSON.parse(rawAnswers); } catch (e) { rawAnswers = []; } }
    const answers = (Array.isArray(rawAnswers) ? rawAnswers : []).slice(0, 200).map(function (a) {
      return { question: String(a.question || '').slice(0, 500), answer: String(a.answer == null ? '' : a.answer).slice(0, 3000) };
    }).filter(function (a) { return a.question && !/^app_?tracking$/i.test(a.question); });

    // The signed value from the form's hidden field; failing that, the
    // link the app opened for this form (see questionnaires.findOpened).
    let payload = qn.verifyTracking(body.tracking);
    let opened = null;
    if (!payload) {
      opened = await qn.findOpened(body.formId, answers);
      if (opened) payload = opened.payload;
    }
    if (!payload) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not from the Liaison app' }) };

    const existing = await qn.responseBySubmission(body.submissionId);
    if (existing) return { statusCode: 200, body: JSON.stringify({ success: true, duplicate: true }) };
    const info = { formId: String(body.formId || ''), formTitle: String(body.formTitle || ''), submissionId: String(body.submissionId), submittedAt: body.submittedAt || new Date().toISOString(), answers: answers };
    const page = await qn.createResponse(payload, info);
    const openedPage = opened ? opened.page : await qn.openedByTracking(body.tracking).catch(function () { return null; });
    if (openedPage) await qn.markOpenedUsed(openedPage.id).catch(function () {});

    let folders = [{ name: payload.l, create: false }, { name: 'Liaison Visits', create: true }, { name: 'Questionnaires', create: true }];
    if (payload.a === 'Resident' && payload.r) {
      const fullName = await require('./lib/medical-appointments').residentFullNameFor(payload.l, payload.r).catch(function () { return ''; });
      if (fullName) folders = [{ name: payload.l, create: false }, { name: 'Residents', create: false }, { name: fullName, create: false }, { name: 'Resident Interviews', create: true }];
    }
    const what = payload.a === 'Resident' ? 'ResidentInterview' : payload.a + 'Questionnaire';
    const filename = String(info.submittedAt).slice(0, 10) + '_' + lz.safePart(payload.l) + '_' + (payload.r ? lz.safePart(payload.r) + '_' : '') + what + '.pdf';
    try {
      const pdf = await qn.buildResponsePdf(payload, info);
      await lz.sendForFiling(pdf, lz.filingTicket('questionnaire', page.id, payload.l, folders, filename), filename, process.env.URL);
    } catch (e) {
      console.error('Questionnaire PDF filing failed', e);
      await updatePage(page.id, { 'PDF Status': { select: { name: 'Failed' } } });
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
