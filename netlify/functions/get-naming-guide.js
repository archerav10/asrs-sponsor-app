const { requireSession } = require('./lib/session');
const { loadRequirements } = require('./lib/staff-training');
const { STEPS } = require('./lib/annual-planning');
const { LEGACY_CODES } = require('./lib/drive-documents');

// Data for the dashboard's File Naming Guide (admin-dashboard/
// naming-guide.html): the document codes a hand-placed Drive file can
// use, read live from each checklist, so a new Training Requirements row
// shows up here as soon as it's added in Notion.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const checklist = await loadRequirements({ fresh: true });
    const staffTraining = checklist.requirements.map(function (r) {
      return { code: r.key, label: r.label, part: r.part, section: r.section, appliesTo: r.appliesTo, renewYears: r.renewYears };
    });
    const annualPlanning = STEPS.map(function (s) { return { code: s.key, label: s.label }; });
    const legacy = Object.keys(LEGACY_CODES).map(function (old) { return { old: old, code: LEGACY_CODES[old] }; });

    return {
      statusCode: 200,
      body: JSON.stringify({ staffTraining: staffTraining, annualPlanning: annualPlanning, legacy: legacy, problems: checklist.problems || [] })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
