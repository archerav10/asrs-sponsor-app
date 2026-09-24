const {
  requireIntakeAdmin, getIntake, itemsForIntake, upsertItem, STEPS_BY_KEY, STATUS, TIME_ZONE,
  isSponsorStep, todayIso, richText, statusProp, dateProp, json, errorResponse
} = require('./lib/sponsor-intake');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Every admin edit to one checklist item. Actions:
//   schedule {date, time?} — set/clear an event's date ("Scheduled")
//   complete {date?}       — mark done (defaults to today)
//   reopen                 — undo complete
//   accept                 — sponsor item Received -> Complete
//   return {reason}        — send a sponsor item back; goes out on the next request
//   notes {notes}          — admin-only notes
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireIntakeAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const step = STEPS_BY_KEY[body.stepKey];
    if (!body.id || !step) return json(400, { error: 'id and a valid stepKey are required.' });

    const intake = await getIntake(body.id);
    const items = await itemsForIntake(intake.id);
    const item = items[step.key] || null;
    const status = item ? item.status : '';
    const today = todayIso();

    const props = { 'Last Updated By': richText(session.name || session.email) };

    switch (body.action) {
      case 'schedule': {
        if (step.type !== 'event') return json(400, { error: 'Only events have a scheduled date.' });
        const date = body.date || '';
        const time = body.time || '';
        if (date && !DATE_RE.test(date)) return json(400, { error: 'Date must be YYYY-MM-DD.' });
        if (time && !TIME_RE.test(time)) return json(400, { error: 'Time must be HH:MM.' });
        props['Event Date'] = date
          ? { date: time ? { start: date + 'T' + time + ':00', time_zone: TIME_ZONE } : { start: date } }
          : { date: null };
        if (status !== STATUS.COMPLETE) props['Status'] = statusProp(date ? STATUS.SCHEDULED : null);
        break;
      }
      case 'complete': {
        const date = body.date || today;
        if (!DATE_RE.test(date)) return json(400, { error: 'Date must be YYYY-MM-DD.' });
        props['Status'] = statusProp(STATUS.COMPLETE);
        props['Completed Date'] = dateProp(date);
        if (step.type === 'event' && !(item && item.eventDate)) props['Event Date'] = dateProp(date);
        break;
      }
      case 'reopen': {
        let next = null;
        if (isSponsorStep(step) && item && item.filename) next = STATUS.RECEIVED;
        else if (step.type === 'event' && item && item.eventDate) next = STATUS.SCHEDULED;
        props['Status'] = statusProp(next);
        props['Completed Date'] = dateProp(null);
        break;
      }
      case 'accept': {
        if (!isSponsorStep(step) || status !== STATUS.RECEIVED) {
          return json(400, { error: 'Only a received sponsor item can be accepted.' });
        }
        props['Status'] = statusProp(STATUS.COMPLETE);
        props['Completed Date'] = dateProp(today);
        break;
      }
      case 'return': {
        const reason = (body.reason || '').trim();
        if (!isSponsorStep(step)) return json(400, { error: 'Only sponsor items can be returned.' });
        if (!reason) return json(400, { error: 'Enter a reason — the sponsor sees it in their next email.' });
        props['Status'] = statusProp(STATUS.RETURNED);
        props['Return Reason'] = richText(reason);
        props['Completed Date'] = dateProp(null);
        break;
      }
      case 'notes': {
        props['Notes'] = richText((body.notes || '').trim());
        break;
      }
      default:
        return json(400, { error: 'Unknown action.' });
    }

    await upsertItem(intake, step.key, props, item);
    return json(200, { success: true });
  } catch (err) {
    return errorResponse(err);
  }
};
