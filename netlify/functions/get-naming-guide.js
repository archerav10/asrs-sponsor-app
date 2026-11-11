const { requireSession } = require('./lib/session');
const { loadRequirements } = require('./lib/staff-training');
const { STEPS } = require('./lib/annual-planning');
const { LEGACY_CODES } = require('./lib/drive-documents');
const quarterly = require('./lib/quarterly-reporting');
const { APPOINTMENT_TYPES } = require('./lib/medical-appointments');
const { PROCESSES, loadChecklist, stageFor } = require('./lib/sponsor-intake');

// Data for the dashboard's File Naming Guide (admin-dashboard/
// naming-guide.html): the document codes a hand-placed Drive file can
// use, read live from each checklist, so a new Training Requirements or
// Intake Steps row shows up here as soon as it's added in Notion.
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
    const quarterlyReporting = quarterly.STEPS.map(function (s) { return { code: s.key, label: s.label }; });
    const medical = APPOINTMENT_TYPES.map(function (t) { return { code: t.key, label: t.label }; });
    const intake = [];
    for (const name of Object.keys(PROCESSES)) {
      try {
        const cl = await loadChecklist({ fresh: true, process: name });
        intake.push({
          title: PROCESSES[name].title,
          steps: cl.steps.map(function (st) {
            const stage = stageFor(cl, st.stage);
            return { key: st.key, label: st.label, stage: stage ? stage.position + ' · ' + stage.name : 'Other' };
          })
        });
      } catch (e) {
        console.error('Naming guide: ' + name + ' intake checklist failed', e);
      }
    }
    const legacy = Object.keys(LEGACY_CODES).map(function (old) { return { old: old, code: LEGACY_CODES[old] }; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        staffTraining: staffTraining, annualPlanning: annualPlanning, quarterlyReporting: quarterlyReporting,
        medical: medical, intake: intake, legacy: legacy, problems: checklist.problems || []
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
