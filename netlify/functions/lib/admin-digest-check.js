const { queryDatabase, getPlainText } = require('./notion');
const { sendEmail, sleep } = require('./email');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;
const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID;
const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID;

// Same ranges as the app's own Physical Environment screen.
const PE_RANGES = {
  'Kitchen Hot Water Temp': { min: 100, max: 110 },
  'Bathroom Hot Water Temp': { min: 100, max: 110 },
  'Refrigerator Temp': { min: 32, max: 40 },
  'Freezer Temp': { max: 32 }
};

function todayISO(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

// Shared shape for First Aid Supplies and Emergency Supplies — both use
// Tracks Expiration + Present, and both have a "General Notes" row to
// skip (same pattern as everywhere else in this app).
async function checkSimpleReport(dbId, location, reportLabel, today) {
  const result = await queryDatabase(dbId, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const issues = [];
  (result.results || []).forEach(function (page) {
    const name = getPlainText(page.properties['Item Name']);
    if (name === 'General Notes') return;

    const tracksExp = getPlainText(page.properties['Tracks Expiration']);
    if (tracksExp) {
      const expDate = getPlainText(page.properties['Current Exp Date']);
      if (!expDate) {
        issues.push(reportLabel + ': ' + name + ' \u2014 no expiration date on file');
      } else if (expDate < today) {
        issues.push(reportLabel + ': ' + name + ' \u2014 expired ' + expDate);
      }
    } else {
      const present = getPlainText(page.properties['Present']);
      if (!present) {
        issues.push(reportLabel + ': ' + name + ' \u2014 missing');
      }
    }
  });
  return issues;
}

async function checkPhysicalEnvironment(location, today) {
  const result = await queryDatabase(PHYSICAL_ENV_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const issues = [];
  (result.results || []).forEach(function (page) {
    const name = getPlainText(page.properties['Item Name']);
    if (name === 'General Notes') return;

    const itemType = getPlainText(page.properties['Item Type']);
    if (itemType === 'Expiration Date') {
      const expDate = getPlainText(page.properties['Current Exp Date']);
      if (!expDate) {
        issues.push('Physical Environment: ' + name + ' \u2014 no expiration date on file');
      } else if (expDate < today) {
        issues.push('Physical Environment: ' + name + ' \u2014 expired ' + expDate);
      }
    } else if (itemType === 'Checklist') {
      const present = getPlainText(page.properties['Present']);
      if (!present) {
        issues.push('Physical Environment: ' + name + ' \u2014 missing');
      }
    } else if (itemType === 'Numeric Reading') {
      const val = (page.properties['Numeric Value'] && page.properties['Numeric Value'].number !== null)
        ? page.properties['Numeric Value'].number
        : null;
      if (val === null) {
        issues.push('Physical Environment: ' + name + ' \u2014 no reading recorded');
      } else {
        const range = PE_RANGES[name];
        if (range && ((range.min !== undefined && val < range.min) || (range.max !== undefined && val > range.max))) {
          issues.push('Physical Environment: ' + name + ' \u2014 ' + val + '\u00b0F is outside the expected range');
        }
      }
    }
  });
  return issues;
}

async function buildAdminDigests(today) {
  const adminsResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, null);
  const admins = (adminsResult.results || []).filter(function (p) {
    return getPlainText(p.properties['Admin App Enabled']);
  });

  const digests = [];

  for (const adminPage of admins) {
    const name = getPlainText(adminPage.properties['Name']);
    const email = getPlainText(adminPage.properties['Email']);
    const grantedLocations = (getPlainText(adminPage.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!email || !grantedLocations.length) continue;

    const sections = [];
    for (const location of grantedLocations) {
      const issues = [].concat(
        await checkSimpleReport(FIRST_AID_DB_ID, location, 'First Aid Supplies', today),
        await checkSimpleReport(EMERGENCY_SUPPLIES_DB_ID, location, 'Emergency Supplies', today),
        await checkPhysicalEnvironment(location, today)
      );
      sections.push({ location: location, issues: issues });
    }

    digests.push({ name: name, email: email, sections: sections });
  }

  return digests;
}

function digestToText(digest, dateLabel) {
  const header = '<strong>ASRS Weekly Compliance Check — ' + dateLabel + '</strong><br><br>';
  return header + digest.sections.map(function (s) {
    return '<strong>' + s.location + ':</strong><br>' +
      (s.issues.length ? s.issues.map(function (i) { return '- ' + i; }).join('<br>') : 'No issues found.');
  }).join('<br><br>');
}

// options: { dryRun: boolean, asOf: "YYYY-MM-DD" }
async function runAdminDigestCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const today = todayISO(now);
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const digests = await buildAdminDigests(today);
  const results = [];

  for (const digest of digests) {
    const subject = 'ASRS Weekly Compliance Check \u2014 ' + dateLabel;
    const message = digestToText(digest, dateLabel);

    if (options.dryRun) {
      results.push({ admin: digest.name, email: digest.email, subject: subject, message: message });
    } else {
      await sendEmail(digest.email, digest.name, subject, message);
      results.push({ admin: digest.name, email: digest.email, sent: true });
      await sleep(1100); // EmailJS is rate-limited to 1 request/second
    }
  }

  return { dryRun: !!options.dryRun, simulatedAsOf: options.asOf || null, results: results };
}

module.exports = { runAdminDigestCheck };
