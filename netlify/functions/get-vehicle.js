const { requireSession } = require('./lib/session');
const vh = require('./lib/vehicles');

// One vehicle's screen: details, every tracked item's status and the full
// service history, newest first.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') throw vh.httpError(403, 'Not authorized for the admin dashboard.');
    const id = (event.queryStringParameters || {}).id;
    if (!id) throw vh.httpError(400, 'Choose a vehicle.');
    const vehicle = await vh.vehicleForSession(session, id);
    const services = await vh.servicesForVehicle(vehicle.id);
    const status = vh.computeVehicleStatus(services);
    delete vehicle.remindersSent;
    return {
      statusCode: 200,
      body: JSON.stringify({
        vehicle: Object.assign(vehicle, { description: vh.describe(vehicle) }),
        status: status,
        history: services,
        serviceTypes: vh.SERVICE_TYPES.map(function (t) {
          return { key: t.key, label: t.label, tracked: vh.isTracked(t), needsMileage: !!t.miles || t.key === 'mileage', needsExpiration: !!t.expires };
        })
      })
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
