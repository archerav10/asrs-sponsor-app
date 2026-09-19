// MAR reviews are forward-looking: during any given month, staff review
// and finalize NEXT month's medications (delivered near month-end). The
// "target period" is whichever month still needs finalizing — normally
// next month, but if even the current month was never finalized, it
// snaps back to catch up on that instead (so lateness is visible rather
// than silently skipped).
//
// The due date defaults to the literal last day of the month, but how
// many days before month-end it actually lands is configurable via
// MAR_DUE_DATE_OFFSET_DAYS (unset/0 = current behavior, end of month;
// 2 = two days before end of month, etc.) — a Netlify env var rather
// than a code constant so it can be tuned without a redeploy. This
// shifts windowOpenDate along with it, since that's computed as
// dueDate minus 7 (see lib/mar-review-state.js).
const DUE_DATE_OFFSET_DAYS = parseInt(process.env.MAR_DUE_DATE_OFFSET_DAYS, 10) || 0;

// lastFinalizedPeriod: "YYYY-MM" string or falsy if never finalized.
// `now` is optional and defaults to the real current time — only the
// test/simulation endpoint ever passes something else.
// Returns { targetPeriod: "YYYY-MM", dueDate: Date (at local midnight) }.
function computeMarTarget(lastFinalizedPeriod, now) {
  now = now || new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let target = currentMonthStart;
  if (lastFinalizedPeriod) {
    const parts = lastFinalizedPeriod.split('-');
    const lfYear = parseInt(parts[0], 10);
    const lfMonth = parseInt(parts[1], 10) - 1;
    const afterFinalized = new Date(lfYear, lfMonth + 1, 1);
    target = afterFinalized > currentMonthStart ? afterFinalized : currentMonthStart;
  }

  const dueDate = new Date(target.getFullYear(), target.getMonth(), -DUE_DATE_OFFSET_DAYS);
  const targetPeriod = target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0');

  return { targetPeriod: targetPeriod, dueDate: dueDate };
}

module.exports = { computeMarTarget };
