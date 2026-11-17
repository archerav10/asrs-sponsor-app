const { publicView } = require('./lib/sponsor-checklists');

// The recipient's checklist page (public/checklist/): the checklist for a
// private link. No login; the signed token is the pass.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(await publicView((event.queryStringParameters || {}).t)) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
