const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');
const { httpError, weekOptions, sponsorsFor, requireAdmin, readFields } = require('./lib/weekly-focus-compose');

// Saves a message from the Compose screen as a Weekly Focus row (new, or
// an edit of one that hasn't gone out yet). One row can go to several
// sponsors, but a sponsor can only have one row per week, so the send
// never has to guess which message they get.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    requireAdmin(session);

    const body = JSON.parse(event.body || '{}');
    const fields = readFields(body);
    const weekOf = body.weekOf;
    if (!weekOptions().some(function (w) { return w.weekOf === weekOf; })) {
      throw httpError(400, 'Choose this week or one of the next three.');
    }
    if (!fields.focusTitle) throw httpError(400, 'Add a Focus of the week title.');

    const sponsors = await sponsorsFor(session);
    const byId = {};
    sponsors.forEach(function (s) { byId[wf.normId(s.id)] = s; });
    const chosen = (Array.isArray(body.sponsorIds) ? body.sponsorIds : [])
      .map(function (id) { return byId[wf.normId(id)]; })
      .filter(Boolean);
    if (!chosen.length) throw httpError(400, 'Choose at least one sponsor.');

    const weekRows = await wf.contentsForWeek(weekOf);
    let existing = null;
    if (body.id) {
      existing = weekRows.filter(function (c) { return wf.normId(c.id) === wf.normId(body.id); })[0];
      if (!existing) throw httpError(404, 'That message wasn\'t found for this week. Reload and try again.');
      // A row can also name sponsors at locations this admin can't see;
      // those stay on it untouched.
      existing.sponsorIds.forEach(function (id) {
        if (!byId[id]) throw httpError(403, 'This message also goes to a sponsor outside your locations, so it can only be edited in Notion.');
      });
      const sent = (await wf.responsesForWeek(weekOf)).some(function (r) { return wf.normId(r.contentId) === wf.normId(existing.id); });
      if (sent) throw httpError(409, 'This message has already been sent, so it can\'t be changed.');
    }

    const clash = chosen.filter(function (s) {
      return weekRows.some(function (c) {
        return (!existing || c.id !== existing.id) && c.sponsorIds.indexOf(wf.normId(s.id)) !== -1;
      });
    });
    if (clash.length) {
      throw httpError(409, clash.map(function (s) { return s.name; }).join(', ') + ' already ' + (clash.length === 1 ? 'has' : 'have') +
        ' a message for this week. Open it from the Weekly Focus tab to edit it instead.');
    }

    const saved = await wf.saveContent(existing && existing.id, Object.assign({}, fields, {
      weekOf: weekOf,
      sponsorIds: chosen.map(function (s) { return s.id; }),
      sponsorNames: chosen.map(function (s) { return s.name; }),
      ready: !!body.ready
    }));
    return { statusCode: 200, body: JSON.stringify({ success: true, id: saved.id, ready: saved.ready }) };
  } catch (err) {
    if (!err.statusCode) console.error(err); // expected refusals carry a statusCode
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
