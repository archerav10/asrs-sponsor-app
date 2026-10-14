const { requireSession } = require('./lib/session');
const { startJob } = require('./lib/weekly-focus-trigger');
const wf = require('./lib/weekly-focus');

// "Send now" on the dashboard: sends this week's Weekly Focus right away
// to every sponsor with a Ready row who hasn't had theirs yet — e.g. a
// row marked Ready after Tuesday morning. Sponsors who already have this
// week's email are skipped, so pressing it twice never double-sends.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const weekOf = wf.weekOfFor(new Date());
    const ready = (await wf.contentsForWeek(weekOf)).filter(function (c) { return c.ready && c.sponsorIds.length; });
    if (!ready.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This week (' + weekOf + ') has no Weekly Focus row with a Sponsor that\'s marked Ready to Send yet.' }) };
    }

    // Start it on whichever site this request came in on (production or a
    // deploy preview), so a preview's "Send now" runs the preview's code.
    // Only this app's own hosts — never wherever a Host header points.
    const host = event.headers.host || event.headers.Host || '';
    const siteUrl = /^([a-z0-9-]+--)?asrs-sponsor-app\.netlify\.app$/.test(host) ? 'https://' + host : null;
    await startJob('send', siteUrl, { weekOf: weekOf });
    return { statusCode: 202, body: JSON.stringify({ started: true, weekOf: weekOf }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
