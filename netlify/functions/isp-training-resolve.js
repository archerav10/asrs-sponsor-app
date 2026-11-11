const isp = require('./lib/isp-training');
const { staffInfoById, driveFolderIdFromUrl } = require('./lib/staff-training');

// Zapier-facing, step 1 of the ISP Training Acknowledgment workflow: given
// the submission's tracking value (ISP_…, see lib/isp-training.js), says
// where the signed PDF goes: the staff member's Training folder, under a
// name the Drive check recognizes. The signature in the tracking value is
// the proof, so no secret lives in Zapier. folderId is '' when the person
// has no Training folder yet; the workflow then leaves the PDF in the
// staging folder.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const t = isp.parseTracking(body.tracking || body.filename || '');
    if (!t) return { statusCode: 400, body: JSON.stringify({ error: 'Not a valid ISP training tracking value.' }) };
    const member = await staffInfoById(t.staffId);
    const trainedDate = isp.todayEastern();
    return {
      statusCode: 200,
      body: JSON.stringify({
        folderId: driveFolderIdFromUrl(member.trainingFolderUrl) || '',
        filename: isp.evidenceFilename(member, { resident: t.resident }, trainedDate),
        staffName: member.name,
        resident: t.resident
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
