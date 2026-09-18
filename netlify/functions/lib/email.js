// EmailJS server-side sending. Requires "Allow API calls from
// non-browser applications" enabled in EmailJS Account -> Security,
// and a template with (at minimum) merge fields: to_email, to_name,
// subject, message. Rate-limited to 1 request/second by EmailJS, so
// callers sending multiple emails should space them out.
async function sendEmail(toEmail, toName, subject, message) {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: toEmail,
        to_name: toName,
        subject: subject,
        message: message
      }
    })
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error('EmailJS error ' + res.status + ': ' + text);
  }
  return text;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

module.exports = { sendEmail, sleep };
