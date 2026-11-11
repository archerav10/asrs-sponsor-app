const { parseTracking, currentPlan, formUrl, usDate } = require('./lib/isp-training');
const { staffInfoById } = require('./lib/staff-training');

// Opens the ISP Training Acknowledgment for a signing link
// (/isp/{tracking}, see netlify.toml): checks the link was made by the app
// and is still for the resident's current plan, then sends the browser to
// the JotForm with the staff member, resident and plan filled in. No login:
// the link itself is the pass, and it can only record that one person's
// training on that one plan.
function page(status, title, text) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    body: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>ISP Training Acknowledgment</title><style>body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2433;background:#f5f6f8;margin:0;padding:40px 16px}' +
      'main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #dfe3e9;border-radius:12px;padding:22px}h1{font-size:20px;margin:0 0 8px;color:#1f3a5f}</style></head>' +
      '<body><main><h1>' + title + '</h1><p>' + text + '</p></main></body></html>'
  };
}

exports.handler = async function (event) {
  try {
    const tracking = parseTracking((event.queryStringParameters || {}).t || '');
    if (!tracking) return page(404, 'Link not recognized', 'This signing link isn\'t valid. Please ask ASRS for a new one.');

    const member = await staffInfoById(tracking.staffId);
    const plan = await currentPlan(member.location, tracking.resident);
    if (!plan || plan.planDate !== tracking.planDate) {
      return page(410, 'This plan has been updated', 'This link was for ' + tracking.resident + '\'s plan of ' + usDate(tracking.planDate) +
        ', which isn\'t the current one any more. Please ask ASRS for a new link.');
    }
    return { statusCode: 302, headers: { Location: formUrl(member, plan), 'Cache-Control': 'no-store' }, body: '' };
  } catch (err) {
    console.error(err);
    return page(500, 'Something went wrong', 'The acknowledgment couldn\'t be opened just now. Please try again in a minute.');
  }
};
