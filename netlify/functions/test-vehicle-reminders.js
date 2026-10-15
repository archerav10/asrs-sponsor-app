const { runVehicleReminders } = require('./lib/vehicle-reminders');

// Not scheduled. Dry run only: shows which reminder texts today's check
// would send, without sending or recording anything. Same secret as the
// other test endpoints: ?secret=<NOTIFICATION_TEST_SECRET>
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;
  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }
  try {
    const result = await runVehicleReminders({ dryRun: true });
    return { statusCode: 200, body: JSON.stringify(result, null, 2) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
