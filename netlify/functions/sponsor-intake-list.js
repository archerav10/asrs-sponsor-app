const { requireIntakeAdmin, PROCESSES, loadChecklist, listIntakes, itemsForIntake, pipelineSummary, json, errorResponse } = require('./lib/sponsor-intake');

// Pipeline view for the admin dashboard's Intake tab: every active intake
// (Sponsor and DSP) with its current stage and what it's waiting on.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireIntakeAdmin(event);
    const names = Object.keys(PROCESSES);
    const lists = await Promise.all(names.map(function (name) { return loadChecklist({ fresh: true, process: name }); }));
    const checklists = {};
    const problems = [];
    names.forEach(function (name, i) {
      checklists[name] = lists[i];
      lists[i].problems.forEach(function (p) { problems.push(PROCESSES[name].title + ': ' + p); });
    });

    const intakes = await listIntakes();
    const rows = await Promise.all(intakes.map(async function (intake) {
      const items = await itemsForIntake(intake.id);
      return Object.assign(pipelineSummary(checklists[intake.process], intake, items), {
        process: intake.process,
        processTitle: PROCESSES[intake.process].title
      });
    }));
    rows.sort(function (a, b) { return (b.startedDate || '').localeCompare(a.startedDate || ''); });
    return json(200, { intakes: rows, checklistProblems: problems });
  } catch (err) {
    return errorResponse(err);
  }
};
