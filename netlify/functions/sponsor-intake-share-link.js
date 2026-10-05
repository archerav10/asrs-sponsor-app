const {
  loadChecklist, findIntakeByToken, itemsForIntake, adminFormLink, STATUS, json, errorResponse
} = require('./lib/sponsor-intake');

// The sponsor's "Get link to send" page for a Send to Someone Else step
// (e.g. a reference check). ?t=<status token>&step=<key>. Returns the
// JotForm link the sponsor passes on. That link carries only the
// app_filename tracking field and the sponsor's name — never the status
// token — so whoever receives it can't see the sponsor's intake.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    const intake = await findIntakeByToken(params.t);
    if (!intake) return json(404, { error: 'This link isn\'t valid. Check the link in your most recent ASRS email.' });
    const step = (await loadChecklist()).byKey[params.step];
    if (!step) return json(400, { error: 'That link is missing which item it\'s for.' });

    const info = {
      sponsorName: intake.name,
      stepKey: step.key,
      label: step.label,
      includes: step.includes,
      canShare: false,
      shareUrl: '',
      returnReason: '',
      message: ''
    };

    const item = (await itemsForIntake(intake.id))[step.key];
    const status = item ? item.status : '';
    if (!step.shareForm) {
      info.message = step.type === 'form' || step.type === 'upload'
        ? 'This item isn\'t one you send to someone else. Use the button in your ASRS email to complete it.'
        : 'ASRS handles this item. There\'s nothing for you to do.';
    } else if (status === STATUS.RECEIVED) {
      info.message = 'We\'ve received this one and it\'s being reviewed. There\'s nothing else you need to do.';
    } else if (status === STATUS.COMPLETE) {
      info.message = 'This item is complete. Thank you!';
    } else if (status === STATUS.NOT_APPLICABLE) {
      info.message = 'This item doesn\'t apply to you' + (item.naReason ? ': ' + item.naReason : '.');
    } else if (status !== STATUS.REQUESTED && status !== STATUS.RETURNED) {
      info.message = 'We haven\'t asked for this item yet. We\'ll email you when it\'s needed.';
    } else {
      info.canShare = true;
      info.shareUrl = adminFormLink(intake, step);
      info.returnReason = status === STATUS.RETURNED ? (item.returnReason || '') : '';
    }

    return json(200, info);
  } catch (err) {
    return errorResponse(err);
  }
};
