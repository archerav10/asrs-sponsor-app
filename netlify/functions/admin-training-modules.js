const { requireSession } = require('./lib/session');
const tm = require('./lib/training-modules');

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
    const assignments = (await tm.listAssignments())
      .filter(function (a) { return granted.indexOf(a.location) >= 0; })
      .map(function (a) {
        return {
          id: a.id, moduleTitle: titles[a.moduleId.replace(/-/g, '')] || '(module removed)',
          personName: a.personName, role: a.role, location: a.location, status: a.status,
          overdue: a.status !== 'Completed' && a.status !== 'Cancelled' && !!a.dueDate && a.dueDate.slice(0, 10) < today,
          assignedDate: a.assignedDate, dueDate: a.dueDate, completedAt: a.completedAt, channel: a.channel,
          certificateId: a.certificateId, certificateStatus: a.certificateStatus,
          canResend: tm.canResendCertificate(a, Date.now()),
          remindersSent: a.remindersSent, lastReminder: a.lastReminder, needsFollowUp: a.needsFollowUp,
          reviewed: a.reviewed
        };
      })
      .sort(function (a, b) { return String(b.assignedDate).localeCompare(String(a.assignedDate)); });

    return json(200, { modules: published, people: people, assignments: assignments, locations: granted });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
