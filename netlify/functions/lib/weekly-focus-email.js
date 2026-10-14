const { formatWeekLabel, dueDateFor, addDaysISO } = require('./weekly-focus');

// The Tuesday Weekly Focus email and the texts that go with it. Same
// branded layout as the Sponsor Intake emails (forest header, logo,
// cream background) and sent through the same EmailJS template, whose
// body is just {{{message}}}. Deliberately carries no resident details —
// those live behind the sponsor app login.
const FOREST = '#16332B';
const FOREST_LIGHT = '#2F5D45';
const CREAM = '#F6F3EC';
const BORDER = '#D8D2C2';
const MUTED = '#5E5B52';

const SIGNATURE_NAME = 'Anthony Archer';
const SIGNATURE_TITLE = 'Executive Director';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function baseUrl() {
  return (process.env.WEEKLY_FOCUS_BASE_URL || process.env.URL || 'https://asrs-sponsor-app.netlify.app').replace(/\/+$/, '');
}

// Opens the sponsor app straight to this week's check-in (after login),
// with the tapped answer preselected.
function checkInUrl(weekOf, status) {
  return baseUrl() + '/provider-app/?weekly=' + encodeURIComponent(weekOf) + (status ? '&status=' + status.toLowerCase() : '');
}

function dayLabel(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function kicker(text, color) {
  return '<p style="margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:' + (color || FOREST_LIGHT) + ';font-weight:700">' + esc(text) + '</p>';
}

function ragButton(url, label, bg, fg) {
  return '<a href="' + esc(url) + '" style="display:block;background:' + bg + ';color:' + fg + ';text-decoration:none;font-weight:600;font-size:15px;padding:12px 16px;border-radius:8px;margin:0 0 8px">&#9679;&nbsp; ' + esc(label) + '</a>';
}

// docsBehind: number of the sponsor's residents whose Daily Progress
// Notes are behind (a count only — never names).
function weeklyEmail(sponsor, content, checklist, docsBehind) {
  const weekLabel = formatWeekLabel(content.weekOf);
  const endLabel = formatWeekLabel(addDaysISO(content.weekOf, 6));
  const dueLabel = dayLabel(dueDateFor(content.weekOf)).split(',')[0];

  let body = '<p style="margin:0 0 14px">Good morning ' + esc(firstName(sponsor.name)) + ',</p>' +
    '<p style="margin:0 0 18px">Thank you for everything you do for the people in your home. Here\'s what we\'re focusing on this week.</p>';

  if (content.quote) {
    body += '<div style="background:' + CREAM + ';border-left:4px solid ' + FOREST_LIGHT + ';border-radius:6px;padding:16px 18px;margin:0 0 22px">' +
      '<div style="font-family:Georgia,\'Times New Roman\',serif;font-style:italic;font-size:18px;line-height:1.45;color:' + FOREST + '">&ldquo;' + esc(content.quote) + '&rdquo;</div>' +
      (content.quoteAuthor ? '<div style="font-size:13px;color:' + MUTED + ';margin-top:6px">&mdash; ' + esc(content.quoteAuthor) + '</div>' : '') +
      '</div>';
  }

  if (content.focusTitle || content.focusMessage) {
    body += kicker('Focus of the week') +
      (content.focusTitle ? '<p style="margin:0 0 6px;font-size:17px;font-weight:600">' + esc(content.focusTitle) + '</p>' : '') +
      (content.focusMessage ? '<p style="margin:0 0 22px">' + esc(content.focusMessage).replace(/\n/g, '<br>') + '</p>' : '<div style="height:16px"></div>');
  }

  if (checklist.length) {
    body += kicker('Your checklist this week') +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 22px">' +
      checklist.map(function (item, i) {
        const carried = item.fromWeek && item.fromWeek !== content.weekOf;
        return '<tr><td style="width:28px;padding:9px 0;border-bottom:1px solid ' + BORDER + ';vertical-align:top;color:' + FOREST_LIGHT + ';font-weight:700">' + (i + 1) + '</td>' +
          '<td style="padding:9px 0;border-bottom:1px solid ' + BORDER + '">' + esc(item.text) +
          (carried ? '<div style="font-size:12px;color:#9A5B0E;margin-top:2px">Still open from the week of ' + esc(formatWeekLabel(item.fromWeek)) + '</div>' : '') +
          '</td></tr>';
      }).join('') +
      '</table>';
  }

  body += kicker('Daily documentation check');
  if (docsBehind > 0) {
    body += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;margin:0 0 22px;background:#FBF3D6;border:1px solid #EAD9A0;border-radius:8px"><tr><td style="padding:14px 16px">' +
      '<div style="font-weight:600;color:#6B5200">&#9888; ' + docsBehind + ' resident' + (docsBehind === 1 ? '\'s' : 's\'') + ' notes need attention</div>' +
      '<div style="font-size:14px;color:' + MUTED + ';margin-top:4px">Please catch up and sign any missing daily notes. You\'ll see the details after signing in.</div>' +
      '</td></tr></table>';
  } else {
    body += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;margin:0 0 22px;background:#E3F1E7;border:1px solid #BCDCC6;border-radius:8px"><tr><td style="padding:14px 16px">' +
      '<div style="font-weight:600;color:#1B7A3D">&#10003; All caught up &mdash; thank you!</div>' +
      '</td></tr></table>';
  }

  body += kicker('Check in with me') +
    '<p style="margin:0 0 22px">Is there anything management should know about? Need help with something, or have a question? You can tell me on your check-in page.</p>';

  body += '<div style="border:2px solid ' + FOREST + ';border-radius:10px;padding:18px 18px 12px;margin:0 0 8px">' +
    kicker('Response required by ' + dueLabel, '#B3261E') +
    '<p style="margin:0 0 14px;font-size:14px;color:' + MUTED + '">How is your week going? Tap one. You\'ll sign in securely to confirm and add any notes.</p>' +
    ragButton(checkInUrl(content.weekOf, 'Green'), 'All good', '#1B7A3D', '#ffffff') +
    ragButton(checkInUrl(content.weekOf, 'Yellow'), 'I need to discuss something', '#C9A227', '#1C1C1A') +
    ragButton(checkInUrl(content.weekOf, 'Red'), 'Please contact me ASAP', '#B3261E', '#ffffff') +
    '</div>' +
    '<p style="margin:14px 0 0">Thank you,<br><strong>' + esc(SIGNATURE_NAME) + '</strong><br>' +
    '<span style="font-size:14px;color:' + MUTED + '">' + esc(SIGNATURE_TITLE) + '<br>Arch Support Residential Services</span></p>';

  const html = '<div style="background:' + CREAM + ';padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#1C1C1A">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ' + BORDER + ';border-radius:10px;overflow:hidden">' +
    '<div style="background:' + FOREST + ';padding:18px 24px">' +
    '<table role="presentation" cellspacing="0" cellpadding="0"><tr>' +
    '<td style="vertical-align:middle;padding-right:14px"><img src="' + esc(baseUrl() + '/intake/logo.jpg') + '" width="62" height="56" alt="ASRS" style="display:block;border:0;border-radius:3px"></td>' +
    '<td style="vertical-align:middle">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#C9D8CF">Sponsored Residential</div>' +
    '<div style="font-size:21px;font-weight:600;color:' + CREAM + '">Weekly Focus</div>' +
    '<div style="font-size:13px;color:#C9D8CF">Week of ' + esc(weekLabel) + ' &ndash; ' + esc(endLabel) + '</div>' +
    '</td></tr></table></div>' +
    '<div style="padding:24px;font-size:15px;line-height:1.55">' + body + '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid ' + BORDER + ';font-size:13px;color:' + MUTED + ';line-height:1.5">' +
    'For your privacy, resident details are only shown in the secure ASRS Sponsor App. Please don\'t reply with resident names or health information.<br>' +
    'In an emergency, call 911 first.</div>' +
    '</div></div>';

  return { subject: 'Your Weekly Focus · Week of ' + weekLabel, html: html };
}

function reminderEmail(sponsor, weekOf) {
  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1C1C1A">' +
    '<p>Hi ' + esc(firstName(sponsor.name)) + ',</p>' +
    '<p>Friendly reminder: your Weekly Focus check-in for the week of ' + esc(formatWeekLabel(weekOf)) + ' is due today. It only takes a couple of minutes.</p>' +
    '<p><a href="' + esc(checkInUrl(weekOf)) + '" style="display:inline-block;background:' + FOREST + ';color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">Open my weekly check-in</a></p>' +
    '<p>Thank you,<br>' + esc(SIGNATURE_NAME) + '</p></div>';
  return { subject: 'Reminder: Weekly Focus check-in due today', html: html };
}

// Never includes the sponsor's comment: texts aren't the place for
// anything that might mention a resident. The admin reads it in the
// dashboard.
function redAlertText(response) {
  return 'ASRS Weekly Focus: ' + response.sponsorName + ' (' + response.location + ') answered "Please contact me ASAP"' + (response.channel === 'Text' ? ' by text' : '') + '. Please call them. Details: ' +
    baseUrl() + '/admin-dashboard/';
}

// One text to admins after each send: who got it, who didn't.
function sendSummaryText(weekOf, summary) {
  const parts = ['ASRS Weekly Focus, week of ' + formatWeekLabel(weekOf) + ':'];
  parts.push(summary.sentTo.length ? 'Sent to ' + summary.sentTo.join(', ') + '.' : 'Nothing was sent.');
  if (summary.skipped.length) parts.push('No Ready row for: ' + summary.skipped.join(', ') + '. Add one and use Send now on the dashboard if they should get one.');
  if (summary.failed.length) parts.push('Failed for: ' + summary.failed.join(', ') + ' (see the dashboard).');
  if (summary.duplicates.length) parts.push('More than one Ready row for: ' + summary.duplicates.join(', ') + ' (the first was used).');
  return parts.join(' ');
}

module.exports = { weeklyEmail, reminderEmail, redAlertText, sendSummaryText, checkInUrl, baseUrl };
