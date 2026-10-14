const { formatWeekLabel } = require('./weekly-focus');

// The text-message version of the Weekly Focus, for sponsors whose SMS
// Consent Status is Opted In (everyone else gets the email). Plain text
// on purpose: no emoji keeps every character in the GSM-7 alphabet, so
// it bills as about 3 segments instead of 6, and looks the same on every
// phone. Sponsors answer by replying 1, 2 or 3 (see sms-inbound.js).
// Like the email, it never carries resident details.

const SIGNATURE = '- Anthony Archer, ASRS';
const CONTACT_NAME = 'Anthony';

const CHOICES = [
  { reply: '1', status: 'Green', label: 'All good' },
  { reply: '2', status: 'Yellow', label: 'I need to discuss something' },
  { reply: '3', status: 'Red', label: 'Please call me ASAP' }
];

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

// Curly quotes, dashes and the like aren't in GSM-7; one of them would
// switch the whole message to UCS-2 and double its cost.
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[•·]/g, '-')
    .trim();
}

// Wrapped in double quotes, so any quote inside it becomes single.
function quoteText(q) {
  let t = plain(q);
  if (t.length > 1 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') t = t.slice(1, -1);
  return t.replace(/"/g, "'");
}

function choicesBlock() {
  return CHOICES.map(function (c) { return c.reply + ' = ' + c.label; }).join('\n');
}

function weeklySms(sponsor, content, checklist) {
  const lines = ['ASRS WEEKLY FOCUS - ' + formatWeekLabel(content.weekOf), '', 'Good morning ' + plain(firstName(sponsor.name)) + ','];
  if (content.quote) {
    lines.push('', '"' + quoteText(content.quote) + '"' + (content.quoteAuthor ? ' - ' + plain(content.quoteAuthor) : ''));
  }
  if (content.focusTitle || content.focusMessage) {
    lines.push('');
    if (content.focusTitle) lines.push('THIS WEEK: ' + plain(content.focusTitle));
    if (content.focusMessage) lines.push(plain(content.focusMessage));
  }
  if (checklist && checklist.length) {
    lines.push('', 'TO DO:');
    checklist.forEach(function (item) { lines.push('- ' + plain(item.text)); });
  }
  lines.push('', 'How is your week? Reply with a number:', choicesBlock(), '', SIGNATURE);
  return lines.join('\n');
}

function reminderSms(sponsor, weekOf) {
  return 'ASRS reminder: Hi ' + plain(firstName(sponsor.name)) + ', we haven\'t heard back on this week\'s Weekly Focus (' + formatWeekLabel(weekOf) + '). ' +
    'Please reply with a number:\n' + choicesBlock();
}

function confirmationSms(sponsor, status) {
  if (status === 'Green') return 'Thank you, ' + plain(firstName(sponsor.name)) + '! Recorded as: All good. Have a great week. - ASRS';
  if (status === 'Yellow') return 'Thank you. Recorded as: I need to discuss something. ' + CONTACT_NAME + ' will reach out within 1 business day. You can reply with a short note if you like (please no resident names).';
  return 'Got it. ' + CONTACT_NAME + ' has been alerted and will call you shortly. If anyone is in danger, call 911.';
}

const NOTE_THANKS = 'Thank you, your note was added. ' + CONTACT_NAME + ' will see it. - ASRS';
const CLOSED = 'Thanks for your message. There\'s no open Weekly Focus check-in right now. If you need anything, please call ' + CONTACT_NAME + ' directly. If anyone is in danger, call 911.';

const SORRY = 'Sorry, we couldn\'t record that just now. Please try again in a few minutes, or call ' + CONTACT_NAME + '.';

function promptSms() {
  return 'Sorry, we didn\'t catch that. Please reply with just the number:\n' + choicesBlock();
}

// "1", " 2.", "3!" -> the choice; anything else -> null.
function parseChoice(body) {
  const m = String(body || '').trim().match(/^([123])[\s.!)]*$/);
  if (!m) return null;
  return CHOICES.filter(function (c) { return c.reply === m[1]; })[0];
}

// Twilio's own opt-out/opt-in/help keywords. Twilio answers these itself
// (and stops/starts delivery); the app only mirrors the consent status.
const OPT_OUT = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'];
const OPT_IN = ['START', 'UNSTOP', 'YES', 'OPTIN'];
const HELP = ['HELP', 'INFO'];

function keywordOf(body) {
  const word = String(body || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (OPT_OUT.indexOf(word) !== -1) return 'optOut';
  if (OPT_IN.indexOf(word) !== -1) return 'optIn';
  if (HELP.indexOf(word) !== -1) return 'help';
  return null;
}

// Last 10 digits, so "+1 (804) 555-0100" and "8045550100" match.
function normPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// GSM-7 = 160 characters (153 once split); anything outside it (emoji,
// curly quotes) = 70 (67 once split).
const GSM = /^[\n\r -~£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà]*$/;
function segmentCount(text) {
  const gsm = GSM.test(text);
  let len = Array.from(text).length;
  if (gsm) len += (text.match(/[\^{}\\[\]~|]/g) || []).length; // escaped characters count twice
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return len <= single ? 1 : Math.ceil(len / multi);
}

module.exports = {
  CHOICES,
  weeklySms,
  reminderSms,
  confirmationSms,
  promptSms,
  NOTE_THANKS,
  CLOSED,
  SORRY,
  parseChoice,
  keywordOf,
  normPhone,
  segmentCount,
  plain
};
