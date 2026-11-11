const { requireSession } = require('./lib/session');
const isp = require('./lib/isp-training');
const { staffListForLocation } = require('./lib/staff-training');
const { normalizePhone } = require('./lib/twilio');

// One resident's ISP training: the plan staff need to be trained on and
// every active staff member at the location with their status, signing
// link and acknowledgment. Used by the Annual Planning screen's ISP
// training panel and the printable ISP Training Record.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const params = event.queryStringParameters || {};
    const location = params.location;
    const resident = params.resident;
    if (!location || !resident) return { statusCode: 400, body: JSON.stringify({ error: 'location and resident are required.' }) };
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const context = await isp.contextForLocation(location, { fresh: true });
    const plan = context.plans.find(function (p) { return p.resident === resident; }) || null;
    if (!plan) return { statusCode: 200, body: JSON.stringify({ location: location, resident: resident, plan: null, staff: [] }) };

    const site = isp.siteFor(event);
    const staff = (await staffListForLocation(location)).map(function (member) {
      const row = isp.rowFor(context.rows, plan, member);
      return {
        id: member.id,
        name: member.name,
        role: member.roleSet ? member.role : '',
        state: isp.statusFor(plan, row, new Date()),
        trainedDate: row ? row.trainedDate : '',
        trainedBy: row ? row.trainedBy : '',
        filename: row ? row.filename : '',
        fileUrl: row ? row.fileUrl : '',
        link: isp.signingLink(site, member, plan),
        canText: !!normalizePhone(member.phone) && member.smsConsent === 'Opted In'
      };
    });
    // Earlier plans' acknowledgments, for the record's history.
    const history = context.rows.filter(function (r) { return r.resident === resident && r.planDate !== plan.planDate; })
      .sort(function (a, b) { return a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : a.staffName.localeCompare(b.staffName); })
      .map(function (r) { return { planDate: r.planDate, staffName: r.staffName, trainedDate: r.trainedDate, trainedBy: r.trainedBy, filename: r.filename, fileUrl: r.fileUrl }; });

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        resident: resident,
        plan: { planDate: plan.planDate, effectiveDate: plan.effectiveDate, revisedDate: plan.revisedDate, revised: plan.revised, label: isp.planLabel(plan) },
        staff: staff,
        history: history
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
