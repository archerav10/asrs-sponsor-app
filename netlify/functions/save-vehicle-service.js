const { requireSession } = require('./lib/session');
const vh = require('./lib/vehicles');

// Logs a service (or a mileage reading) for a vehicle, or removes a
// mistaken entry (unchecks Active; it stays in Notion).
//   { vehicleId, typeKey, date, mileage, expirationDate, cost, note }
//   { serviceId, remove: true }
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') throw vh.httpError(403, 'Not authorized for the admin dashboard.');
    const body = JSON.parse(event.body || '{}');

    if (body.serviceId && body.remove) {
      const service = await vh.getService(body.serviceId);
      await vh.vehicleForSession(session, service.vehicleId);
      await vh.removeService(service.id);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    if (!body.vehicleId) throw vh.httpError(400, 'Choose a vehicle.');
    const vehicle = await vh.vehicleForSession(session, body.vehicleId);
    if (!vehicle.active) throw vh.httpError(409, 'This vehicle has been retired.');
    const num = function (v) { return v === '' || v == null ? null : Number(String(v).replace(/[,$\s]/g, '')); };
    const input = {
      typeKey: body.typeKey,
      date: body.date,
      mileage: num(body.mileage),
      expirationDate: body.expirationDate || '',
      cost: num(body.cost),
      note: String(body.note || '').trim().slice(0, 1000)
    };
    // One day of slack for an admin west of Eastern late in the evening.
    const tomorrow = vh.todayISO(new Date(Date.now() + 86400000));
    const invalid = vh.validateService(input, tomorrow);
    if (invalid) throw vh.httpError(400, invalid);

    // A reading lower than one already on file is almost always a typo.
    if (input.mileage != null && !body.confirmLowerMileage) {
      const current = vh.computeVehicleStatus(await vh.servicesForVehicle(vehicle.id)).currentMileage;
      if (current && input.mileage < current.mileage) {
        return { statusCode: 409, body: JSON.stringify({ error: 'That mileage is lower than the ' + vh.fmtMiles(current.mileage) + ' already on file (' + vh.fmtDate(current.date) + ').', lowerMileage: true }) };
      }
    }

    const saved = await vh.createService(vehicle, input, session.name || session.email, vh.todayISO());
    return { statusCode: 200, body: JSON.stringify({ success: true, id: saved.id }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
