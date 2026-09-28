const { queryDatabase, updatePage, createPage, getPlainText } = require('./notion');

const QUESTIONS_DB_ID = process.env.DAILY_PROGRESS_NOTE_QUESTIONS_DB_ID;
const NOTES_DB_ID = process.env.DAILY_PROGRESS_NOTES_DB_ID;
const ANSWERS_DB_ID = process.env.DAILY_PROGRESS_NOTE_ANSWERS_DB_ID;

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dateToDate(dateStr) { return new Date(dateStr + 'T00:00:00'); }
function addDaysISO(dateStr, days) {
  const d = dateToDate(dateStr);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Notion caps a single rich_text block at 2000 characters — splits
// longer content (signature stroke JSON especially, but also a long
// dictated answer) across multiple blocks in the same array. Reading it
// back needs no special handling: getPlainText already joins every
// rich_text array element's plain_text into one string.
function chunkRichText(content) {
  content = content || '';
  const CHUNK_SIZE = 2000;
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push({ text: { content: content.slice(i, i + CHUNK_SIZE) } });
  }
  return chunks;
}

function questionFromPage(page) {
  return {
    id: page.id,
    effectiveDate: getPlainText(page.properties['Effective Date']),
    terminationDate: getPlainText(page.properties['Termination Date']),
    residentFullName: getPlainText(page.properties['Resident Full Name']),
    key: getPlainText(page.properties['Question Key']),
    text: getPlainText(page.properties['Question Text']),
    type: getPlainText(page.properties['Question Type']),
    checklistItems: (getPlainText(page.properties['Checklist Items']) || '')
      .split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
    order: page.properties['Order'].number || 0
  };
}

// Every active question row on file for this resident, across every
// version ever created — used both to resolve "what applied on date X"
// and by the admin template-management screen to show version history.
async function findAllQuestionRows(location, resident) {
  const result = await queryDatabase(QUESTIONS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(questionFromPage);
}

// Every resident who has at least one question template on file at this
// location — drives the admin template-management screen's resident
// picker without needing a separate "residents" database to query.
async function findResidentsForLocation(location) {
  const result = await queryDatabase(QUESTIONS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const seen = {};
  (result.results || []).forEach(function (page) {
    const resident = getPlainText(page.properties['Resident Initials']);
    if (resident) seen[resident] = true;
  });
  return Object.keys(seen).sort();
}

// Every version ever created for this resident, oldest first — each
// version is one Effective Date's worth of question rows. Used by the
// admin template-management screen to show version history and by
// createVersion to find whichever version is currently open-ended (no
// Termination Date yet) so it can be closed off.
async function listVersions(location, resident) {
  const all = await findAllQuestionRows(location, resident);
  const byEffectiveDate = {};
  all.forEach(function (q) {
    if (!byEffectiveDate[q.effectiveDate]) byEffectiveDate[q.effectiveDate] = [];
    byEffectiveDate[q.effectiveDate].push(q);
  });
  return Object.keys(byEffectiveDate).sort().map(function (effDate) {
    const questions = byEffectiveDate[effDate].sort(function (a, b) { return a.order - b.order; });
    return {
      effectiveDate: effDate,
      terminationDate: questions[0].terminationDate,
      questions: questions
    };
  });
}

// Starts a new version of the question set effective on effectiveDate,
// terminating whatever version is currently open-ended (if any) as of
// that same date — the terminated version stays on file untouched
// (Active never flips false; only its Termination Date is set), so every
// past answer that snapshotted its own question text/type still resolves
// against the version it was actually answered under.
//
// A Termination Date, wherever it comes from (passed in here, or set
// later when a successor version is published), is the FIRST date the
// version no longer applies — a half-open [effectiveDate, terminationDate)
// window, matching findQuestionsForDate's `terminationDate > date` check.
// So a version meant to be valid through, say, Oct 31 2026 inclusive
// needs a Termination Date of Nov 1 2026, one day past its last valid day.
//
// questions: [{ text, type: 'Text'|'Checklist', checklistItems?: string[] }]
// terminationDate is optional — when given, the new version is fixed-
// duration from publication (useful for a template whose expiration is
// already known, like an annual renewal); when omitted, it stays open-
// ended until a future version's publish auto-terminates it.
async function createVersion(location, resident, residentFullName, effectiveDate, questions, terminationDate) {
  const versions = await listVersions(location, resident);
  const openVersion = versions.find(function (v) { return !v.terminationDate; });

  if (terminationDate && terminationDate <= effectiveDate) {
    const err = new Error('The termination date must be after the effective date.');
    err.statusCode = 400;
    throw err;
  }

  if (openVersion) {
    if (effectiveDate <= openVersion.effectiveDate) {
      const err = new Error('The new version’s effective date must be after the current version’s (' + openVersion.effectiveDate + ').');
      err.statusCode = 400;
      throw err;
    }
    for (const q of openVersion.questions) {
      await updatePage(q.id, { 'Termination Date': { date: { start: effectiveDate } } });
    }
  }

  let order = 1;
  for (const q of questions) {
    const key = 'q' + order;
    await createPage(QUESTIONS_DB_ID, {
      'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + effectiveDate + ' - ' + key } }] },
      'Location': { select: { name: location } },
      'Resident Initials': { rich_text: [{ text: { content: resident } }] },
      'Resident Full Name': { rich_text: [{ text: { content: residentFullName } }] },
      'Effective Date': { date: { start: effectiveDate } },
      'Termination Date': terminationDate ? { date: { start: terminationDate } } : { date: null },
      'Question Key': { rich_text: [{ text: { content: key } }] },
      'Question Text': { rich_text: [{ text: { content: q.text } }] },
      'Question Type': { select: { name: q.type } },
      'Checklist Items': { rich_text: [{ text: { content: (q.checklistItems || []).join('\n') } }] },
      'Order': { number: order },
      'Active': { checkbox: true }
    });
    order++;
  }
}

// Which version of the question set was actually in effect on a given
// date — the LATEST version whose Effective Date is on or before that
// date and whose Termination Date (if any) is after it. Deliberately
// resolved per-date rather than always using "today's" version: a
// resident catching up on a day from before the question set changed
// must answer the wording that was actually in effect then, not
// whatever's active now — otherwise historical notes get silently
// reinterpreted against different questions.
async function findQuestionsForDate(location, resident, date) {
  const all = await findAllQuestionRows(location, resident);
  const byEffectiveDate = {};
  all.forEach(function (q) {
    if (!byEffectiveDate[q.effectiveDate]) byEffectiveDate[q.effectiveDate] = [];
    byEffectiveDate[q.effectiveDate].push(q);
  });

  const candidateDates = Object.keys(byEffectiveDate)
    .filter(function (effDate) { return effDate <= date; })
    .sort().reverse();

  for (const effDate of candidateDates) {
    const group = byEffectiveDate[effDate];
    const terminationDate = group[0].terminationDate;
    if (!terminationDate || terminationDate > date) {
      return group.sort(function (a, b) { return a.order - b.order; });
    }
  }
  return [];
}

function coverFromPage(page) {
  if (!page) return null;
  return {
    id: page.id,
    location: getPlainText(page.properties['Location']),
    residentInitials: getPlainText(page.properties['Resident Initials']),
    date: getPlainText(page.properties['Date']),
    residentFullName: getPlainText(page.properties['Resident Full Name']),
    templateEffectiveDate: getPlainText(page.properties['Template Effective Date']),
    enteredBy: getPlainText(page.properties['Entered By']),
    signedBy: getPlainText(page.properties['Signed By']),
    signedAt: getPlainText(page.properties['Signed At']),
    signatureStrokes: getPlainText(page.properties['Signature Strokes']),
    pdfGenerated: !!page.properties['PDF Generated'].checkbox,
    pdfDriveUrl: getPlainText(page.properties['PDF Drive URL'])
  };
}

async function findCover(location, resident, date) {
  const result = await queryDatabase(NOTES_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Date', date: { equals: date } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return coverFromPage((result.results || [])[0]);
}

// Every cover row on file for this resident, most recent date first —
// used to find the earliest not-yet-signed day to walk forward from.
async function findAllCovers(location, resident) {
  const result = await queryDatabase(NOTES_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || [])
    .map(coverFromPage)
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// Every signed cover across every location/resident that hasn't had its
// PDF generated yet — what the nightly job works through. No Location
// filter here since this runs once for the whole workspace, not per
// location.
async function findUnrenderedSignedCovers() {
  const result = await queryDatabase(NOTES_DB_ID, {
    and: [
      { property: 'Active', checkbox: { equals: true } },
      { property: 'PDF Generated', checkbox: { equals: false } },
      { property: 'Signed At', date: { is_not_empty: true } }
    ]
  });
  return (result.results || []).map(coverFromPage);
}

async function markPdfGenerated(coverId, driveUrl) {
  const props = { 'PDF Generated': { checkbox: true } };
  if (driveUrl) props['PDF Drive URL'] = { url: driveUrl };
  await updatePage(coverId, props);
}

// Every day from the earliest cover on file through today, paired with
// whatever cover (if any) exists for it — the shared walk both
// resolveTarget and findOutstandingDays are built on. Nothing on file
// yet means there's nothing to catch up on, so the only day in range is
// today itself.
function walkAllDays(covers, today) {
  if (!covers.length) {
    return [{ date: today, cover: null }];
  }
  const byDate = {};
  covers.forEach(function (c) { byDate[c.date] = c; });

  const days = [];
  let cursor = covers[0].date;
  while (cursor <= today) {
    days.push({ date: cursor, cover: byDate[cursor] || null });
    cursor = addDaysISO(cursor, 1);
  }
  return days;
}

// Fetches the covers once and does the day-by-day walk — the single
// query both resolveTarget and findOutstandingDays are built on, and
// that endpoints needing both the outstanding list AND a specific day's
// cover (get-daily-progress-note.js) can call directly instead of
// querying Notion a second time for a cover this walk already fetched.
// isFirstEntry (no cover at all yet) is surfaced separately so callers
// can offer the one-time "pick your very first day" flow instead of the
// ongoing day-by-day catch-up walk — see resolveDayOptions.
async function getResidentDayWalk(location, resident, now) {
  now = now || new Date();
  const today = isoDate(now);
  const covers = await findAllCovers(location, resident);
  return { isFirstEntry: !covers.length, days: walkAllDays(covers, today) };
}

// Resolves which day this resident should be nudged toward next: the
// EARLIEST day, from the earliest one they have any note for through
// today, that isn't signed yet (mirrors resolveTarget in
// lib/monthly-checklist.js) so a day that was started, or even never
// touched at all, but never signed stays the target instead of silently
// getting stepped over. This is what enforces "can't skip a day" at the
// floor — the server never lets a save/sign land on a day that isn't
// itself unsigned (see findOutstandingDays for the full set of days
// that's true for, since the provider app now lets someone pick among
// more than just this single earliest one).
async function resolveTarget(location, resident, now) {
  const { days } = await getResidentDayWalk(location, resident, now);
  const firstUnsigned = days.find(function (d) { return !d.cover || !d.cover.signedAt; });
  if (firstUnsigned) {
    return { targetDate: firstUnsigned.date, cover: firstUnsigned.cover };
  }
  const last = days[days.length - 1];
  return { targetDate: last.date, cover: last.cover };
}

// Every day, oldest first, that's still fair game to enter/sign a note
// for — every unsigned day from the earliest one on file through today,
// not just the single earliest one resolveTarget nudges toward. Lets
// the provider app offer a picker among these (e.g. sign today's note
// first, then circle back to one from last week) while still refusing,
// server-side, anything that isn't actually on this list — an already-
// signed day or any date past today.
async function findOutstandingDays(location, resident, now) {
  const { days } = await getResidentDayWalk(location, resident, now);
  return days
    .filter(function (d) { return !d.cover || !d.cover.signedAt; })
    .map(function (d) { return d.date; });
}

// The earliest Effective Date across every version ever published for
// this resident — null if none have been. Used to bound the one-time
// "pick your very first day" range below: someone rolling this out
// today for a resident whose template took effect months ago should be
// able to start on, say, yesterday (their normal "enter it the next
// morning" workflow) rather than being forced onto literally today, but
// still can't reach further back than the questionnaire actually
// existed.
async function findEarliestEffectiveDate(location, resident) {
  const versions = await listVersions(location, resident);
  return versions.length ? versions[0].effectiveDate : null;
}

// The single shared "what day(s) can this request act on" resolution
// used by get/save/sign-daily-progress-note.js. Two regimes:
//   - isFirstEntry: no cover exists for this resident yet at all. There's
//     no fixed list to pick from — instead, ANY date from the
//     questionnaire's earliest Effective Date through today is a valid
//     choice for the very first entry (bounded below by
//     initialDateMin, above by initialDateMax/today). Once that first
//     save actually happens, a cover exists and every future call falls
//     into the ordinary regime below.
//   - ordinary: outstandingDates lists every currently unsigned day,
//     oldest first, exactly as findOutstandingDays does.
async function resolveDayOptions(location, resident, now) {
  now = now || new Date();
  const today = isoDate(now);
  const { isFirstEntry, days } = await getResidentDayWalk(location, resident, now);

  if (isFirstEntry) {
    const earliestEffectiveDate = await findEarliestEffectiveDate(location, resident);
    const hasStarted = !!earliestEffectiveDate && earliestEffectiveDate <= today;
    return {
      isFirstEntry: true,
      today: today,
      initialDateMin: hasStarted ? earliestEffectiveDate : null,
      initialDateMax: hasStarted ? today : null,
      outstandingDates: [],
      coverByDate: {}
    };
  }

  const outstanding = days.filter(function (d) { return !d.cover || !d.cover.signedAt; });
  const coverByDate = {};
  days.forEach(function (d) { coverByDate[d.date] = d.cover; });
  return {
    isFirstEntry: false,
    today: today,
    initialDateMin: null,
    initialDateMax: null,
    outstandingDates: outstanding.map(function (d) { return d.date; }),
    coverByDate: coverByDate
  };
}

function answerFromPage(page) {
  const checklistRaw = getPlainText(page.properties['Checklist Answers']);
  let checklistAnswers = {};
  if (checklistRaw) {
    try { checklistAnswers = JSON.parse(checklistRaw); } catch (e) { checklistAnswers = {}; }
  }
  return {
    id: page.id,
    key: getPlainText(page.properties['Question Key']),
    text: getPlainText(page.properties['Question Text']),
    type: getPlainText(page.properties['Question Type']),
    answerText: getPlainText(page.properties['Answer Text']),
    checklistAnswers: checklistAnswers
  };
}

async function findAnswers(location, resident, date) {
  const result = await queryDatabase(ANSWERS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Date', date: { equals: date } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const byKey = {};
  (result.results || []).forEach(function (page) {
    const a = answerFromPage(page);
    byKey[a.key] = a;
  });
  return byKey;
}

// Saves whatever's currently entered, complete or not — no validation,
// same "Save Progress" convention as every other process. Snapshots
// each question's own text/type at save time so the answer stays
// self-describing even if the template changes later. answers is
// { [questionKey]: { answerText?, checklistAnswers? } }. enteredBy
// stamps the cover's "Entered By" with whoever most recently saved —
// overwritten on every save (not just the first) so it reflects the
// latest person to touch it, same convention as "Last Updated By"
// elsewhere in this app (e.g. MAR Review).
async function saveAnswers(location, resident, date, questions, answers, enteredBy) {
  const byKey = {};
  questions.forEach(function (q) { byKey[q.key] = q; });
  const existing = await findAnswers(location, resident, date);

  for (const key of Object.keys(answers)) {
    const question = byKey[key];
    if (!question) continue;
    const value = answers[key] || {};
    const props = {
      'Question Text': { rich_text: [{ text: { content: question.text } }] },
      'Question Type': { select: { name: question.type } },
      'Answer Text': { rich_text: chunkRichText(value.answerText) },
      'Checklist Answers': { rich_text: chunkRichText(value.checklistAnswers ? JSON.stringify(value.checklistAnswers) : '') }
    };

    if (existing[key]) {
      await updatePage(existing[key].id, props);
    } else {
      await createPage(ANSWERS_DB_ID, Object.assign({
        'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + date + ' - ' + key } }] },
        'Location': { select: { name: location } },
        'Resident Initials': { rich_text: [{ text: { content: resident } }] },
        'Date': { date: { start: date } },
        'Question Key': { rich_text: [{ text: { content: key } }] },
        'Active': { checkbox: true }
      }, props));
    }
  }

  // Cover row is created (blank/unsigned) the first time anything is
  // saved for this day, so resolveTarget has a row to find even before
  // signing — matches Monthly Checklist's "record exists but not
  // finalized" state.
  const cover = await findCover(location, resident, date);
  if (!cover) {
    const templateEffectiveDate = questions.length ? questions[0].effectiveDate : '';
    const residentFullName = questions.length ? questions[0].residentFullName : '';
    await createPage(NOTES_DB_ID, {
      'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + date } }] },
      'Location': { select: { name: location } },
      'Resident Initials': { rich_text: [{ text: { content: resident } }] },
      'Resident Full Name': { rich_text: [{ text: { content: residentFullName } }] },
      'Date': { date: { start: date } },
      'Template Effective Date': { rich_text: [{ text: { content: templateEffectiveDate } }] },
      'Entered By': { rich_text: enteredBy ? [{ text: { content: enteredBy } }] : [] },
      'Active': { checkbox: true },
      'PDF Generated': { checkbox: false }
    });
  } else if (enteredBy) {
    await updatePage(cover.id, { 'Entered By': { rich_text: [{ text: { content: enteredBy } }] } });
  }
}

// Every question must have a real value before signing — mirrors every
// other process's Finalize gate. For Text questions that's a non-blank
// Answer Text; for Checklist questions, every one of its sub-items must
// have Yes or No recorded. Returns the still-missing question labels.
function missingQuestions(questions, answersByKey) {
  const missing = [];
  questions.forEach(function (q) {
    const answer = answersByKey[q.key];
    if (q.type === 'Checklist') {
      const done = answer && q.checklistItems.every(function (item) {
        return answer.checklistAnswers && (answer.checklistAnswers[item] === 'Yes' || answer.checklistAnswers[item] === 'No');
      });
      if (!done) missing.push(q.text);
    } else {
      if (!answer || !answer.answerText || !answer.answerText.trim()) missing.push(q.text);
    }
  });
  return missing;
}

async function signAndFinalize(location, resident, date, signedBy, strokes) {
  const cover = await findCover(location, resident, date);
  if (!cover) {
    const err = new Error('No note is on file for that day yet.');
    err.statusCode = 400;
    throw err;
  }

  await updatePage(cover.id, {
    'Signed By': { rich_text: [{ text: { content: signedBy } }] },
    'Signed At': { date: { start: new Date().toISOString() } },
    'Signature Strokes': { rich_text: chunkRichText(JSON.stringify(strokes || [])) }
  });
}

module.exports = {
  findQuestionsForDate,
  findAllQuestionRows,
  findResidentsForLocation,
  listVersions,
  createVersion,
  findCover,
  findAllCovers,
  findUnrenderedSignedCovers,
  markPdfGenerated,
  findAnswers,
  resolveTarget,
  findOutstandingDays,
  getResidentDayWalk,
  findEarliestEffectiveDate,
  resolveDayOptions,
  saveAnswers,
  missingQuestions,
  signAndFinalize,
  isoDate,
  addDaysISO
};
