const lz = require('./lib/liaison');
const qn = require('./lib/questionnaires');

// The Liaison section of the home screen for the selected home: on-site
// visit and weekly call status (and any draft in progress), plus the
// resident interview and sponsor/DSP questionnaire status per resident.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = lz.requireLiaison(event);
    const location = session.location;
    const today = lz.easternDate();
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    const [home, visits, responses, links, staff] = await Promise.all([
      lz.homeInfo(location),
      lz.visitsForLocation(location),
      qn.responsesForLocation(location),
      qn.activeLinks(),
      require('./lib/training-modules').staffAtLocations([location]).catch(function () { return []; })
    ]);

    const visitDraft = lz.findDraft(visits, lz.TYPES.visit, session.email);
    const callDraft = lz.findDraft(visits, lz.TYPES.call, session.email);
    const staffAudience = home.homeType === 'Group Home' ? 'DSP' : 'Sponsor';

    const questionnaires = [];
    residents.forEach(function (r) {
      ['Resident', staffAudience].forEach(function (audience) {
        const st = qn.monthStatus(responses, audience, r, today, lz.previousPeriod);
        questionnaires.push({ audience: audience, resident: r, status: st.status, last: st.last, available: !!qn.pickLink(links, location, audience) });
      });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        grantedLocations: session.grantedLocations,
        homeType: home.homeType,
        homeLocationSet: home.lat != null && home.lng != null,
        residents: residents,
        staff: staff.map(function (p) { return { name: p.name, role: p.role }; }),
        visit: Object.assign(lz.visitStatus(visits, today), { draftId: visitDraft ? visitDraft.id : null, template: lz.visitTemplateFor(home) }),
        call: Object.assign(lz.callStatus(visits, today), { draftId: callDraft ? callDraft.id : null }),
        questionnaires: questionnaires
      })
    };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
