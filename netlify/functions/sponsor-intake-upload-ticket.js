const { encryptToken } = require('./lib/crypto');
const {
  requireIntakeAdmin, loadChecklist, getIntake, findIntakeByToken, itemsForIntake, STATUS,
  isSponsorStep, json, errorResponse
} = require('./lib/sponsor-intake');

const TICKET_TTL_SECONDS = 2 * 60 * 60;

// Hands the browser what it needs to upload one item straight to Drive
// via Zapier (same "file bytes never pass through a Netlify function"
// pattern as every other upload here) — but instead of a Drive folder
// ID, it gets a short-lived encrypted ticket naming the intake + step.
// The Zap trades that ticket for the real folder names at
// sponsor-intake-resolve-upload, so a leaked webhook URL alone can't
// write anywhere.
//
// Two callers:
//   sponsor — ?t=<status token>&step=<key>, from the single-item upload
//             page; only for sponsor items currently Requested/Returned
//   admin   — ?id=<intake id>&step=<key> with a dashboard session; any step
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    const step = (await loadChecklist()).byKey[params.step];
    if (!step) return json(400, { error: 'That link is missing which item it\'s for.' });

    let intake;
    let role;
    let by;
    if (params.t) {
      intake = await findIntakeByToken(params.t);
      if (!intake) return json(404, { error: 'This link isn\'t valid. Check the link in your most recent ASRS email.' });
      role = 'sponsor';
      by = 'Sponsor';
    } else {
      const session = requireIntakeAdmin(event);
      if (!params.id) return json(400, { error: 'id is required.' });
      intake = await getIntake(params.id);
      role = 'admin';
      by = session.name || session.email;
    }

    const info = {
      sponsorName: intake.name,
      stepKey: step.key,
      label: step.label,
      includes: step.includes,
      canUpload: true,
      message: ''
    };

    if (role === 'sponsor') {
      const item = (await itemsForIntake(intake.id))[step.key];
      const status = item ? item.status : '';
      info.returnReason = status === STATUS.RETURNED ? item.returnReason : '';
      if (!isSponsorStep(step)) {
        info.canUpload = false;
        info.message = 'ASRS handles this item — there\'s nothing for you to upload.';
      } else if (status === STATUS.RECEIVED) {
        info.canUpload = false;
        info.message = 'We\'ve received this item and it\'s being reviewed. There\'s nothing else you need to do.';
      } else if (status === STATUS.COMPLETE) {
        info.canUpload = false;
        info.message = 'This item is complete. Thank you!';
      } else if (status !== STATUS.REQUESTED && status !== STATUS.RETURNED) {
        info.canUpload = false;
        info.message = 'We haven\'t asked for this item yet. We\'ll email you when it\'s needed.';
      }
    }

    if (info.canUpload) {
      const webhookUrl = process.env.ZAPIER_SPONSOR_INTAKE_WEBHOOK_URL;
      if (!webhookUrl) return json(500, { error: 'Uploads are not configured yet. Please try again later.' });
      info.webhookUrl = webhookUrl;
      info.ticket = encryptToken({ kind: 'intake-upload', intakeId: intake.id, stepKey: step.key, role: role, by: by }, TICKET_TTL_SECONDS);
    }

    return json(200, info);
  } catch (err) {
    return errorResponse(err);
  }
};
