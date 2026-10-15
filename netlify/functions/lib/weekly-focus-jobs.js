const { sendEmail, sleep } = require('./email');
const { sendSms } = require('./twilio');
const { allEnabledAdmins } = require('./notification-recipients');
const wf = require('./weekly-focus');
const mail = require('./weekly-focus-email');
const sms = require('./weekly-focus-sms');

// Sponsors who've opted in to texts (and have a number on file) get the
// Weekly Focus as a text they answer by replying 1, 2 or 3, instead of
// the email. Everyone else gets the email.
function channelFor(sponsor) {
  return sponsor.smsOptedIn && sponsor.phone ? 'Text' : 'Email';
}

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

// options: { weekOf, dryRun, now }
// Each sponsor gets the Ready row addressed to them (see
// rowsForSponsor). Sponsors with no Ready row are skipped. Afterwards
// every admin gets one text listing who it went to and who was skipped,
// so a forgotten sponsor never goes unnoticed. Safe to re-run: a sponsor
// who already has this week's response row is skipped, which is also what
// lets a row marked Ready after Tuesday morning go out with Send now.
async function runWeeklySend(options) {
  options = options || {};
  const now = options.now || new Date();
  const weekOf = options.weekOf || wf.weekOfFor(now);
  const contents = await wf.contentsForWeek(weekOf);
  const sponsors = await wf.activeSponsors();
  const existing = await wf.responsesForWeek(weekOf);
  const alreadyHave = new Set(existing.map(function (r) { return r.sponsorEmail.toLowerCase(); }));
  const results = [];
  const usedRows = new Set();
  const sentTo = [], skipped = [], duplicates = [], failed = [];

  for (const sponsor of sponsors) {
    if (alreadyHave.has(sponsor.email.toLowerCase())) {
      results.push({ sponsor: sponsor.name, skipped: 'already-sent' });
      continue;
    }
    const rows = wf.rowsForSponsor(contents, sponsor.id);
    if (!rows.length) {
      skipped.push(sponsor.name);
      results.push({ sponsor: sponsor.name, skipped: 'no-ready-row' });
      continue;
    }
    if (rows.length > 1) duplicates.push(sponsor.name);
    const content = rows[0];
    const entry = { sponsor: sponsor.name, email: sponsor.email, row: content.focusTitle || content.id };
    try {
      const history = await wf.responsesForSponsor(sponsor.email);
      const previous = history.filter(function (r) { return r.weekOf < weekOf; })[0] || null;
      const channel = channelFor(sponsor);
      const checklist = wf.buildChecklist(content, previous, channel);
      entry.channel = channel;
      entry.carriedOver = checklist.filter(function (i) { return i.fromWeek !== weekOf; }).length;

      if (channel === 'Text') {
        const text = sms.weeklySms(sponsor, content, checklist);
        if (options.dryRun) {
          entry.text = text;
          entry.segments = sms.segmentCount(text);
        } else {
          // Docs Behind isn't in the text, so it isn't worth the lookup.
          await wf.createResponse(sponsor, weekOf, content.id, checklist, 0, 'Text');
          usedRows.add(content.id);
          await sendSms(sponsor.phone, text);
          entry.texted = true;
        }
      } else {
        const docStatus = await wf.documentationStatus(sponsor.location, sponsor.residentInitials, now);
        const docsBehind = wf.countDocsBehind(docStatus);
        const email = mail.weeklyEmail(sponsor, content, checklist, docsBehind);
        entry.docsBehind = docsBehind;
        if (options.dryRun) {
          entry.subject = email.subject;
        } else {
          // The row first: if the email then fails, the sponsor can still
          // check in from the app, and a re-run won't double-send.
          await wf.createResponse(sponsor, weekOf, content.id, checklist, docsBehind, 'Email');
          usedRows.add(content.id);
          await sendHtmlEmail(sponsor.email, sponsor.name, email);
          entry.emailed = true;
          await sleep(1100); // EmailJS: 1 request/second
        }
      }
      sentTo.push(sponsor.name);
    } catch (e) {
      console.error('Weekly Focus send failed for ' + sponsor.email, e);
      entry.error = e.message;
      failed.push(sponsor.name);
    }
    results.push(entry);
  }

  const summary = { sentTo: sentTo, skipped: skipped, duplicates: duplicates, failed: failed };
  if (!options.dryRun) {
    for (const id of usedRows) {
      try { await wf.markContentSent(id); } catch (e) { console.error('Could not mark ' + id + ' sent', e); }
    }
    // Only worth a text when something happened or someone was missed —
    // a re-run that found nothing new stays quiet.
    if (sentTo.length || skipped.length || failed.length) {
      const admins = await allEnabledAdmins();
      for (const admin of admins) {
        try { await sendSms(admin.phone, mail.sendSummaryText(weekOf, summary)); } catch (e) { console.error('Send summary failed for ' + admin.name, e); }
      }
    }
  }
  return Object.assign({ weekOf: weekOf, dryRun: !!options.dryRun, results: results }, summary);
}

// Thursday morning: one reminder to every sponsor still Pending for this
// week, the same way the week went out (a text for a text week, an email
// for an email week).
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
    const byText = response.channel === 'Text' && !!sponsor.phone;
    const entry = { sponsor: sponsor.name, channel: byText ? 'Text' : 'Email' };
    if (options.dryRun) {
      if (byText) entry.text = sms.reminderSms(sponsor, weekOf);
      results.push(entry);
      continue;
    }
    try {
      if (byText) {
        await sendSms(sponsor.phone, sms.reminderSms(sponsor, weekOf));
        entry.texted = true;
      } else {
        await sendHtmlEmail(sponsor.email, sponsor.name, mail.reminderEmail(sponsor, weekOf));
        entry.emailed = true;
        await sleep(1100);
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

module.exports = { runWeeklySend, runReminders, channelFor };
