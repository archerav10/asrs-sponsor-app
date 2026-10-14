const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');

const HISTORY_WEEKS = 8;

// The admin dashboard's Weekly Focus tab: this week's content and
// counts, every open follow-up (any week), and an 8-week history grid —
// all limited to sponsors at the admin's granted locations.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const granted = new Set(session.grantedLocations || []);
    const mine = function (r) { return granted.has(r.location); };

    const thisWeek = wf.weekOfFor(new Date());
    const since = wf.addDaysISO(thisWeek, -7 * (HISTORY_WEEKS - 1));
    const results = await Promise.all([
      wf.contentForWeek(thisWeek),
      wf.contentSince(since),
      wf.responsesSince(since),
      wf.openFollowUps()
    ]);
    const content = results[0];
    const responses = results[2].filter(mine);

    const weeks = [];
    for (let i = HISTORY_WEEKS - 1; i >= 0; i--) weeks.push(wf.addDaysISO(thisWeek, -7 * i));
    const titles = {};
    results[1].forEach(function (c) { titles[c.weekOf] = c.focusTitle; });

    // One history row per sponsor, keyed by email, newest name/location wins.
    const sponsors = {};
    responses.forEach(function (r) {
      const key = r.sponsorEmail.toLowerCase();
      if (!sponsors[key]) sponsors[key] = { name: r.sponsorName, location: r.location, weeks: {} };
      sponsors[key].weeks[r.weekOf] = {
        responseId: r.id,
        status: r.status,
        late: r.late,
        comment: r.comment,
        checklist: r.checklist,
        respondedAt: r.respondedAt,
        followedUp: r.followedUp,
        followUpNote: r.followUpNote,
        followedUpBy: r.followedUpBy,
        followedUpDate: r.followedUpDate
      };
    });

    const thisWeeksRows = responses.filter(function (r) { return r.weekOf === thisWeek; });
    const counts = { Green: 0, Yellow: 0, Red: 0, Pending: 0 };
    thisWeeksRows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        thisWeek: thisWeek,
        dueDate: wf.dueDateFor(thisWeek),
        content: content ? {
          focusTitle: content.focusTitle,
          ready: content.ready,
          sent: content.sent,
          checklist: content.checklist
        } : null,
        counts: thisWeeksRows.length ? counts : null,
        followUps: results[3].filter(mine).map(function (r) {
          return { responseId: r.id, weekOf: r.weekOf, sponsorName: r.sponsorName, location: r.location, status: r.status, comment: r.comment, respondedAt: r.respondedAt };
        }),
        weeks: weeks.map(function (w) { return { weekOf: w, focusTitle: titles[w] || '' }; }),
        sponsors: Object.keys(sponsors).map(function (k) { return sponsors[k]; })
          .sort(function (a, b) { return a.location.localeCompare(b.location) || a.name.localeCompare(b.name); })
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
