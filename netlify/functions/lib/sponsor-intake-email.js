const { sendEmail } = require('./email');
const {
  stageFor,
  statusPageUrl,
  sponsorActionUrl,
  sponsorActionLabel,
  siteBaseUrl
} = require('./sponsor-intake');

// Every intake email goes through its own EmailJS template
// (EMAILJS_INTAKE_TEMPLATE_ID) whose body is just {{{message}}} — triple
// braces, so EmailJS passes this HTML through unescaped. The whole
// branded layout is built here, the same "template stays dumb" idea as
// the weekly digest.
const FOREST = '#16332B';
const CREAM = '#F6F3EC';
const BORDER = '#D8D2C2';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function button(url, label) {
  return '<a href="' + esc(url) + '" style="display:inline-block;background:' + FOREST + ';color:#ffffff;' +
    'text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;border-radius:6px;white-space:nowrap">' +
    esc(label) + '</a>';
}

function layout(bodyHtml, intake) {
  return '<div style="background:' + CREAM + ';padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#1C1C1A">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ' + BORDER + ';border-radius:10px;overflow:hidden">' +
    '<div style="background:' + FOREST + ';color:' + CREAM + ';padding:18px 24px">' +
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">ASRS</div>' +
    '<div style="font-size:19px;font-weight:600">Sponsor Intake</div></div>' +
    '<div style="padding:24px;font-size:15px;line-height:1.55">' + bodyHtml + '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid ' + BORDER + ';font-size:13px;color:#5E5B52">' +
    'Check your intake progress anytime: <a href="' + esc(statusPageUrl(intake)) + '" style="color:' + FOREST + ';font-weight:600">View my intake status</a><br>' +
    'Questions? Just reply to this email.</div>' +
    '</div></div>';
}

function itemRow(intake, step, returnReason) {
  let detail = '';
  if (step.includes && step.includes.length) {
    detail += '<div style="font-size:13px;color:#5E5B52;margin-top:4px">Includes: ' + step.includes.map(esc).join('; ') + '</div>';
  }
  if (returnReason) {
    detail += '<div style="font-size:13px;color:#9A3412;margin-top:4px"><strong>Please resubmit:</strong> ' + esc(returnReason) + '</div>';
  }
  return '<tr><td style="padding:12px 0;border-bottom:1px solid ' + BORDER + ';vertical-align:middle">' +
    '<div style="font-weight:600">' + esc(step.label) + '</div>' + detail + '</td>' +
    '<td style="padding:12px 0 12px 12px;border-bottom:1px solid ' + BORDER + ';text-align:right;vertical-align:middle">' +
    button(sponsorActionUrl(intake, step), sponsorActionLabel(step)) + '</td></tr>';
}

// items: [{ step, returnReason }]
function requestEmail(cl, intake, items, note) {
  const stageNums = items.map(function (i) { return i.step.stage; });
  const stage = stageFor(cl, Math.min.apply(null, stageNums));
  const count = items.length;
  const subject = 'Action needed: ' + count + ' item' + (count === 1 ? '' : 's') + ' for your ASRS sponsor intake';

  let body = '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#2F5D45;font-weight:700">Stage ' +
    stage.position + ' of ' + cl.stages.length + ' · ' + esc(stage.name) + '</p>' +
    '<p style="margin:0 0 14px">Hi ' + esc(firstName(intake.name)) + ',</p>' +
    '<p style="margin:0 0 14px">To keep your intake moving, please complete the ' + (count === 1 ? 'item' : count + ' items') +
    ' below. Each button opens a short, secure page for that one item.</p>';
  if (note) {
    body += '<p style="margin:0 0 14px;padding:12px 14px;background:' + CREAM + ';border-radius:8px">' + esc(note).replace(/\n/g, '<br>') + '</p>';
  }
  body += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">' +
    items.map(function (i) { return itemRow(intake, i.step, i.returnReason); }).join('') +
    '</table>';

  return { subject: subject, html: layout(body, intake) };
}

function welcomeEmail(intake, note) {
  let body = '<p style="margin:0 0 14px">Hi ' + esc(firstName(intake.name)) + ',</p>' +
    '<p style="margin:0 0 14px">Welcome to the ASRS sponsor intake process. We\'ll email you whenever we need something from you, ' +
    'and each email will have a button for every item.</p>' +
    '<p style="margin:0 0 18px">You can follow your progress at any time on your private status page. Please don\'t share this link.</p>';
  if (note) {
    body += '<p style="margin:0 0 18px;padding:12px 14px;background:' + CREAM + ';border-radius:8px">' + esc(note).replace(/\n/g, '<br>') + '</p>';
  }
  body += '<p style="margin:0">' + button(statusPageUrl(intake), 'View my intake status') + '</p>';
  return { subject: 'Your ASRS sponsor intake status page', html: layout(body, intake) };
}

async function sendToSponsor(intake, email) {
  const templateId = process.env.EMAILJS_INTAKE_TEMPLATE_ID;
  if (!templateId) {
    const err = new Error('Intake emails are not configured yet (EMAILJS_INTAKE_TEMPLATE_ID).');
    err.statusCode = 500;
    throw err;
  }
  await sendEmail(intake.email, intake.name, email.subject, email.html, {
    templateId: templateId,
    params: { reply_to: process.env.SPONSOR_INTAKE_REPLY_TO || '' }
  });
}

// Heads-up to SPONSOR_INTAKE_NOTIFY_EMAILS when a sponsor submits
// something. Best-effort: a failed notification never fails the
// sponsor's upload.
async function notifyAdmins(intake, step) {
  const templateId = process.env.EMAILJS_INTAKE_TEMPLATE_ID;
  const recipients = (process.env.SPONSOR_INTAKE_NOTIFY_EMAILS || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  if (!templateId || !recipients.length) return;

  const subject = intake.name + ' submitted ' + step.key + ' ' + step.label;
  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1C1C1A">' +
    '<p><strong>' + esc(intake.name) + '</strong> submitted <strong>' + esc(step.key + ' ' + step.label) + '</strong>.</p>' +
    '<p>It\'s in their Drive folder and marked <em>Received</em>. Review it and accept or return it from the ' +
    '<a href="' + esc(siteBaseUrl() + '/admin-dashboard/') + '">admin dashboard</a> (Sponsor Intake tab).</p></div>';

  for (let i = 0; i < recipients.length; i++) {
    try {
      await sendEmail(recipients[i], '', subject, html, { templateId: templateId });
    } catch (e) {
      console.error('Intake admin notification failed for ' + recipients[i], e);
    }
    if (i < recipients.length - 1) await new Promise(function (r) { setTimeout(r, 1100); }); // EmailJS: 1 request/second
  }
}

module.exports = { requestEmail, welcomeEmail, sendToSponsor, notifyAdmins };
