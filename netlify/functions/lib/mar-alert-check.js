const { queryDatabase, getPlainText } = require('./notion');
const { sendSms } = require('./twilio');
const { recipientsForLocation } = require('./notification-recipients');

const MAR_DB_ID = process.env.MAR_DB_ID;
const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function residentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const byResident = {};
  (result.results || []).forEach(function (page) {
    const resident = getPlainText(page.properties['Resident Initials']);
    if (!resident) return;
    if (!byResident[resident]) byResident[resident] = [];
    byResident[resident].push({
      name: getPlainText(page.properties['Item Name']),
      missing: getPlainText(page.properties['Missing']),
      currentExpDate: getPlainText(page.properties['Current Exp Date'])
    });
  });
  return byResident;
}

// options: { dryRun: boolean }
async function runMarAlertCheck(options) {
  options = options || {};
  const today = todayISO();
  const results = [];

  for (const location of LOCATIONS) {
    const byResident = await residentsForLocation(location);
    const lines = [];

    Object.keys(byResident).forEach(function (resident) {
      const problems = [];
      byResident[resident].forEach(function (med) {
        if (med.missing) {
          problems.push(med.name + ' (missing)');
        } else if (med.currentExpDate && med.currentExpDate < today) {
          problems.push(med.name + ' (expired)');
        }
      });
      if (problems.length) {
        lines.push(resident + ': ' + problems.join(', '));
      }
    });

    if (!lines.length) continue;

    const message = 'ASRS ' + location + ' — MEDICATION ALERT:\n' + lines.join('\n');
    const recipients = await recipientsForLocation(location);

    if (options.dryRun) {
      results.push({ location: location, message: message, recipients: recipients.map(function (r) { return r.name + ' (' + r.role + ', ' + r.phone + ')'; }) });
    } else {
      for (const r of recipients) {
        await sendSms(r.phone, message);
      }
      results.push({ location: location, sent: recipients.length, lines: lines.length });
    }
  }

  return { dryRun: !!options.dryRun, results: results };
}

module.exports = { runMarAlertCheck };
