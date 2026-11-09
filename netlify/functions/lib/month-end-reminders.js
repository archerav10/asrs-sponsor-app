const mec = require('./month-end-close');
const lr = require('./location-report');
const { adminsWithRole } = require('./roles');
const { sendSms } = require('./twilio');

// Month-end close reminders for whoever holds the Risk Manager role
// (Admin Accounts → Roles). Last month's open items:
//   - a text on the 10th ("due the 15th") and the 16th ("overdue")
//   - a section in the Friday admin digest until everything is done

function lastMonth(today) {
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

async function openItemsFor(admin, month) {
  const data = await mec.load(month, admin.grantedLocations.slice().sort());
  return { data: data, open: data.items.filter(function (i) { return i.status !== 'green'; }) };
}

function describe(open) {
  return open.map(function (i) { return i.label.replace(/ \(ASRS-[0-9-]+\)/, '') + (i.key === 'reports' || i.key === 'flags' ? ' (' + i.text + ')' : ''); });
}

// options: { dryRun, asOf: 'YYYY-MM-DD' }
async function runMonthEndReminders(options) {
  options = options || {};
  const today = options.asOf || lr.easternToday();
  const day = +today.slice(8, 10);
  if (day !== 10 && day !== 16 && !options.force) return { skipped: true, reason: 'only on the 10th and 16th', today: today };
  const month = lastMonth(today);
  const managers = await adminsWithRole('Risk Manager');
  const results = [];
  for (const admin of managers) {
    if (!admin.phone) { results.push({ admin: admin.name, skipped: 'no phone' }); continue; }
    const { data, open } = await openItemsFor(admin, month);
    if (!open.length) { results.push({ admin: admin.name, skipped: 'all done' }); continue; }
    const body = 'ASRS month-end close for ' + data.monthLabel + ': ' + open.length + ' open' + (day >= 16 ? ', now overdue (was due ' + data.due.slice(5).replace('-', '/') + ')' : ', due ' + data.due.slice(5).replace('-', '/')) + '. ' +
      describe(open).join('; ') + '. Admin Dashboard > Reports.';
    if (!options.dryRun) await sendSms(admin.phone, body);
    results.push({ admin: admin.name, phone: admin.phone, message: body, sent: !options.dryRun });
  }
  return { month: month, results: results };
}

// Text for the Friday digest, or '' when this admin isn't a Risk
// Manager or last month is all done.
async function digestSection(email, today) {
  const managers = await adminsWithRole('Risk Manager');
  const admin = managers.filter(function (a) { return a.email === String(email || '').trim().toLowerCase(); })[0];
  if (!admin) return '';
  const month = lastMonth(today || lr.easternToday());
  const { data, open } = await openItemsFor(admin, month);
  if (!open.length) return '';
  return 'MONTH-END CLOSE, ' + data.monthLabel.toUpperCase() + ' (due ' + data.due + '):\n' +
    open.map(function (i) { return '- ' + i.label + ': ' + i.text; }).join('\n') + '\nAdmin Dashboard -> Reports tab.\n\n';
}

module.exports = { runMonthEndReminders, digestSection, lastMonth };
