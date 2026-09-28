const { queryDatabase, getPlainText } = require('./notion');

const SPONSORS_DB_ID = process.env.SPONSORS_DB_ID;
const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;

async function recipientsForLocation(location) {
  const recipients = [];
  const seenPhones = new Set();

  // Admins are queried first so someone who's both a sponsor and an
  // admin at this location (same phone number) keeps the 'admin' role —
  // callers that filter to admins only (Serious Incident, MAR Review
  // reminders) need that role to actually be present, not shadowed by a
  // 'sponsor' entry that happened to claim the phone number first.
  const adminsResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, null);
  (adminsResult.results || []).forEach(function (page) {
    const enabled = getPlainText(page.properties['Admin App Enabled']);
    if (!enabled) return;
    const grantedLocations = (getPlainText(page.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); });
    if (grantedLocations.indexOf(location) === -1) return;
    const phone = getPlainText(page.properties['Phone Number']);
    if (phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      recipients.push({
        phone: phone,
        name: getPlainText(page.properties['Name']),
        role: 'admin',
        // App access (Admin App Enabled) and getting the routine
        // compliance texts/digest are deliberately separate switches —
        // someone can keep logging in without being on every automated
        // blast. This is an opt-OUT flag so a brand new row (or one
        // this property is simply never touched on) defaults to still
        // getting routine notifications — getPlainText returns '' for
        // a missing/unset property, which is falsy here same as an
        // explicit unchecked box.
        routineNotificationsOptedOut: !!getPlainText(page.properties['Routine Notifications Opted Out'])
      });
    }
  });

  const sponsorsResult = await queryDatabase(SPONSORS_DB_ID, {
    property: 'Location', rich_text: { equals: location }
  });
  (sponsorsResult.results || []).forEach(function (page) {
    const enabled = getPlainText(page.properties['Provider App Enabled']);
    const phone = getPlainText(page.properties['Phone Number']);
    if (enabled && phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      recipients.push({
        phone: phone,
        name: getPlainText(page.properties['Name']),
        role: 'sponsor',
        routineNotificationsOptedOut: !!getPlainText(page.properties['Routine Notifications Opted Out'])
      });
    }
  });

  return recipients;
}

// What every routine (non-incident) notification job should call instead
// of recipientsForLocation directly — bakes in the opt-out filter so a
// future check file can't forget it. create-serious-incident.js is the
// one deliberate exception: an actual incident alert isn't a "routine"
// notice, so it calls recipientsForLocation itself and always fires
// regardless of this flag.
async function routineRecipientsForLocation(location) {
  return (await recipientsForLocation(location)).filter(function (r) { return !r.routineNotificationsOptedOut; });
}

module.exports = { recipientsForLocation, routineRecipientsForLocation };
