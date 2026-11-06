const { requireSession } = require('./lib/session');
const tm = require('./lib/training-modules');
const tp = require('./lib/training-paths');

// Admin Dashboard -> Training Modules: the modules that can be assigned,
// the staff at the admin's granted locations, and every assignment there.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return json(403, { error: 'Not authorized for the admin dashboard.' });
    }
    const granted = session.grantedLocations || [];

    const modules = await tm.listModules();
    const published = [];
    for (const m of modules.filter(function (x) { return x.status === 'Published'; })) {
      const full = await tm.loadModule(m.id);
      published.push({ id: m.id, title: m.title, key: m.key, minutes: m.minutes, appliesTo: m.appliesTo, version: m.version, problems: full.problems });
    }

    const people = (await tm.staffAtLocations(granted)).map(function (p) {
      return { id: p.id, name: p.name, role: p.role, location: p.location, hasPhone: !!tm.normalizePhone(p.phone), hasEmail: !!p.email, smsConsent: p.smsConsent, hasFolder: !!p.trainingFolderUrl };
    });

    const titles = {};
    modules.forEach(function (m) { titles[m.id.replace(/-/g, '')] = m.title; });
    const today = tm.todayIso();
    const allPaths = await tp.listPaths();
    const pathTitles = {};
    allPaths.forEach(function (x) { pathTitles[x.id.replace(/-/g, '')] = x.title; });
    const paths = [];
    for (const x of allPaths.filter(function (y) { return y.status === 'Published'; })) {
      const full = await tp.loadPath(x.id);
      paths.push({ id: x.id, title: x.title, appliesTo: x.appliesTo, steps: full.steps.map(function (st) { return { title: st.mod.title, days: st.days }; }), problems: full.problems });
    }

    const allModuleRows = (await tm.listAssignments()).filter(function (a) { return granted.indexOf(a.location) >= 0; });
    const pathAssignments = (await tp.listPathAssignments())
      .filter(function (pa) { return granted.indexOf(pa.location) >= 0; })
      .map(function (pa) {
        const rows = allModuleRows.filter(function (a) { return tm.sameId(a.pathAssignmentId, pa.id); })
          .sort(function (x, y) { return (x.pathStep || 0) - (y.pathStep || 0); });
        const current = rows.find(function (a) { return a.status === 'Assigned' || a.status === 'In Progress'; });
        const asAssignment = Object.assign({}, pa, { status: pa.status });
        return {
          id: pa.id, pathTitle: pathTitles[pa.pathId.replace(/-/g, '')] || '(path removed)',
          personName: pa.personName, role: pa.role, location: pa.location, status: pa.status,
          assignedDate: pa.assignedDate, completedAt: pa.completedAt,
          steps: pa.steps || rows.length, done: rows.filter(function (a) { return a.status === 'Completed'; }).length,
          current: current ? { title: titles[current.moduleId.replace(/-/g, '')] || '', dueDate: current.dueDate, step: current.pathStep,
            overdue: !!current.dueDate && current.dueDate.slice(0, 10) < today } : null,
          certificateId: pa.certificateId, certificateStatus: pa.certificateStatus,
          canResend: pa.status === 'Completed' && tm.canResendCertificate(asAssignment, Date.now())
        };
      })
      .sort(function (a, b) { return String(b.assignedDate).localeCompare(String(a.assignedDate)); });
    const pathOf = {};
    pathAssignments.forEach(function (pa) { pathOf[pa.id.replace(/-/g, '')] = pa; });

    const assignments = allModuleRows
      .filter(function (a) { return a.status !== 'Locked'; })
      .map(function (a) {
        return {
          id: a.id, moduleTitle: titles[a.moduleId.replace(/-/g, '')] || '(module removed)',
          personName: a.personName, role: a.role, location: a.location, status: a.status,
          overdue: a.status !== 'Completed' && a.status !== 'Cancelled' && !!a.dueDate && a.dueDate.slice(0, 10) < today,
          assignedDate: a.assignedDate, dueDate: a.dueDate, completedAt: a.completedAt, channel: a.channel,
          certificateId: a.certificateId, certificateStatus: a.certificateStatus,
          canResend: tm.canResendCertificate(a, Date.now()),
          remindersSent: a.remindersSent, lastReminder: a.lastReminder, needsFollowUp: a.needsFollowUp,
          reviewed: a.reviewed,
          pathTitle: a.pathAssignmentId ? ((pathOf[a.pathAssignmentId.replace(/-/g, '')] || {}).pathTitle || 'a path') : '',
          pathStep: a.pathStep, pathSteps: a.pathAssignmentId ? ((pathOf[a.pathAssignmentId.replace(/-/g, '')] || {}).steps || null) : null
        };
      })
      .sort(function (a, b) { return String(b.assignedDate).localeCompare(String(a.assignedDate)); });

    return json(200, { modules: published, paths: paths, people: people, assignments: assignments, pathAssignments: pathAssignments, locations: granted });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
