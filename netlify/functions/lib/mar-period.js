// MAR reviews are forward-looking: during any given month, staff review
// and finalize NEXT month's medications (delivered near month-end). The
// "target period" is whichever month still needs finalizing — normally
// next month, but if even the current month was never finalized, it
// snaps back to catch up on that instead (so lateness is visible rather
// than silently skipped).
//
// lastFinalizedPeriod: "YYYY-MM" string or falsy if never finalized.
// Returns { targetPeriod: "YYYY-MM", dueDate: Date (last day of the
// month before targetPeriod, at local midnight) }.
function computeMarTarget(lastFinalizedPeriod) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let target = currentMonthStart;
  if (lastFinalizedPeriod) {
    const parts = lastFinalizedPeriod.split('-');
    const lfYear = parseInt(parts[0], 10);
    const lfMonth = parseInt(parts[1], 10) - 1;
    const afterFinalized = new Date(lfYear, lfMonth + 1, 1);
    target = afterFinalized > currentMonthStart ? afterFinalized : currentMonthStart;
  }

  const dueDate = new Date(target.getFullYear(), target.getMonth(), 0); // last day of the month before target
  const targetPeriod = target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0');

  return { targetPeriod: targetPeriod, dueDate: dueDate };
}

module.exports = { computeMarTarget };
