const { updatePage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { loadCurrentRecord, createRecord } = require('./lib/annual-planning');

// Step 1: set (first time) or confirm (later cycles) the effective date,
// and record the resident's permanent Annual Planning Drive folder link
// the first time only — it's remembered from here on, never overwritten,
// since it's the one thing in this whole flow a person has to supply
// manually (the app can't discover it on its own; see lib/annual-planning.js).
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
    const resident = body.resident;
    const effectiveDate = body.effectiveDate;
    const folderUrl = body.folderUrl;

    if (!location || !resident || !effectiveDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, and effective date are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(location, resident);

    if (!windowState.isWindowOpen) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'This cycle isn\'t open yet. It opens ' + windowState.windowOpenDate.toISOString().slice(0, 10) + '.',
          windowOpenDate: windowState.windowOpenDate.toISOString().slice(0, 10)
        })
      };
    }

    if (!record) {
      if (!folderUrl) {
        return { statusCode: 400, body: JSON.stringify({ error: 'The Annual Planning Drive folder link is required the first time.' }) };
      }
      await createRecord(location, resident, effectiveDate, folderUrl);
    } else {
      const props = { 'Effective Date': { date: { start: effectiveDate } } };
      // The folder link is permanent once set — only accept it here if
      // this record somehow doesn't have one yet (shouldn't normally
      // happen once createRecord has run, but don't silently drop a
      // legitimate first-time link if it does).
      if (!record.folderUrl && folderUrl) {
        props['Annual Planning Folder URL'] = { url: folderUrl };
      }
      await updatePage(record.id, props);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
