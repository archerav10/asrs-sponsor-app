const { queryDatabase, getPlainText } = require('./notion');

// Roles on Admin Accounts ("Roles" multi-select), so responsibilities can
// be handed to someone else by ticking a box instead of changing code:
//
//   Risk Manager         month-end close reminders (text on the 10th and
//                        16th, section in the Friday digest); owns QA/Issues
//                        Log, Risk Tracking Tool and the ASRS-620-06 report
//   Executive Director   signs the monthly location reports
//   Program Director     suggested owner for plan, health and staff findings
//   Residential Liaison  suggested owner for liaison findings; signs the
//                        monthly location reports
const ROLES = ['Executive Director', 'Risk Manager', 'Program Director', 'Residential Liaison'];
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

function rolesOf(page) {
  const p = page.properties['Roles'];
  return p && p.multi_select ? p.multi_select.map(function (o) { return o.name; }).filter(function (r) { return ROLES.indexOf(r) !== -1; }) : [];
}

function cleanRoles(list) {
  return (Array.isArray(list) ? list : []).filter(function (r, i, a) { return ROLES.indexOf(r) !== -1 && a.indexOf(r) === i; });
}

// Admins holding a role; with a location, only those granted it.
async function adminsWithRole(role, location) {
  const r = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, { property: 'Roles', multi_select: { contains: role } });
  return (r.results || []).filter(function (page) { return rolesOf(page).indexOf(role) !== -1; }).map(function (page) {
    return {
      name: getPlainText(page.properties['Name']),
      email: getPlainText(page.properties['Email']).trim().toLowerCase(),
      phone: getPlainText(page.properties['Phone Number']),
      grantedLocations: (getPlainText(page.properties['Granted Locations']) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };
  }).filter(function (a) { return !location || a.grantedLocations.indexOf(location) !== -1; });
}

module.exports = { ROLES, rolesOf, cleanRoles, adminsWithRole };
