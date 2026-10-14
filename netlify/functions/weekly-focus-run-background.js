const { readJobTicket } = require('./lib/weekly-focus-trigger');
const { runWeeklySend, runReminders } = require('./lib/weekly-focus-jobs');

// Background function (the "-background" suffix gives it 15 minutes).
// Only runs with a job ticket from lib/weekly-focus-trigger.js — see
// weekly-focus-send.js, weekly-focus-reminders.js and the dashboard's
// Send now.
exports.handler = async function (event) {
  let job;
  try {
    job = readJobTicket(JSON.parse(event.body || '{}').ticket);
  } catch (e) {
    console.error('Weekly Focus job refused: ' + e.message);
    return;
  }

  try {
    const result = job.job === 'send'
      ? await runWeeklySend({ weekOf: job.weekOf, force: !!job.force })
      : await runReminders({ weekOf: job.weekOf });
    console.log('Weekly Focus ' + job.job + ' finished: ' + JSON.stringify(result));
  } catch (e) {
    console.error('Weekly Focus ' + job.job + ' failed', e);
  }
};
