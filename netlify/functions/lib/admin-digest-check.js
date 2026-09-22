const { queryDatabase, getPlainText } = require('./notion');
const { sendEmail, sleep } = require('./email');
const { staffListForLocation, itemsForStaff, fullStepList } = require('./staff-training');
const { DEFAULT_SERVICE, findRecordsForResident, computeAnnualPlanningWindow } = require('./annual-planning');

const ADMIN_ACCOUNTS_DB_ID = process.env.ADMIN_ACCOUNTS_DB_ID;
const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;
const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID;
const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID;
const MAR_DB_ID = process.env.MAR_DB_ID;

// Deliberately its own number, separate from Staff Training's own
// WINDOW_DAYS_BEFORE_DUE (30 days — when the puzzle turns yellow on the
// dashboard). The weekly email is meant as an earlier-catching backstop
// for the small number of items that are ACTUALLY close, not a mirror
// of the dashboard's UI state.
const STAFF_TRAINING_EXPIRING_DAYS = 10;

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

function daysBetween(fromISO, toISO) {
  const ms = new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00');
  return Math.round(ms / 86400000);
}

// One item per line, same granularity as First Aid/Emergency Supplies —
// except a staff member who hasn't started at all collapses to a single
// line rather than 19 near-identical "not completed" entries.
async function checkStaffTraining(location, today) {
  const staff = await staffListForLocation(location);

  const perMember = await Promise.all(staff.map(async function (member) {
    const items = await itemsForStaff(location, member.name);
    const steps = fullStepList(items);
    const missing = steps.filter(function (s) { return !s.done || !s.expDate; });

    if (missing.length === steps.length) {
      return ['Staff Training: ' + member.name + ' — no items completed yet (0/' + steps.length + ')'];
    }

    const issues = [];
    steps.forEach(function (s) {
      if (!s.done || !s.expDate) {
        issues.push('Staff Training: ' + member.name + ' — ' + s.label + ': not completed');
        return;
      }
      if (s.expDate < today) {
        issues.push('Staff Training: ' + member.name + ' — ' + s.label + ': expired ' + s.expDate);
        return;
      }
      const daysOut = daysBetween(today, s.expDate);
      if (daysOut <= STAFF_TRAINING_EXPIRING_DAYS) {
        issues.push('Staff Training: ' + member.name + ' — ' + s.label + ': expires ' + s.expDate + ' (in ' + daysOut + ' day' + (daysOut === 1 ? '' : 's') + ')');
      }
    });
    return issues;
  }));

  return [].concat.apply([], perMember);
}

// Same resident/service enumeration as get-annual-planning-oversight.js
// (duplicated rather than shared — this file already keeps each check
// self-contained the same way lib/report-status-check.js does).
async function residentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const set = new Set();
  (result.results || []).forEach(function (page) {
    const initials = getPlainText(page.properties['Resident Initials']);
    if (initials) set.add(initials);
  });
  return Array.from(set).sort();
}

// Only flags residents whose window is actually open right now (the
// same "puzzle turned yellow, steps are clickable" signal the dashboard
// shows) — not every resident's full status, since a locked/gray card
// isn't actionable yet and a finalized one needs nothing further.
async function checkAnnualPlanning(location, now) {
  const residents = await residentsForLocation(location);

  const perResident = await Promise.all(residents.map(async function (resident) {
    const records = await findRecordsForResident(location, resident);
    const byService = {};
    records.forEach(function (r) { byService[r.service] = r; });

    const servicesToShow = [DEFAULT_SERVICE].concat(
      Object.keys(byService).filter(function (s) { return s !== DEFAULT_SERVICE; }).sort()
    );

    const issues = [];
    servicesToShow.forEach(function (service) {
      const record = byService[service] || null;
      const windowState = computeAnnualPlanningWindow(record, now);
      const label = resident + (service === DEFAULT_SERVICE ? '' : ' (' + service + ')');

      if (!windowState.hasCycle) {
        issues.push('Annual Planning: ' + label + ' — no cycle on file yet');
      } else if (windowState.isWindowOpen && !windowState.isFinalizedForTarget) {
        const dueDate = windowState.dueDate.toISOString().slice(0, 10);
        issues.push('Annual Planning: ' + label + ' — window open, due ' + dueDate);
      }
    });
    return issues;
  }));

  return [].concat.apply([], perResident);
}

// Admins commonly share granted locations (e.g. two admins who both
// cover every location) — memoize each location's issue list per run so
// it's computed once no matter how many admins ask for it, instead of
// re-querying Notion from scratch per admin. Storing the in-flight
// Promise (not just its resolved value) is what makes this safe when
// two admins' builds ask for the same location concurrently.
function makeLocationIssuesCache(today, now) {
  const cache = new Map();
  return function issuesForLocation(location) {
    if (!cache.has(location)) {
      cache.set(location, Promise.all([
        checkSimpleReport(FIRST_AID_DB_ID, location, 'First Aid Supplies', today),
        checkSimpleReport(EMERGENCY_SUPPLIES_DB_ID, location, 'Emergency Supplies', today),
        checkPhysicalEnvironment(location, today),
        checkStaffTraining(location, today),
        checkAnnualPlanning(location, now)
      ]).then(function (results) { return [].concat.apply([], results); }));
    }
    return cache.get(location);
  };
}

async function buildAdminDigests(today, now) {
  const adminsResult = await queryDatabase(ADMIN_ACCOUNTS_DB_ID, null);
  const admins = (adminsResult.results || []).filter(function (p) {
    return getPlainText(p.properties['Admin App Enabled']);
  });

  const issuesForLocation = makeLocationIssuesCache(today, now);

  // Admins themselves also build concurrently — each one just fans out
  // to issuesForLocation, which dedupes the actual Notion work above.
  const digests = await Promise.all(admins.map(async function (adminPage) {
    const name = getPlainText(adminPage.properties['Name']);
    const email = getPlainText(adminPage.properties['Email']);
    const grantedLocations = (getPlainText(adminPage.properties['Granted Locations']) || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!email || !grantedLocations.length) return null;

    const issuesByLocation = await Promise.all(grantedLocations.map(issuesForLocation));
    const sections = grantedLocations.map(function (location, i) {
      return { location: location, issues: issuesByLocation[i] };
    });

    return { name: name, email: email, sections: sections };
  }));

  return digests.filter(Boolean);
}

function digestToText(digest, dateLabel) {
  const header = 'ASRS Weekly Compliance Check — ' + dateLabel + '\n\n';
  return header + digest.sections.map(function (s) {
    return s.location.toUpperCase() + ':\n' +
      (s.issues.length ? s.issues.map(function (i) { return '- ' + i; }).join('\n') : 'No issues found.');
  }).join('\n\n');
}

// options: { dryRun: boolean, asOf: "YYYY-MM-DD" }
async function runAdminDigestCheck(options) {
  options = options || {};
  const now = options.asOf ? new Date(options.asOf + 'T00:00:00') : new Date();
  const today = todayISO(now);
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const digests = await buildAdminDigests(today, now);
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
