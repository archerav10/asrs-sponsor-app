const { requireSession } = require('./lib/session');
const vh = require('./lib/vehicles');

// The Vehicles tab: every active vehicle at the admin's granted
// locations, with its overall status, latest mileage and the tracked
// items that need attention.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') throw vh.httpError(403, 'Not authorized for the admin dashboard.');
    const locations = session.grantedLocations || [];
    const vehicles = await vh.vehiclesForLocations(locations);
    const services = await vh.servicesByVehicle(vehicles);
    const rows = vehicles.map(function (v) {
      const status = vh.computeVehicleStatus(services[vh.normId(v.id)] || []);
      return {
        id: v.id,
        name: v.name,
        location: v.location,
        description: vh.describe(v),
        plate: v.plate,
        overall: status.overall,
        currentMileage: status.currentMileage,
        attention: status.items.filter(function (i) { return i.status === 'red' || i.status === 'yellow'; })
      };
    });
    return { statusCode: 200, body: JSON.stringify({ locations: locations, vehicles: rows }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
