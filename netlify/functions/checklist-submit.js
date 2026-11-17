const { submit } = require('./lib/sponsor-checklists');

// Submit on the recipient's checklist page: records the submission and
// texts the admin who sent it and the location's Residential Liaison(s).
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const result = await submit(JSON.parse(event.body || '{}').t);
    return { statusCode: 200, body: JSON.stringify(Object.assign({ success: true }, result)) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
