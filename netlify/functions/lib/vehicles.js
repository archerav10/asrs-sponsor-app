const { queryDatabaseAll, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');

const VEHICLES_DB_ID = configId('VEHICLES_DB_ID');
const SERVICES_DB_ID = configId('VEHICLE_SERVICES_DB_ID');

// Group home vehicles (admin-only; sponsors never see this). Each vehicle
// belongs to a location; every service is its own row in Vehicle
// Services (append-only, like Medical Appointments: a mistaken entry is
// removed by unchecking Active, never edited). A few service types are
// tracked with a due date and/or mileage and drive the green/yellow/red
// status and the reminder texts; the rest are history only.
//
//   State Inspection    12 months after the last one
//   Plate Tags          the expiration date entered with it
//   Insurance Renewal   the expiration date entered with it
//   Oil & Filter        3 months or 5,000 miles, whichever comes first
//   Tire Rotation       every 6,000 miles
//   Tune-up             every 30,000 miles
//
// Yellow (and the first text) 30 days before a date, or within 500 miles
// of a mileage; red (and a second text) once it's due. Mileage is only as
// current as the latest reading anyone logged, which is what "Mileage
// Update" entries are for.

const DUE_SOON_DAYS = 30;
const DUE_SOON_MILES = 500;

const SERVICE_TYPES = [
  { key: 'inspection', label: 'State Inspection', months: 12 },
  { key: 'tags', label: 'Plate Tags / Registration', expires: true },
  { key: 'insurance', label: 'Insurance Renewal', expires: true },
  { key: 'oil', label: 'Oil & Filter', months: 3, miles: 5000 },
  { key: 'rotation', label: 'Tire Rotation', miles: 6000 },
  { key: 'tuneup', label: 'Tune-up', miles: 30000 },
  { key: 'tires', label: 'Tires' },
  { key: 'brakes', label: 'Brakes' },
  { key: 'battery', label: 'Battery' },
  { key: 'wipers', label: 'Wiper Blades' },
  { key: 'airFilter', label: 'Air Filter' },
  { key: 'alignment', label: 'Alignment' },
  { key: 'fluids', label: 'Fluid Flush' },
  { key: 'repair', label: 'Recall / Repair' },
  { key: 'other', label: 'Other Maintenance' },
  { key: 'mileage', label: 'Mileage Update' }
];

function typeByKey(key) { return SERVICE_TYPES.filter(function (t) { return t.key === key; })[0] || null; }
function typeByLabel(label) { return SERVICE_TYPES.filter(function (t) { return t.label === label; })[0] || null; }
function isTracked(t) { return !!(t && (t.months || t.miles || t.expires)); }

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function richText(s) {
  const content = String(s || '').slice(0, 2000);
  return { rich_text: content ? [{ text: { content: content } }] : [] };
}

function normId(id) { return String(id || '').replace(/-/g, '').toLowerCase(); }

function addMonthsISO(iso, months) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00Z') - new Date(fromISO + 'T00:00:00Z')) / 86400000);
}

// Today in Eastern time — the reminder job runs in the morning Eastern.
function todayISO(now) {
  return (now || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ---- Vehicles ----

function vehicleFromPage(page) {
  const p = page.properties;
  let remindersSent = {};
  try { remindersSent = JSON.parse(getPlainText(p['Reminders Sent']) || '{}') || {}; } catch (e) { remindersSent = {}; }
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    location: getPlainText(p['Location']),
    year: getPlainText(p['Year']) || null,
    make: getPlainText(p['Make']),
    model: getPlainText(p['Model']),
    plate: getPlainText(p['Plate']),
    vin: getPlainText(p['VIN']),
    notes: getPlainText(p['Notes']),
    active: !!getPlainText(p['Active']),
    remindersSent: remindersSent
  };
}

function describe(v) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ');
}

async function vehiclesForLocations(locations) {
  if (!locations.length) return [];
  const pages = await queryDatabaseAll(VEHICLES_DB_ID, {
    and: [
      { property: 'Active', checkbox: { equals: true } },
      { or: locations.map(function (l) { return { property: 'Location', rich_text: { equals: l } }; }) }
    ]
  });
  return pages.map(vehicleFromPage).sort(function (a, b) { return a.location.localeCompare(b.location) || a.name.localeCompare(b.name); });
}

async function allActiveVehicles() {
  return (await queryDatabaseAll(VEHICLES_DB_ID, { property: 'Active', checkbox: { equals: true } })).map(vehicleFromPage);
}

async function getVehicle(id) {
  try {
    return vehicleFromPage(await getPage(id));
  } catch (e) {
    throw httpError(404, 'That vehicle wasn\'t found.');
  }
}

// The vehicle, if the session may see it.
async function vehicleForSession(session, id) {
  const vehicle = await getVehicle(id);
  if ((session.grantedLocations || []).indexOf(vehicle.location) === -1) throw httpError(403, 'Not authorized for that location.');
  return vehicle;
}

function cleanVehicleFields(body) {
  const t = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n || 200); };
  const year = body.year === '' || body.year == null ? null : Number(body.year);
  return {
    name: t(body.name, 100),
    year: Number.isInteger(year) && year > 1950 && year < 2100 ? year : null,
    make: t(body.make, 60),
    model: t(body.model, 60),
    plate: t(body.plate, 20).toUpperCase(),
    vin: t(body.vin, 30).toUpperCase(),
    notes: t(body.notes, 1000)
  };
}

function vehicleProps(f) {
  return {
    'Name': { title: [{ text: { content: f.name } }] },
    'Year': { number: f.year },
    'Make': richText(f.make),
    'Model': richText(f.model),
    'Plate': richText(f.plate),
    'VIN': richText(f.vin),
    'Notes': richText(f.notes)
  };
}

async function createVehicle(location, fields) {
  const props = vehicleProps(fields);
  props['Location'] = richText(location);
  props['Active'] = { checkbox: true };
  return vehicleFromPage(await createPage(VEHICLES_DB_ID, props));
}

async function updateVehicle(id, fields) {
  await updatePage(id, vehicleProps(fields));
}

async function retireVehicle(id) {
  await updatePage(id, { 'Active': { checkbox: false } });
}

async function saveRemindersSent(id, sent) {
  await updatePage(id, { 'Reminders Sent': richText(JSON.stringify(sent)) });
}

// ---- Services ----

function serviceFromPage(page) {
  const p = page.properties;
  const type = typeByLabel(getPlainText(p['Service Type']));
  const mileage = getPlainText(p['Mileage']);
  const cost = getPlainText(p['Cost']);
  return {
    id: page.id,
    vehicleId: getPlainText(p['Vehicle ID']),
    typeKey: type ? type.key : 'other',
    typeLabel: type ? type.label : getPlainText(p['Service Type']),
    date: getPlainText(p['Service Date']),
    mileage: typeof mileage === 'number' ? mileage : null,
    expirationDate: getPlainText(p['Expiration Date']) || '',
    cost: typeof cost === 'number' ? cost : null,
    note: getPlainText(p['Note']),
    loggedBy: getPlainText(p['Logged By'])
  };
}

function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.mileage || 0) - (a.mileage || 0);
}

async function servicesForVehicle(vehicleId) {
  const pages = await queryDatabaseAll(SERVICES_DB_ID, {
    and: [
      { property: 'Vehicle ID', rich_text: { equals: normId(vehicleId) } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return pages.map(serviceFromPage).filter(function (s) { return s.date; }).sort(byNewest);
}

// Every active service for these vehicles, grouped by vehicle ID.
async function servicesByVehicle(vehicles) {
  const out = {};
  vehicles.forEach(function (v) { out[normId(v.id)] = []; });
  if (!vehicles.length) return out;
  const pages = await queryDatabaseAll(SERVICES_DB_ID, { property: 'Active', checkbox: { equals: true } });
  pages.map(serviceFromPage).forEach(function (s) {
    const key = normId(s.vehicleId);
    if (out[key] && s.date) out[key].push(s);
  });
  Object.keys(out).forEach(function (k) { out[k].sort(byNewest); });
  return out;
}

// Returns an error message, or '' when the entry is usable.
function validateService(input, today) {
  const type = typeByKey(input.typeKey);
  if (!type) return 'Choose a service type.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return 'Choose the service date.';
  if (input.date > today) return 'The service date can\'t be in the future.';
  if (input.mileage != null && (!Number.isFinite(input.mileage) || input.mileage < 0 || input.mileage > 2000000)) return 'Check the mileage.';
  if (type.miles && input.mileage == null) return 'Enter the mileage for ' + type.label + ' so the next one can be tracked.';
  if (type.key === 'mileage' && input.mileage == null) return 'Enter the current mileage.';
  if (type.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expirationDate || '')) return 'Enter the new expiration date for ' + type.label + '.';
    if (input.expirationDate <= input.date) return 'The expiration date should be after the service date.';
  }
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0 || input.cost > 1000000)) return 'Check the cost.';
  return '';
}

async function createService(vehicle, input, loggedBy, today) {
  const type = typeByKey(input.typeKey);
  const page = await createPage(SERVICES_DB_ID, {
    'Record Title': { title: [{ text: { content: vehicle.location + ' - ' + vehicle.name + ' - ' + type.label + ' - ' + input.date } }] },
    'Vehicle ID': richText(normId(vehicle.id)),
    'Location': richText(vehicle.location),
    'Service Type': { select: { name: type.label } },
    'Service Date': { date: { start: input.date } },
    'Mileage': { number: input.mileage == null ? null : Math.round(input.mileage) },
    'Expiration Date': { date: type.expires ? { start: input.expirationDate } : null },
    'Cost': { number: input.cost == null ? null : Math.round(input.cost * 100) / 100 },
    'Note': richText(input.note),
    'Logged By': richText(loggedBy),
    'Logged Date': { date: { start: today } },
    'Active': { checkbox: true }
  });
  return serviceFromPage(page);
}

async function removeService(serviceId) {
  await updatePage(serviceId, { 'Active': { checkbox: false } });
}

async function getService(serviceId) {
  try {
    return serviceFromPage(await getPage(serviceId));
  } catch (e) {
    throw httpError(404, 'That entry wasn\'t found.');
  }
}

// ---- Status ----

function latestMileage(services) {
  let best = null;
  services.forEach(function (s) {
    if (s.mileage != null && (!best || s.mileage > best.mileage)) best = { mileage: s.mileage, date: s.date };
  });
  return best;
}

function fmtDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtMiles(n) { return Math.round(n).toLocaleString('en-US') + ' mi'; }

// One entry per tracked service type:
//   { key, label, status: green|yellow|red|none, text, dueDate, dueMiles,
//     last: { date, mileage } | null, reminderKey }
// reminderKey identifies "this particular due point" (the date and/or
// mileage it's due at), so a reminder goes out once per due point and a
// newly logged service naturally starts a fresh one.
function computeVehicleStatus(services, now) {
  const today = todayISO(now);
  const current = latestMileage(services);
  const items = SERVICE_TYPES.filter(isTracked).map(function (type) {
    const last = services.filter(function (s) { return s.typeKey === type.key; })[0] || null;
    if (!last) {
      return { key: type.key, label: type.label, status: 'none', text: 'No record yet. Log the last one to start tracking.', dueDate: null, dueMiles: null, last: null, reminderKey: null };
    }
    const dueDate = type.expires ? (last.expirationDate || null) : (type.months ? addMonthsISO(last.date, type.months) : null);
    const dueMiles = type.miles && last.mileage != null ? last.mileage + type.miles : null;

    let dateState = null;
    if (dueDate) {
      const days = daysBetween(today, dueDate);
      dateState = days < 0 ? 'overdue' : days === 0 ? 'due' : days <= DUE_SOON_DAYS ? 'soon' : 'ok';
    }
    let milesState = null;
    if (dueMiles != null && current) {
      const left = dueMiles - current.mileage;
      milesState = left <= 0 ? 'due' : left <= DUE_SOON_MILES ? 'soon' : 'ok';
    }
    const states = [dateState, milesState].filter(Boolean);
    const status = states.some(function (s) { return s === 'overdue' || s === 'due'; }) ? 'red'
      : states.indexOf('soon') !== -1 ? 'yellow' : 'green';

    const now = current ? ' (now ' + fmtMiles(current.mileage) + ')' : '';
    let text;
    if (dueDate && dueMiles != null) {
      text = (dateState === 'overdue' ? 'Overdue since ' + fmtDate(dueDate) + ' (or ' + fmtMiles(dueMiles) + ')' : 'Due by ' + fmtDate(dueDate) + ' or ' + fmtMiles(dueMiles) + ', whichever comes first') + now;
    } else if (dueDate) {
      text = (type.expires ? (dateState === 'overdue' ? 'Expired ' : 'Expires ') : (dateState === 'overdue' ? 'Overdue since ' : 'Due ')) + fmtDate(dueDate);
    } else if (dueMiles != null) {
      text = (milesState === 'due' ? 'Due now: was due at ' : 'Due at ') + fmtMiles(dueMiles) + now;
    } else {
      text = 'Log the mileage with it to start tracking.';
    }

    return {
      key: type.key,
      label: type.label,
      status: status,
      text: text,
      dueDate: dueDate,
      dueMiles: dueMiles,
      last: { date: last.date, mileage: last.mileage },
      reminderKey: type.key + '|' + (dueDate || '') + '|' + (dueMiles == null ? '' : dueMiles)
    };
  });
  const rank = { red: 3, yellow: 2, green: 1, none: 0 };
  const overall = items.reduce(function (worst, i) { return rank[i.status] > rank[worst] ? i.status : worst; }, 'none');
  return { overall: overall, currentMileage: current, items: items };
}

module.exports = {
  SERVICE_TYPES,
  DUE_SOON_DAYS,
  DUE_SOON_MILES,
  typeByKey,
  isTracked,
  httpError,
  normId,
  todayISO,
  addMonthsISO,
  describe,
  vehiclesForLocations,
  allActiveVehicles,
  getVehicle,
  vehicleForSession,
  cleanVehicleFields,
  createVehicle,
  updateVehicle,
  retireVehicle,
  saveRemindersSent,
  servicesForVehicle,
  servicesByVehicle,
  validateService,
  createService,
  removeService,
  getService,
  computeVehicleStatus,
  fmtDate,
  fmtMiles
};
