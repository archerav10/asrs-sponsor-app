const { getPlainText } = require('./notion');

// Monthly medication storage check, asked at the end of each resident's
// MAR Review. Answers live on that resident's MAR Review Periods row:
//   - "Checks Draft" holds the working copy while the review is in
//     progress, tagged with the period it belongs to, so a new period
//     starts blank without wiping anything.
//   - The readable "Check ..." columns are written only at finalize, so
//     they always show the last finalized answers (the current status the
//     Monthly Location Compliance Report reads).
// `na` is the wording of the N/A choice; items without it are Yes/No only.
const CHECKS = [
  { key: 'medsLocked', property: 'Check Meds Locked', label: 'Medications are locked, keys are controlled, and the storage temperature is OK' },
  { key: 'controlledCounts', property: 'Check Controlled Counts', label: 'Controlled substance counts are done and match', na: 'None prescribed' },
  { key: 'expiredDisposed', property: 'Check Expired Disposed', label: 'Expired or discontinued medications are removed and disposed of properly', na: 'None this month' },
  { key: 'refusalsDocumented', property: 'Check Refusals Documented', label: 'Refusals, PRNs and any medication errors are written down, and errors were reported' },
  { key: 'otcAuthorized', property: 'Check OTC Authorized', label: 'Over-the-counter medications have a written doctor’s authorization', na: 'None in use' }
];

const VALUES = ['Yes', 'No', 'N/A'];

function cleanAnswers(raw) {
  const out = {};
  raw = raw || {};
  CHECKS.forEach(function (c) {
    const v = raw[c.key];
    if (v === 'Yes' || v === 'No' || (v === 'N/A' && c.na)) out[c.key] = v;
  });
  return out;
}

function readFinalized(page) {
  const answers = {};
  if (page) {
    CHECKS.forEach(function (c) {
      const v = getPlainText(page.properties[c.property]);
      if (VALUES.indexOf(v) !== -1) answers[c.key] = v;
    });
  }
  return { answers: answers, notes: page ? getPlainText(page.properties['Check Notes']) : '' };
}

function readDraft(page, targetPeriod) {
  const raw = page ? getPlainText(page.properties['Checks Draft']) : '';
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d.period !== targetPeriod) return null;
    return { answers: cleanAnswers(d.answers), notes: typeof d.notes === 'string' ? d.notes : '' };
  } catch (e) {
    return null;
  }
}

// What the review screen should show for the period being worked on:
// the draft for this period if there is one; a blank form for a new
// period; the finalized answers once this period is finalized (or while
// the window is closed and the screen is read-only).
function forScreen(page, windowState, lastFinalizedPeriod) {
  const finalized = readFinalized(page);
  const showFinalized = !windowState.isWindowOpen || lastFinalizedPeriod === windowState.targetPeriod;
  const current = showFinalized ? finalized : (readDraft(page, windowState.targetPeriod) || { answers: {}, notes: '' });
  return {
    items: CHECKS.map(function (c) { return { key: c.key, label: c.label, na: c.na || '' }; }),
    answers: current.answers,
    notes: current.notes
  };
}

function draftProperties(targetPeriod, answers, notes) {
  const json = JSON.stringify({ period: targetPeriod, answers: cleanAnswers(answers), notes: (notes || '').slice(0, 1500) });
  return { 'Checks Draft': { rich_text: [{ text: { content: json } }] } };
}

// Every item answered; any No needs a note saying what's being done.
function missingForFinalize(answers, notes) {
  const clean = cleanAnswers(answers);
  const problems = [];
  const unanswered = CHECKS.filter(function (c) { return !clean[c.key]; });
  if (unanswered.length) problems.push(unanswered.length + ' storage check item' + (unanswered.length === 1 ? '' : 's') + ' not answered');
  const anyNo = CHECKS.some(function (c) { return clean[c.key] === 'No'; });
  if (anyNo && !(notes || '').trim()) problems.push('a storage check note explaining each No');
  return problems;
}

function finalizedProperties(targetPeriod, answers, notes) {
  const clean = cleanAnswers(answers);
  const props = draftProperties(targetPeriod, clean, notes);
  CHECKS.forEach(function (c) { props[c.property] = { select: { name: clean[c.key] } }; });
  props['Check Notes'] = { rich_text: notes ? [{ text: { content: notes.slice(0, 1900) } }] : [] };
  return props;
}

module.exports = { CHECKS, cleanAnswers, readFinalized, readDraft, forScreen, draftProperties, missingForFinalize, finalizedProperties };
