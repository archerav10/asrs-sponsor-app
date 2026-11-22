const { requireSession } = require('./lib/session');
const { recentSignedNotes } = require('./lib/daily-progress-notes');

const DAYS = 14;

// Read-only: one resident's signed Daily Progress Notes from the last 14
// days, with every question and answer, for the sponsor/liaison app's
// "Recent notes" screen. Signed notes show here the moment they're
// signed; older ones (and the official copy) are the PDFs in Past notes.
// Same resident check as get-daily-progress-note.js: only residents on
// this session's location.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const requested = (event.queryStringParameters || {}).resident;
    const resident = requested && residents.indexOf(requested) !== -1 ? requested : null;
    if (!resident) return { statusCode: 400, body: JSON.stringify({ error: 'Choose a resident at this home.' }) };
    const notes = await recentSignedNotes(session.location, resident, DAYS);
    return { statusCode: 200, body: JSON.stringify({ location: session.location, resident: resident, days: DAYS, notes: notes }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
