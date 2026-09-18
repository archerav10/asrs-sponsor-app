// Mirrors the client-side computeDueDate/status logic used on Home for
// First Aid Supplies, Fire Drill, Emergency Supplies, and Physical
// Environment (MAR has its own rolling-period logic in mar-period.js).
function computeDueDate(lastReviewedISO) {
  if (lastReviewedISO) {
    const base = new Date(lastReviewedISO + 'T00:00:00');
    return new Date(base.getFullYear(), base.getMonth() + 2, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

function statusForDueDate(lastReviewedISO, dueDate) {
  if (!lastReviewedISO) return 'red';
  const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
  if (daysUntilDue < 0) return 'red';
  if (daysUntilDue <= 7) return 'yellow';
  return 'green';
}

module.exports = { computeDueDate, statusForDueDate };
