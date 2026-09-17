const { requireSession } = require('./lib/session');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSession(event); // just needs a valid logged-in provider

    const webhookUrl = process.env.ZAPIER_EVENT_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Attachment uploads are not configured yet.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ webhookUrl: webhookUrl }) };
  } catch (err) {
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
