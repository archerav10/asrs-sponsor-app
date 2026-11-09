const { queryDatabase, queryDatabaseAll, updatePage, getPlainText } = require('./notion');
const { rolesOf } = require('./roles');

// Who can get into what, by home. Three kinds of access:
//   Sponsor App (sponsors)   Sponsors row: Location (one home) + Provider App
//                            Enabled + a personal password. The home comes
//                            from the row, not the password.
//   Admin Dashboard          Admin Accounts: Granted Locations. The same
//   (+ Sponsor App as admin) homes let them into the Sponsor App with that
//                            home's password.
//   Liaison App              Admin Accounts: Liaison Locations (with the
//                            home's password). Older rows with no Liaison
//                            Locations but Liaison App Enabled use Granted.
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
const LOCATION_CODES_DB_ID = process.env.LOCATION_CODES_DB_ID;

function httpError(status, message) { const e = new Error(message); e.statusCode = status; return e; }
function list(text) { return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
function rich(s) { return { rich_text: s ? [{ text: { content: String(s).slice(0, 1900) } }] : [] }; }

function liaisonLocationsOf(page) {
  const own = list(getPlainText(page.properties['Liaison Locations']));
  if (own.length) return own;
  return getPlainText(page.properties['Liaison App Enabled']) ? list(getPlainText(page.properties['Granted Locations'])) : [];
}

function adminFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    email: getPlainText(p['Email']).trim().toLowerCase(),
    phone: getPlainText(p['Phone Number']),
    adminLocations: list(getPlainText(p['Granted Locations'])),
    liaisonLocations: liaisonLocationsOf(page),
    roles: rolesOf(page)
  };
}

function sponsorFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    email: getPlainText(p['Email']).trim(),
    phone: getPlainText(p['Phone Number']),
    location: getPlainText(p['Location']),
    residentInitials: getPlainText(p['Resident Initials']),
    enabled: !!getPlainText(p['Provider App Enabled']),
    hasPassword: !!getPlainText(p['Password Hash']),
    primary: !!getPlainText(p['Primary Sponsor'])
  };
}

async function homes() {
  const r = await queryDatabase(LOCATION_CODES_DB_ID, null);
  return (r.results || []).map(function (page) {
    return { location: getPlainText(page.properties['Location']), active: !!getPlainText(page.properties['Active']), hasPassword: !!getPlainText(page.properties['Password Hash']) };
  }).filter(function (h) { return h.location; }).sort(function (a, b) { return a.location.localeCompare(b.location); });
}

async function overview() {
  const [h, admins, sponsors] = await Promise.all([
    homes(),
    queryDatabaseAll(ADMIN_ACCOUNTS_DB_ID).then(function (r) { return r.map(adminFromPage); }),
    queryDatabaseAll(SPONSORS_DB_ID).then(function (r) { return r.map(sponsorFromPage); })
  ]);
  return {
    homes: h,
    admins: admins.sort(function (a, b) { return a.name.localeCompare(b.name) || a.email.localeCompare(b.email); }),
    sponsors: sponsors.filter(function (s) { return s.name || s.email; }).sort(function (a, b) { return a.name.localeCompare(b.name); })
  };
}

async function saveAdmin(input, validHomes) {
  const clean = function (l) { return (Array.isArray(l) ? l : []).filter(function (x, i, a) { return validHomes.indexOf(x) !== -1 && a.indexOf(x) === i; }); };
  const adminLocations = clean(input.adminLocations), liaisonLocations = clean(input.liaisonLocations);
  await updatePage(input.id, {
    'Granted Locations': rich(adminLocations.join(', ')),
    'Admin App Enabled': { checkbox: adminLocations.length > 0 },
    'Liaison Locations': rich(liaisonLocations.join(', ')),
    'Liaison App Enabled': { checkbox: liaisonLocations.length > 0 }
  });
  return { adminLocations: adminLocations, liaisonLocations: liaisonLocations };
}

async function saveSponsor(input, validHomes, current) {
  const props = {};
  if (input.location !== undefined) {
    if (input.location && validHomes.indexOf(input.location) === -1) throw httpError(400, 'Unknown home.');
    props['Location'] = rich(input.location || '');
  }
  if (input.residentInitials !== undefined) props['Resident Initials'] = rich(list(input.residentInitials).map(function (s) { return s.toUpperCase(); }).join(', '));
  if (input.enabled !== undefined) {
    if (input.enabled && current && !current.hasPassword) throw httpError(400, 'Set a password for ' + (current.name || 'this sponsor') + ' first (Set Provider Password), then turn on access.');
    props['Provider App Enabled'] = { checkbox: !!input.enabled };
  }
  await updatePage(input.id, props);
}

module.exports = { list, liaisonLocationsOf, adminFromPage, sponsorFromPage, homes, overview, saveAdmin, saveSponsor };
