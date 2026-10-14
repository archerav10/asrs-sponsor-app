const { sendEmail, sleep } = require('./email');
const { sendSms } = require('./twilio');
const { allEnabledAdmins } = require('./notification-recipients');
const wf = require('./weekly-focus');
const mail = require('./weekly-focus-email');

// Tuesday send and Thursday reminder. Both are safe to re-run: the send
// skips any sponsor who already has a row for that week, and the reminder
// marks each row once it's sent. Every sponsor is handled independently,
// so one bad email address or phone number never stops the rest.

function templateId() {
  const id = process.env.EMAILJS_INTAKE_TEMPLATE_ID;
  if (!id) throw new Error('EMAILJS_INTAKE_TEMPLATE_ID is not set (the Weekly Focus email uses the same raw-HTML template as Sponsor Intake).');
  return id;
}

async function sendHtmlEmail(toEmail, toName, email) {
  await sendEmail(toEmail, toName, email.subject, email.html, {
    templateId: templateId(),
    params: { reply_to: process.env.WEEKLY_FOCUS_REPLY_TO || process.env.SPONSOR_INTAKE_REPLY_TO || '' }
  });
}

// options: { weekOf, dryRun, now, force }
//   force — send even though the content row is already marked Sent
//   (still never sends twice to the same sponsor).
async function runWeeklySend(options) {
  options = options || {};
  const now = options.now || new Date();
  const weekOf = options.weekOf || wf.weekOfFor(now);
  const content = await wf.contentForWeek(weekOf);

  if (!content || !content.ready) {
    const result = { weekOf: weekOf, sent: false, reason: content ? 'not-ready' : 'no-content' };
    if (!options.dryRun) {
      const admins = await allEnabledAdmins();
      for (const admin of admins) {
        try { await sendSms(admin.phone, mail.noContentText(weekOf)); } catch (e) { console.error('No-content alert failed for ' + admin.name, e); }
      }
      result.adminsAlerted = admins.length;
    }
    return result;
  }
  if (content.sent && !options.force) {
    return { weekOf: weekOf, sent: false, reason: 'already-sent' };
  }

  const sponsors = await wf.activeSponsors();
  const existing = await wf.responsesForWeek(weekOf);
  const alreadyHave = new Set(existing.map(function (r) { return r.sponsorEmail.toLowerCase(); }));
  const results = [];

  for (const sponsor of sponsors) {
    if (alreadyHave.has(sponsor.email.toLowerCase())) {
      results.push({ sponsor: sponsor.name, skipped: 'already-sent' });
      continue;
    }
    const entry = { sponsor: sponsor.name, email: sponsor.email };
    try {
      const history = await wf.responsesForSponsor(sponsor.email);
      const previous = history.filter(function (r) { return r.weekOf < weekOf; })[0] || null;
      const checklist = wf.buildChecklist(content, previous);
      const docStatus = await wf.documentationStatus(sponsor.location, sponsor.residentInitials, now);
      const docsBehind = wf.countDocsBehind(docStatus);
      const email = mail.weeklyEmail(sponsor, content, checklist, docsBehind);
      entry.carriedOver = checklist.filter(function (i) { return i.fromWeek !== weekOf; }).length;
      entry.docsBehind = docsBehind;

      if (options.dryRun) {
        entry.subject = email.subject;
        entry.wouldText = sponsor.smsOptedIn && !!sponsor.phone;
      } else {
        // The row first: if the email then fails, the sponsor can still
        // check in from the app, and a re-run won't double-send.
        await wf.createResponse(sponsor, weekOf, checklist, docsBehind);
        await sendHtmlEmail(sponsor.email, sponsor.name, email);
        entry.emailed = true;
        await sleep(1100); // EmailJS: 1 request/second
        if (sponsor.smsOptedIn && sponsor.phone) {
          try {
            await sendSms(sponsor.phone, mail.weeklyText(sponsor, weekOf));
            entry.texted = true;
          } catch (e) {
            entry.textError = e.message;
          }
        }
      }
    } catch (e) {
      console.error('Weekly Focus send failed for ' + sponsor.email, e);
      entry.error = e.message;
    }
    results.push(entry);
  }

  if (!options.dryRun) await wf.markContentSent(content.id);
  return { weekOf: weekOf, sent: !options.dryRun, dryRun: !!options.dryRun, results: results };
}

// Thursday morning: one reminder (email, plus a text if they've opted
// in) to every sponsor still Pending for this week.
async function runReminders(options) {
  options = options || {};
  const now = options.now || new Date();
  const weekOf = options.weekOf || wf.weekOfFor(now);
  const pending = (await wf.responsesForWeek(weekOf)).filter(function (r) {
    return r.status === 'Pending' && !r.reminderSent;
  });
  const sponsors = await wf.activeSponsors();
  const byEmail = {};
  sponsors.forEach(function (s) { byEmail[s.email.toLowerCase()] = s; });

  const results = [];
  for (const response of pending) {
    const sponsor = byEmail[response.sponsorEmail.toLowerCase()];
    if (!sponsor) {
      results.push({ sponsor: response.sponsorName, skipped: 'no-longer-active' });
      continue;
    }
    const entry = { sponsor: sponsor.name };
    if (options.dryRun) {
      entry.wouldEmail = true;
      entry.wouldText = sponsor.smsOptedIn && !!sponsor.phone;
      results.push(entry);
      continue;
    }
    try {
      await sendHtmlEmail(sponsor.email, sponsor.name, mail.reminderEmail(sponsor, weekOf));
      entry.emailed = true;
      await sleep(1100);
      if (sponsor.smsOptedIn && sponsor.phone) {
        try { await sendSms(sponsor.phone, mail.reminderText(sponsor, weekOf)); entry.texted = true; } catch (e) { entry.textError = e.message; }
      }
      await wf.markReminderSent(response.id);
    } catch (e) {
      console.error('Weekly Focus reminder failed for ' + sponsor.email, e);
      entry.error = e.message;
    }
    results.push(entry);
  }
  return { weekOf: weekOf, dryRun: !!options.dryRun, results: results };
}

module.exports = { runWeeklySend, runReminders };
