const { runVehicleReminders } = require('./lib/vehicle-reminders');

// Scheduled (see netlify.toml): daily, with the other morning checks.
exports.handler = async function () {
  const result = await runVehicleReminders();
  return { statusCode: 200, body: JSON.stringify(result) };
};
