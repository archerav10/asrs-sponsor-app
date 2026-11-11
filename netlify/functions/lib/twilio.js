const https = require('https');

function sendSms(to, body) {
  return new Promise(function (resolve, reject) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    const params = new URLSearchParams({
      To: to,
      Body: body,
      MessagingServiceSid: messagingServiceSid
    }).toString();

    const auth = Buffer.from(accountSid + ':' + authToken).toString('base64');

    const req = https.request({
      hostname: 'api.twilio.com',
      path: '/2010-04-01/Accounts/' + accountSid + '/Messages.json',
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params)
      }
    }, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error('Twilio error ' + res.statusCode + ': ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

// US numbers to E.164. Anything else that already starts with + is kept.
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.charAt(0) === '+') return '+' + s.slice(1).replace(/\D/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return '';
}

module.exports = { sendSms, normalizePhone };
