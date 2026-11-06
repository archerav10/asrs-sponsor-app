const { sendSms } = require('./lib/twilio');
const { sendEmail } = require('./lib/email');
const send = require('./lib/training-modules-send');

// Background function (the "-background" suffix gives it 15 minutes).
// Only runs with a job ticket from lib/training-modules-send.js:
//   assign     a big Assign from the dashboard (admin-assign-modules)
//   reminders  the weekday reminder run (module-reminders)
exports.handler = async function (event) {
  let job;
  try {
    job = send.readJobTicket(JSON.parse(event.body || '{}').ticket);
  } catch (e) {
    console.error('Training module job refused: ' + e.message);
    return;
  }
  const deps = { sendSms: sendSms, sendEmail: sendEmail };
  try {
    if (job.job === 'assign') {
      const plan = await send.planAssignments(job);
      const results = await send.carryOutPlan(plan, job, deps);
      console.log('Training module assign finished: ' + JSON.stringify(results.map(function (r) { return { name: r.name, channel: r.channel, error: r.error }; })));
    } else if (job.job === 'reminders') {
      const summary = await send.runReminders(deps, { site: job.site });
      console.log('Training module reminders finished: ' + JSON.stringify(summary));
    }
  } catch (e) {
    console.error('Training module ' + job.job + ' job failed', e);
  }
};
