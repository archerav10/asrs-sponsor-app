const { requireSession } = require('./lib/session');
const { createVersion, addDaysISO } = require('./lib/daily-progress-notes');

const VALID_TYPES = ['Text', 'Checklist'];

// Publishes a new version of a resident's Daily Progress Notes question
// set, effective on the given date. lib/daily-progress-notes.js's
// createVersion handles closing off whatever version was previously
// open-ended — this endpoint is just auth + input validation in front of
// it.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const location = body.location;
    const resident = (body.resident || '').trim().toUpperCase();
    const residentFullName = (body.residentFullName || '').trim();
    const timesCovered = (body.timesCovered || '').trim();
    const effectiveDate = body.effectiveDate;
    // The admin enters the LAST day this version should still apply
    // (inclusive, e.g. "10/31/2026") — converted here to the Termination
    // Date's actual stored/compared meaning (the FIRST day it no longer
    // applies), so nobody has to reason in off-by-one terms.
    const lastValidDate = body.lastValidDate || null;
    const questions = body.questions || [];

    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    if (!resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Resident initials are required.' }) };
    }
    if (!residentFullName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Resident full name is required.' }) };
    }
    if (!timesCovered) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Times covered is required.' }) };
    }
    if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A valid effective date is required.' }) };
    }
    if (lastValidDate && (!/^\d{4}-\d{2}-\d{2}$/.test(lastValidDate) || lastValidDate < effectiveDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'The last valid date must be on or after the effective date.' }) };
    }
    if (!questions.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'At least one question is required.' }) };
    }
    for (const q of questions) {
      if (!q.text || !q.text.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Every question needs text.' }) };
      }
      if (VALID_TYPES.indexOf(q.type) === -1) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Question type must be Text or Checklist.' }) };
      }
      if (q.type === 'Checklist' && (!q.checklistItems || !q.checklistItems.filter(Boolean).length)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A Checklist question needs at least one item.' }) };
      }
    }

    const terminationDate = lastValidDate ? addDaysISO(lastValidDate, 1) : null;
    await createVersion(location, resident, residentFullName, timesCovered, effectiveDate, questions, terminationDate);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
