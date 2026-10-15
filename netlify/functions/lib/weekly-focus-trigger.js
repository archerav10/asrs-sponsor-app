const { encryptToken, decryptToken } = require('./crypto');

// Scheduled functions get only 30 seconds, and the Weekly Focus emails go
// out one per second (EmailJS's limit), so the scheduled functions (and
// the dashboard's "Send now") just hand the work to
// weekly-focus-run-background, which gets 15 minutes. The hand-off
// carries a short-lived encrypted job ticket, so nobody else can start a
// send by calling the background function's URL.
const JOB_KIND = 'weekly-focus-job';

async function startJob(job, siteUrl, extra) {
  const base = (siteUrl || process.env.URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('No site URL to start the Weekly Focus job on.');
  const ticket = encryptToken(Object.assign({ kind: JOB_KIND, job: job }, extra || {}), 10 * 60);
  const res = await fetch(base + '/.netlify/functions/weekly-focus-run-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: ticket })
  });
  // Background functions answer 202 Accepted straight away.
  if (res.status !== 202 && !res.ok) {
    throw new Error('Could not start the Weekly Focus ' + job + ' job (HTTP ' + res.status + ').');
  }
  return { started: true, job: job };
}

function readJobTicket(ticket) {
  const payload = decryptToken(ticket || '');
  if (payload.kind !== JOB_KIND) throw new Error('Not a Weekly Focus job ticket.');
  return payload;
}

module.exports = { startJob, readJobTicket };
