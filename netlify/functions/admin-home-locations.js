const { updatePage } = require('./lib/notion');
const { requireSuperAdmin } = require('./lib/super-admin-session');
const lz = require('./lib/liaison');

// Super admin: each home's address, coordinates, on-site radius and type,
// used by the Liaison app's on-site visit location check.
//   GET                                      every home
//   POST { id, address, lat, lng, radius, homeType }
exports.handler = async function (event) {
  try {
    requireSuperAdmin(event);
    if (event.httpMethod === 'GET') return { statusCode: 200, body: JSON.stringify({ homes: await lz.allHomes(), defaultRadius: lz.DEFAULT_RADIUS_M }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
    const b = JSON.parse(event.body || '{}');
    const homes = await lz.allHomes();
    const home = homes.find(function (h) { return h.id === b.id; });
    if (!home) throw lz.httpError(404, 'That home wasn\'t found.');
    const n = function (v) { return v === '' || v == null ? null : Number(v); };
    const lat = n(b.lat), lng = n(b.lng), radius = n(b.radius);
    if ((lat == null) !== (lng == null)) throw lz.httpError(400, 'Enter both latitude and longitude, or neither.');
    if (lat != null && (!isFinite(lat) || Math.abs(lat) > 90 || !isFinite(lng) || Math.abs(lng) > 180)) throw lz.httpError(400, 'Check the latitude and longitude.');
    if (radius != null && (!isFinite(radius) || radius < 25 || radius > 2000)) throw lz.httpError(400, 'The on-site radius should be between 25 and 2000 meters.');
    const props = {
      'Address': { rich_text: b.address ? [{ text: { content: String(b.address).slice(0, 300) } }] : [] },
      'Latitude': { number: lat },
      'Longitude': { number: lng },
      'On-site Radius (m)': { number: radius }
    };
    if (b.homeType === 'Group Home' || b.homeType === 'Sponsored Residential') props['Home Type'] = { select: { name: b.homeType } };
    await updatePage(home.id, props);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
