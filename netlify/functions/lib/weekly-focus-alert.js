const { recipientsForLocation, allEnabledAdmins } = require('./notification-recipients');
const { sendSms } = require('./twilio');
const { redAlertText } = require('./weekly-focus-email');

// "Please contact me ASAP" (Red), from the app or a text reply of 3:
// texts every admin with app access at the sponsor's location, regardless
// of the routine-notification opt-out, the same as a Serious Incident
// alert. Nobody granted the location: every enabled admin, so a Red
// always reaches someone. Returns how many admins were texted.
async function alertAdminsRed(response) {
  let admins = (await recipientsForLocation(response.location)).filter(function (r) { return r.role === 'admin'; });
  if (!admins.length) admins = await allEnabledAdmins();
  let sent = 0;
  for (const admin of admins) {
    try {
      await sendSms(admin.phone, redAlertText(response));
      sent++;
    } catch (e) {
      console.error('Weekly Focus Red alert failed for ' + admin.name, e);
    }
  }
  return sent;
}

module.exports = { alertAdminsRed };
