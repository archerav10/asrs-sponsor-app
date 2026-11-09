const { requireSession } = require('./lib/session');
const vh = require('./lib/vehicles');

// The Vehicles tab (admin dashboard) and Vehicles screen (sponsor app):
// every active vehicle at the session's locations, with its overall status, latest mileage and the tracked
// items that need attention.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const locations = vh.sessionLocations(session);
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
        attention: status.items.filter(function (i) { return i.status === 'red' || i.status === 'yellow'; }),
        insuranceText: (status.items.filter(function (i) { return i.key === 'insurance'; })[0] || {}).text || ''
      };
    });
    return { statusCode: 200, body: JSON.stringify({ locations: locations, vehicles: rows }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
