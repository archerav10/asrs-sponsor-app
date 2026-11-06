// Training Modules, phase 2: assigning to many people and modules at once,
// the texts and emails that go with it, and reminders. Builds on
// lib/training-modules.js (Notion, links, certificates).
const { updatePage, queryDatabaseAll } = require('./notion');
const { id: configId } = require('./ids');
const { encryptToken, decryptToken } = require('./crypto');
const tm = require('./training-modules');

const ROLES = ['Sponsor', 'DSP', 'Secondary DSP'];
// Above this many person x module pairs, Assign hands off to the
// background job (15 minutes) instead of doing it inside the request.
const INLINE_LIMIT = 4;
const REMINDER_EVERY_MS = 2 * 864e5 - 3 * 3600e3; // "every 2 days", with slack for the daily run time
const MAX_REMINDERS = 10;
const EMAIL_GAP_MS = 1100; // EmailJS allows one email a second

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function isOpen(a) { return a.status === 'Assigned' || a.status === 'In Progress'; }

function isOverdue(a, today) { return !!a.dueDate && a.dueDate.slice(0, 10) < (today || tm.todayIso()); }

// How a person is reached: a text when Opted In with a usable phone,
// otherwise email, otherwise nothing (the admin copies the link).
function channelFor(person) {
  if (person && person.smsConsent === 'Opted In' && tm.normalizePhone(person.phone)) return 'Text';
  if (person && person.email) return 'Email';
  return '';
}

// ---------- message text ----------
// items: [{ assignment, mod, link }], all for one person.

function assignText(person, items) {
  const hi = 'ASRS Training: Hi ' + tm.firstName(person.name) + ', ';
  if (items.length === 1) {
    const it = items[0];
    return hi + 'you have a new training module, "' + it.mod.title + '"' + (it.mod.minutes ? ' (about ' + it.mod.minutes + ' min)' : '') +
      '. Please finish it by ' + tm.prettyDate(it.assignment.dueDate) + ': ' + it.link + ' Reply STOP to opt out.';
  }
  return hi + 'you have ' + items.length + ' new training modules, due ' + tm.prettyDate(items[0].assignment.dueDate) + ':\n' +
    items.map(function (it, i) { return (i + 1) + ') ' + it.mod.title + ': ' + it.link; }).join('\n') + '\nReply STOP to opt out.';
}

function reminderText(items, today) {
  if (items.length === 1) {
    const it = items[0];
    return isOverdue(it.assignment, today)
      ? 'ASRS reminder: "' + it.mod.title + '" is now overdue (due ' + tm.prettyDate(it.assignment.dueDate) + '). Please finish it today: ' + it.link
      : 'ASRS reminder: "' + it.mod.title + '" is still open and due ' + tm.prettyDate(it.assignment.dueDate) + ': ' + it.link;
  }
  return 'ASRS reminder: you have ' + items.length + ' training modules still open:\n' +
    items.map(function (it, i) {
      return (i + 1) + ') ' + it.mod.title + (isOverdue(it.assignment, today) ? ' (overdue, was due ' : ' (due ') + tm.prettyDate(it.assignment.dueDate) + '): ' + it.link;
    }).join('\n');
}

function newLinkText(item) {
  return 'ASRS Training: here is a new link for "' + item.mod.title + '", due ' + tm.prettyDate(item.assignment.dueDate) + ': ' + item.link + ' (Your earlier link no longer works.)';
}

function emailFor(kind, person, items, today) {
  const greeting = 'Hi ' + tm.firstName(person.name) + ',\n\n';
  const sign = '\n\nNo password is needed: the link opens your module.\n\nThank you,\nArch Support Residential Services';
  const list = items.map(function (it) {
    return '- ' + it.mod.title + (it.mod.minutes ? ' (about ' + it.mod.minutes + ' minutes)' : '') +
      ', due ' + tm.prettyDate(it.assignment.dueDate) + (isOverdue(it.assignment, today) ? ' (overdue)' : '') + ':\n  ' + it.link;
  }).join('\n');
  if (kind === 'remind') {
    return { subject: 'Reminder: training ' + (items.length === 1 ? 'module "' + items[0].mod.title + '"' : 'modules') + ' still open',
      message: greeting + 'This is a reminder that ' + (items.length === 1 ? 'this training module is' : 'these training modules are') + ' still open:\n\n' + list + sign };
  }
  if (kind === 'newlink') {
    return { subject: 'New link: ' + items[0].mod.title, message: greeting + 'Here is a new link for your training module. Your earlier link no longer works.\n\n' + list + sign };
  }
  return { subject: items.length === 1 ? 'Training module: ' + items[0].mod.title : 'New training modules (' + items.length + ')',
    message: greeting + 'You have ' + (items.length === 1 ? 'a new training module' : items.length + ' new training modules') + ':\n\n' + list + sign };
}

// Sends one message to one person covering all their items. Returns the
// channel used ('' when nothing could be sent).
async function notify(kind, person, items, deps, today) {
  const channel = channelFor(person);
  if (channel === 'Text') {
    const body = kind === 'remind' ? reminderText(items, today) : kind === 'newlink' ? newLinkText(items[0]) : assignText(person, items);
    await deps.sendSms(tm.normalizePhone(person.phone), body);
  } else if (channel === 'Email') {
    const e = emailFor(kind, person, items, today);
    await deps.sendEmail(person.email, person.name, e.subject, e.message);
  }
  return channel;
}

// ---------- planning an assignment ----------

// Who would get what. Never reaches past the admin's granted locations.
// Returns { modules, people: [{ person, channel, add: [mod], skip: [{ mod, reason }] }], totals }.
async function planAssignments(opts) {
  const granted = opts.grantedLocations || [];
  const moduleIds = Array.from(new Set(opts.moduleIds || []));
  const personIds = Array.from(new Set(opts.personIds || []));
  if (!moduleIds.length) throw tm.badRequest('Pick at least one module.');
  if (!personIds.length) throw tm.badRequest('Pick at least one person.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.dueDate || '')) throw tm.badRequest('Pick a due date.');
  if (opts.dueDate < tm.todayIso()) throw tm.badRequest('The due date is in the past.');

  const modules = [];
  for (const id of moduleIds) {
    const mod = await tm.loadModule(id);
    if (mod.status !== 'Published') throw tm.badRequest('"' + mod.title + '" isn\'t Published in Notion yet.');
    if (mod.problems.length) throw tm.badRequest('"' + mod.title + '" can\'t be assigned yet: ' + mod.problems.join(' '));
    modules.push(mod);
  }

  const people = [];
  for (const id of personIds) {
    const person = await tm.getPerson(id);
    if (granted.indexOf(person.location) < 0) throw tm.badRequest('You aren\'t granted ' + (person.location || 'that person\'s location') + '.', 403);
    const open = (await tm.listAssignments({ property: 'Person', relation: { contains: person.id } })).filter(isOpen);
    const add = [], skip = [];
    modules.forEach(function (mod) {
      const dup = open.find(function (a) { return tm.sameId(a.moduleId, mod.id); });
      if (dup) skip.push({ mod: mod, reason: 'already open, due ' + tm.prettyDate(dup.dueDate) });
      else add.push(mod);
    });
    people.push({ person: person, channel: channelFor(person), add: add, skip: skip });
  }

  const sending = people.filter(function (p) { return p.add.length; });
  return {
    modules: modules,
    people: people,
    totals: {
      people: sending.length,
      assignments: sending.reduce(function (n, p) { return n + p.add.length; }, 0),
      byText: sending.filter(function (p) { return p.channel === 'Text'; }).length,
      byEmail: sending.filter(function (p) { return p.channel === 'Email'; }).length,
      noContact: sending.filter(function (p) { return !p.channel; }).length,
      skipped: people.reduce(function (n, p) { return n + p.skip.length; }, 0)
    }
  };
}

function planSummary(plan) {
  return {
    totals: plan.totals,
    modules: plan.modules.map(function (m) { return { id: m.id, title: m.title }; }),
    people: plan.people.map(function (p) {
      return {
        id: p.person.id, name: p.person.name, role: p.person.role, location: p.person.location, channel: p.channel,
        add: p.add.map(function (m) { return m.title; }),
        skip: p.skip.map(function (s) { return s.mod.title + ' (' + s.reason + ')'; })
      };
    })
  };
}

// Creates the rows and sends one message per person. Returns what happened,
// person by person, including links for anyone who couldn't be reached.
async function carryOutPlan(plan, opts, deps) {
  const results = [];
  let lastEmailAt = 0;
  for (const p of plan.people) {
    if (!p.add.length) continue;
    const items = [];
    try {
      for (const mod of p.add) {
        const assignment = await tm.createAssignment({
          moduleId: mod.id, moduleTitle: mod.title, moduleVersion: mod.version,
          personId: p.person.id, personName: p.person.name, role: p.person.role, location: p.person.location,
          dueDate: opts.dueDate, assignedBy: opts.assignedBy, phone: tm.normalizePhone(p.person.phone), email: p.person.email
        });
        items.push({ assignment: assignment, mod: mod, link: tm.moduleLink(assignment, opts.site) });
      }
      if (p.channel === 'Email') { const wait = lastEmailAt + EMAIL_GAP_MS - Date.now(); if (wait > 0) await sleep(wait); }
      let channel = '';
      let error = '';
      try {
        channel = await notify('assign', p.person, items, deps);
        if (channel === 'Email') lastEmailAt = Date.now();
      } catch (e) {
        console.error('Assignment notice failed for ' + p.person.name, e);
        error = e.message;
      }
      for (const it of items) {
        if (channel) await updatePage(it.assignment.id, { 'Channel': { select: { name: channel } } });
      }
      results.push({ name: p.person.name, channel: channel, error: error, links: channel ? [] : items.map(function (it) { return { title: it.mod.title, link: it.link }; }) });
    } catch (e) {
      console.error('Assigning failed for ' + p.person.name, e);
      results.push({ name: p.person.name, channel: '', error: e.message, links: items.map(function (it) { return { title: it.mod.title, link: it.link }; }) });
    }
  }
  return results;
}

// ---------- background jobs ----------
// Same idea as Weekly Focus: scheduled functions get 30 seconds and a
// request about 10, so big sends and the reminder run go to
// module-jobs-background (15 minutes) with a short-lived encrypted ticket.
const JOB_KIND = 'training-module-job';

async function startJob(job, payload, siteUrl) {
  const base = (siteUrl || tm.SITE_URL).replace(/\/+$/, '');
  const ticket = encryptToken(Object.assign({ kind: JOB_KIND, job: job }, payload || {}), 10 * 60);
  const res = await fetch(base + '/.netlify/functions/module-jobs-background', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: ticket })
  });
  if (res.status !== 202 && !res.ok) throw new Error('Could not start the training module ' + job + ' job (HTTP ' + res.status + ').');
  return { started: true };
}

function readJobTicket(ticket) {
  const payload = decryptToken(ticket || '');
  if (payload.kind !== JOB_KIND) throw new Error('Not a training module job ticket.');
  return payload;
}

// ---------- reminders ----------

// When the person was last contacted about this assignment.
function lastContactMs(a) {
  return Date.parse(a.lastReminder || '') || Date.parse((a.assignedDate || '').slice(0, 10) + 'T10:00:00-05:00') || 0;
}

function needsReminder(a, nowMs) {
  return isOpen(a) && (a.remindersSent || 0) < MAX_REMINDERS && nowMs - lastContactMs(a) >= REMINDER_EVERY_MS;
}

async function recordReminder(a, nowIso) {
  const sent = (a.remindersSent || 0) + 1;
  const props = { 'Reminders Sent': { number: sent }, 'Last Reminder': { date: { start: nowIso } } };
  if (sent >= MAX_REMINDERS) props['Needs Follow-up'] = { checkbox: true };
  await updatePage(a.id, props);
}

// The daily run: every open assignment last contacted 2+ days ago gets a
// reminder, grouped into one message per person. After the 10th, the
// assignment is flagged Needs Follow-up and texting stops.
async function runReminders(deps, opts) {
  opts = opts || {};
  const nowMs = opts.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = tm.todayIso();
  const open = (await tm.listAssignments()).filter(isOpen);
  const due = open.filter(function (a) { return needsReminder(a, nowMs); });

  const byPerson = {};
  due.forEach(function (a) { (byPerson[a.personId] = byPerson[a.personId] || []).push(a); });

  const modCache = {};
  async function modFor(id) { return modCache[id] || (modCache[id] = await tm.loadModule(id)); }

  const summary = { people: 0, text: 0, email: 0, none: 0, failed: 0, flagged: 0 };
  let lastEmailAt = 0;
  for (const personId of Object.keys(byPerson)) {
    const list = byPerson[personId];
    try {
      const person = await tm.getPerson(personId);
      const items = [];
      for (const a of list) items.push({ assignment: a, mod: await modFor(a.moduleId), link: tm.moduleLink(a, opts.site) });
      if (channelFor(person) === 'Email') { const wait = lastEmailAt + EMAIL_GAP_MS - Date.now(); if (wait > 0) await sleep(wait); }
      const channel = await notify('remind', person, items, deps, today);
      if (channel === 'Email') lastEmailAt = Date.now();
      summary.people++;
      summary[channel ? channel.toLowerCase() : 'none']++;
      if (channel) {
        for (const a of list) {
          await recordReminder(a, nowIso);
          if ((a.remindersSent || 0) + 1 >= MAX_REMINDERS) summary.flagged++;
        }
      }
    } catch (e) {
      console.error('Reminder failed for person ' + personId, e);
      summary.failed++;
    }
  }
  return summary;
}

// Dashboard "Send reminder": one assignment, right now.
async function remindNow(a, deps, site) {
  const person = await tm.getPerson(a.personId);
  const mod = await tm.loadModule(a.moduleId);
  const channel = await notify('remind', person, [{ assignment: a, mod: mod, link: tm.moduleLink(a, site) }], deps);
  if (channel) await recordReminder(a, new Date().toISOString());
  return channel;
}

// Dashboard "Resend link": a new Link Version (older links stop working)
// and a message with the new link.
async function resendLink(a, deps, site) {
  const linkVersion = (a.linkVersion || 1) + 1;
  await updatePage(a.id, { 'Link Version': { number: linkVersion } });
  const updated = Object.assign({}, a, { linkVersion: linkVersion });
  const person = await tm.getPerson(a.personId);
  const mod = await tm.loadModule(a.moduleId);
  const link = tm.moduleLink(updated, site);
  const channel = await notify('newlink', person, [{ assignment: updated, mod: mod, link: link }], deps);
  return { channel: channel, link: link };
}

// ---------- SMS consent from texts (sms-inbound) ----------

async function staffByPhone(phone) {
  const want = tm.normalizePhone(phone);
  if (!want) return [];
  const rows = await queryDatabaseAll(configId('ASRS_PEOPLE_DB_ID'), {
    and: [{ property: 'Type', select: { equals: 'Staff' } }, { property: 'Phone Number', phone_number: { is_not_empty: true } }]
  });
  return rows.filter(function (page) { return tm.normalizePhone(page.properties['Phone Number'].phone_number) === want; })
    .map(function (page) { return { id: page.id, name: page.properties['Name'].title.map(function (t) { return t.plain_text; }).join('') }; });
}

async function setStaffSmsConsent(personId, status) {
  await updatePage(personId, {
    'SMS Consent Status': { select: { name: status } },
    'SMS Consent Date': { date: { start: tm.todayIso() } }
  });
}

const NO_REPLIES_SMS = 'ASRS Training: this number doesn\'t take replies. Open the link in your text to finish your training module, or contact your ASRS supervisor.';

module.exports = {
  ROLES, INLINE_LIMIT, MAX_REMINDERS, REMINDER_EVERY_MS,
  isOpen, isOverdue, channelFor, assignText, reminderText, emailFor, notify,
  planAssignments, planSummary, carryOutPlan, startJob, readJobTicket,
  lastContactMs, needsReminder, runReminders, remindNow, resendLink,
  staffByPhone, setStaffSmsConsent, NO_REPLIES_SMS
};
