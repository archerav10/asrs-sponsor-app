const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');
const { THEMES, QUOTES } = require('./lib/weekly-focus-quotes');
const { weekOptions, sponsorsFor, requireAdmin } = require('./lib/weekly-focus-compose');

const RECENT_QUOTE_WEEKS = 26;

// Everything the Compose screen needs: the week choices, the sponsors
// this admin can write to, the quote library, and — for a chosen sponsor
// and week — their existing message (to edit), their most recent earlier
// message (to start from), and the quotes they've had in the last six
// months (so "Suggest a quote" doesn't repeat one).
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    requireAdmin(session);

    const params = event.queryStringParameters || {};
    const weeks = weekOptions();
    const weekOf = weeks.some(function (w) { return w.weekOf === params.weekOf; }) ? params.weekOf : weeks[1].weekOf;
    const sponsors = await sponsorsFor(session);
    const result = {
      weeks: weeks,
      weekOf: weekOf,
      sponsors: sponsors.map(function (s) { return { id: s.id, name: s.name, location: s.location }; }),
      themes: THEMES,
      quotes: QUOTES
    };

    const sponsor = sponsors.filter(function (s) { return wf.normId(s.id) === wf.normId(params.sponsorId); })[0];
    if (sponsor) {
      const rows = await wf.contentsForSponsor(sponsor.id);
      const existing = rows.filter(function (c) { return c.weekOf === weekOf; })[0] || null;
      const previous = rows.filter(function (c) { return c.weekOf < weekOf; })[0] || null;
      const since = wf.addDaysISO(weekOf, -7 * RECENT_QUOTE_WEEKS);
      let sent = false;
      if (existing) {
        sent = (await wf.responsesForWeek(weekOf)).some(function (r) { return wf.normId(r.contentId) === wf.normId(existing.id); });
      }
      const byId = {};
      sponsors.forEach(function (s) { byId[wf.normId(s.id)] = s; });
      result.sponsorId = sponsor.id;
      result.existing = existing && {
        id: existing.id,
        sponsorIds: existing.sponsorIds,
        sponsorNames: existing.sponsorIds.map(function (id) { return byId[id] ? byId[id].name : 'another sponsor'; }),
        quote: existing.quote,
        quoteAuthor: existing.quoteAuthor,
        focusTitle: existing.focusTitle,
        focusMessage: existing.focusMessage,
        checklist: existing.checklist,
        ready: existing.ready,
        sent: sent
      };
      result.previous = previous && {
        weekOf: previous.weekOf,
        quote: previous.quote,
        quoteAuthor: previous.quoteAuthor,
        focusTitle: previous.focusTitle,
        focusMessage: previous.focusMessage,
        checklist: previous.checklist
      };
      // Sponsors who already have a different message this week can't be
      // added to this one.
      const taken = new Set();
      (await wf.contentsForWeek(weekOf)).forEach(function (c) {
        if (existing && c.id === existing.id) return;
        c.sponsorIds.forEach(function (id) { taken.add(id); });
      });
      result.takenSponsorIds = Array.from(taken);
      result.recentQuotes = rows
        .filter(function (c) { return c.weekOf >= since && c.weekOf !== weekOf && c.quote; })
        .map(function (c) { return c.quote; });
    }

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    if (!err.statusCode) console.error(err); // expected refusals carry a statusCode
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
