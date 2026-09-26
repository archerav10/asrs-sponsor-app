// Mirrors the client-side computeDueDate/status logic used on Home for
// First Aid Supplies, Fire Drill, Emergency Supplies, and Physical
// Environment (MAR has its own rolling-period logic in mar-period.js).
// `now` is optional and defaults to the real current time — only the
// test/simulation endpoint ever passes something else.
function computeDueDate(lastReviewedISO, now) {
  if (lastReviewedISO) {
    const base = new Date(lastReviewedISO + 'T00:00:00');
    return new Date(base.getFullYear(), base.getMonth() + 2, 0);
  }
  now = now || new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

// Shared red/yellow/green bucketing used everywhere a "how soon is this
// due" traffic light is computed — a report already overdue is red, due
// within a week is yellow, otherwise green.
function statusForDaysUntilDue(daysUntilDue) {
  if (daysUntilDue < 0) return 'red';
  if (daysUntilDue <= 7) return 'yellow';
  return 'green';
}

function statusForDueDate(lastReviewedISO, dueDate, now) {
  if (!lastReviewedISO) return 'red';
  now = now || new Date();
  return statusForDaysUntilDue(Math.ceil((dueDate.getTime() - now.getTime()) / 86400000));
}

// First Aid Supplies and Emergency Supplies don't run on the monthly
// cadence above — they only need attention when something is actually
// set to expire. Due date is one week before the earliest expiration
// among items with Tracks Expiration checked and a real Current Exp
// Date; null means nothing is currently expiring, so no review is due.
// Mirrored client-side in provider-app/index.html's earliestExpirationDueDate.
function computeSupplyDueDate(items) {
  const expDates = (items || [])
    .filter(function (i) { return i.tracksExpiration && i.currentExpDate; })
    .map(function (i) { return new Date(i.currentExpDate + 'T00:00:00'); });
  if (!expDates.length) return null;
  const earliest = new Date(Math.min.apply(null, expDates));
  earliest.setDate(earliest.getDate() - 7);
  return earliest;
}

// Same thresholds as statusForDueDate, but dueDate may be null (nothing
// expiring) — that's green as long as it's been reviewed at least once;
// never-reviewed still reads red regardless of what's expiring.
function statusForSupplyDueDate(lastReviewedISO, dueDate, now) {
  if (!lastReviewedISO) return 'red';
  if (!dueDate) return 'green';
  now = now || new Date();
  return statusForDaysUntilDue(Math.ceil((dueDate.getTime() - now.getTime()) / 86400000));
}

// Aggregates a list of individual red/yellow/green statuses down to one —
// used by the provider app's read-only Annual Planning/Quarterly
// Reporting/Staff Training rows, each of which rolls up several services
// or several staff members into a single dot.
function worstOf(statuses) {
  if (statuses.indexOf('red') !== -1) return 'red';
  if (statuses.indexOf('yellow') !== -1) return 'yellow';
  return 'green';
}

module.exports = {
  computeDueDate,
  statusForDueDate,
  computeSupplyDueDate,
  statusForSupplyDueDate,
  statusForDaysUntilDue,
  worstOf
};
