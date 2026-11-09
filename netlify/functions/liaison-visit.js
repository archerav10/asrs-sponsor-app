const lz = require('./lib/liaison');

// On-site visits and weekly check-in calls.
//   GET  ?id=...                          the visit, its questions, what the app knows, notes to pick
//   POST { action: 'start', type: 'visit'|'call', spokeWith, mode, coords }
//   POST { action: 'save', id, answers, notes, followUps, spokeWith, mode }
//   POST { action: 'submit', id, answers, notes, followUps, spokeWith, mode, coords }
//   POST { action: 'discard', id }
// coords: { lat, lng, accuracy } from the phone, or null when location
// wasn't shared. On-site visits take a reading at start and at submit.
function residentsOf(session) {
  return (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

async function screenData(session, visit) {
  const residents = residentsOf(session);
  const questions = await lz.loadChecklist(visit.template);
  const [prefill, notes] = await Promise.all([
    lz.buildPrefill(session.location, residents, questions),
    questions.some(function (q) { return q.type === 'Daily notes'; }) ? lz.recentNotes(session.location, residents) : Promise.resolve([])
  ]);
  const saved = {};
  (visit.answers || []).forEach(function (e) { saved[e.key] = e; });
  return { visit: visit, residents: residents, questions: questions, prefill: prefill, noteOptions: notes, saved: saved };
}

exports.handler = async function (event) {
  try {
    const session = lz.requireLiaison(event);
    if (event.httpMethod === 'GET') {
      const id = (event.queryStringParameters || {}).id;
      if (!id) throw lz.httpError(400, 'Choose a visit.');
      const visit = await lz.visitForSession(session, id);
      return { statusCode: 200, body: JSON.stringify(await screenData(session, visit)) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
    const body = JSON.parse(event.body || '{}');

    if (body.action === 'start') {
      const visits = await lz.visitsForLocation(session.location);
      const type = body.type === 'call' ? lz.TYPES.call : lz.TYPES.visit;
      const existing = lz.findDraft(visits, type, session.email);
      const visit = existing || await lz.startVisit(session, body);
      return { statusCode: 200, body: JSON.stringify(Object.assign(await screenData(session, visit), { resumed: !!existing })) };
    }

    const visit = await lz.visitForSession(session, body.id, { editable: true });

    if (body.action === 'discard') {
      await require('./lib/notion').updatePage(visit.id, { 'Active': { checkbox: false } });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    const residents = residentsOf(session);
    const questions = await lz.loadChecklist(visit.template);
    const noteOptions = questions.some(function (q) { return q.type === 'Daily notes'; }) ? await lz.recentNotes(session.location, residents) : [];
    const snapshot = lz.snapshotAnswers(questions, body.answers, residents, noteOptions);
    await lz.saveDraft(visit, { answers: snapshot, notes: body.notes, followUps: body.followUps, spokeWith: body.spokeWith, mode: body.mode });

    if (body.action === 'save') return { statusCode: 200, body: JSON.stringify({ success: true }) };
    if (body.action !== 'submit') throw lz.httpError(400, 'Unknown action.');

    const missing = lz.missingForSubmit(snapshot, visit.type);
    if (visit.type === lz.TYPES.call && !String(body.spokeWith || visit.spokeWith || '').trim()) missing.unshift('Who you spoke with');
    if (missing.length) throw lz.httpError(400, 'Still needs: ' + missing.join('; '));

    const home = await lz.homeInfo(session.location);
    const check = await lz.completeVisit(visit, home, body.coords);
    const done = await lz.getVisit(visit.id);
    let checklistUpdated = false, filed = true;
    if (done.type === lz.TYPES.visit) {
      try { checklistUpdated = await lz.updateMonthlyChecklist(session.location, done.visitDate, snapshot); } catch (e) { console.error('Monthly checklist update failed', e); }
    }
    try {
      await lz.fileVisitPdf(done, home, residents, check, event.headers && (event.headers.origin || event.headers.Origin) || process.env.URL);
    } catch (e) {
      filed = false;
      console.error('Visit PDF filing failed', e);
      await require('./lib/notion').updatePage(done.id, { 'PDF Status': { select: { name: 'Failed' } } });
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, locationCheck: check.result, distance: check.distance, distanceText: lz.describeDistance(check.distance), checklistUpdated: checklistUpdated, pdfSent: filed })
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
