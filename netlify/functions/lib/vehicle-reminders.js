const { sendSms } = require('./twilio');
const { routineRecipientsForLocation, allEnabledAdmins } = require('./notification-recipients');
const vh = require('./vehicles');

// Daily: texts the admins for a vehicle's location when a tracked service
// turns yellow (30 days / 500 miles out) and again when it's due. Each
// stage of each due point is texted once (remembered in the vehicle's
// "Reminders Sent"), so re-runs are quiet and logging the service starts
// the next cycle fresh. One text per vehicle per run, listing everything
// that changed. Recipients are the location's admins who get routine
// notifications; if nobody is granted the location, every enabled admin.

function stageFor(status) {
  return status === 'red' ? 'due' : status === 'yellow' ? 'soon' : null;
}

function itemLine(item) {
  return item.label + ': ' + item.text.charAt(0).toLowerCase() + item.text.slice(1);
}

function reminderText(vehicle, items) {
  const name = vehicle.name + (vehicle.plate ? ' (' + vehicle.plate + ')' : '');
  return 'ASRS Vehicles, ' + vehicle.location + ' - ' + name + ':\n' +
    items.map(function (i) { return (i.status === 'red' ? 'DUE NOW - ' : 'Coming up - ') + itemLine(i); }).join('\n') +
    '\nPlease log it on the admin dashboard once it\'s done.';
}

async function recipientsFor(location) {
  const admins = (await routineRecipientsForLocation(location)).filter(function (r) { return r.role === 'admin'; });
  return admins.length ? admins : allEnabledAdmins();
}

// options: { dryRun, now }
async function runVehicleReminders(options) {
  options = options || {};
  const vehicles = await vh.allActiveVehicles();
  const services = await vh.servicesByVehicle(vehicles);
  const results = [];

  for (const vehicle of vehicles) {
    const status = vh.computeVehicleStatus(services[vh.normId(vehicle.id)] || [], options.now);
    const sent = vehicle.remindersSent || {};
    const current = {};
    const toSend = [];
    status.items.forEach(function (item) {
      if (!item.reminderKey) return;
      const already = sent[item.reminderKey] || [];
      current[item.reminderKey] = already.slice();
      const stage = stageFor(item.status);
      if (stage && already.indexOf(stage) === -1) {
        toSend.push(item);
        current[item.reminderKey].push(stage);
      }
    });
    if (!toSend.length) continue;

    const entry = { vehicle: vehicle.name, location: vehicle.location, items: toSend.map(itemLine), text: reminderText(vehicle, toSend) };
    if (!options.dryRun) {
      const recipients = await recipientsFor(vehicle.location);
      let delivered = 0;
      for (const r of recipients) {
        try { await sendSms(r.phone, entry.text); delivered++; } catch (e) { console.error('Vehicle reminder failed for ' + r.name, e); }
      }
      entry.texted = delivered;
      // Remember only the due points that still exist, so the field
      // doesn't grow forever. If nobody could be texted, try again tomorrow.
      if (delivered) {
        try { await vh.saveRemindersSent(vehicle.id, current); } catch (e) { console.error('Could not save reminders for ' + vehicle.name, e); }
      }
    }
    results.push(entry);
  }
  return { dryRun: !!options.dryRun, vehiclesChecked: vehicles.length, results: results };
}

module.exports = { runVehicleReminders, reminderText };
