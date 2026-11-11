const isp = require('./lib/isp-training');
const { staffInfoById } = require('./lib/staff-training');
const { dateInName } = require('./lib/drive-documents');

// Zapier-facing, last step of the ISP Training Acknowledgment workflow,
// after the signed PDF is filed: records the training (ISP Training row)
// for the person, resident and plan date in the tracking value. The
// signature in the tracking value is the proof. Recorded for the plan date
// they signed, even if the plan has since been revised.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const t = isp.parseTracking(body.tracking || '');
    if (!t) return { statusCode: 400, body: JSON.stringify({ error: 'Not a valid ISP training tracking value.' }) };
    const member = await staffInfoById(t.staffId);
    const plan = (await isp.currentPlan(member.location, t.resident)) || {};
    const trainedDate = dateInName(String(body.signedDate || '')) || isp.todayEastern();
    await isp.recordTraining(member, { resident: t.resident, planDate: t.planDate, revised: plan.planDate === t.planDate && plan.revised }, {
      trainedDate: trainedDate,
      trainedBy: body.trainedBy || '',
      filename: body.filename || '',
      fileUrl: body.fileId ? 'https://drive.google.com/file/d/' + body.fileId + '/view' : '',
      recordedBy: 'JotForm (signed acknowledgment)'
    });
    return { statusCode: 200, body: JSON.stringify({ success: true, staffName: member.name, resident: t.resident, planDate: t.planDate }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
