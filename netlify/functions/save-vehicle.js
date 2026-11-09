const { requireSession } = require('./lib/session');
const vh = require('./lib/vehicles');

// Adds a vehicle, edits its details, or retires it (sold / no longer in
// service: hidden and no more reminders; its history stays in Notion).
//   { location, name, year, make, model, plate, vin, notes }   add
//   { id, name, year, ... }                                     edit
//   { id, retire: true }                                        retire
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    if (body.id) {
      const vehicle = await vh.vehicleForSession(session, body.id);
      if (body.retire) {
        await vh.retireVehicle(vehicle.id);
        return { statusCode: 200, body: JSON.stringify({ success: true, retired: true }) };
      }
      const fields = vh.cleanVehicleFields(body);
      if (!fields.name) throw vh.httpError(400, 'Give the vehicle a name, e.g. "White Sienna".');
      await vh.updateVehicle(vehicle.id, fields);
      return { statusCode: 200, body: JSON.stringify({ success: true, id: vehicle.id }) };
    }

    // The sponsor app has one location; the admin dashboard picks one.
    const location = session.accountType === 'admin-dashboard' ? body.location : session.location;
    if (vh.sessionLocations(session).indexOf(location) === -1) throw vh.httpError(403, 'Choose one of your locations.');
    const fields = vh.cleanVehicleFields(body);
    if (!fields.name) throw vh.httpError(400, 'Give the vehicle a name, e.g. "White Sienna".');
    const created = await vh.createVehicle(location, fields);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: created.id }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
