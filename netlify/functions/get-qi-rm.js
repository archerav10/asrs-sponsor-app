const { requireSession } = require('./lib/session');
const qi = require('./lib/qi-rm');
const pol = require('./lib/policies');

// QI & RM tab (Executive Director and Risk Manager only).
//   GET ?month=yyyy-mm   objectives with that month's results, plus the
//                        issues and opportunities log
//   GET ?view=policies   the policy register, documents and reviews
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    await qi.requireQiAccess(session);
    const q = event.queryStringParameters || {};
    if (q.view === 'policies') return json(200, await pol.registerView());
    const month = q.month || qi.shiftMonth(qi.todayIso().slice(0, 7), 0);
    const [objectives, items] = await Promise.all([qi.objectivesView(month), qi.itemsView()]);
    return json(200, Object.assign({ me: session.name || session.email, today: qi.todayIso() }, objectives, items));
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
