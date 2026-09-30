# ASRS Provider App — Login Layer

Email + unique password per provider, then SMS OTP as a second factor.
Reuses your existing AES-256-CBC/Twilio pattern — no server-side session
storage; the encrypted token IS the state.

## Files

```
netlify/functions/
  lib/crypto.js                    AES-256-CBC token encrypt/decrypt
  lib/notion.js                    Notion REST API helper
  lib/twilio.js                    Twilio SMS via REST API (no SDK dep)
  lib/session.js                    Shared session-token check (Bearer header)
  provider-login.js                Step 1: email+password -> send SMS OTP
  provider-verify-otp.js           Step 2: verify OTP -> session token
  admin-set-provider-password.js   Admin-only: provision a provider's password
  get-first-aid-supplies.js        Fetch active items for the caller's own Location
  update-first-aid-item.js         Update one item's exp date/notes (location-checked)
  confirm-first-aid-review.js      Bulk-stamp all of a location's items as reviewed today

public/
  provider-app/index.html          Login -> OTP -> Home shell (mobile-first)
  provider-app/manifest.json       PWA manifest (add real icons before shipping)
  admin/set-provider-password.html Admin password-provisioning form
```

Lives in the `asrs-sponsor-app` repo — same GitHub-push-to-Netlify-auto-deploy
workflow as your other portals.

## Environment variables to add in Netlify

| Variable | Value |
|---|---|
| `NOTION_TOKEN` | Your existing Notion integration token (already set elsewhere) |
| `SPONSORS_DB_ID` | `39fff13f-62f9-80f0-9134-000bddf16417` |
| `FIRST_AID_DB_ID` | `13467800-fa4f-420b-9fac-77204750b36c` |
| `FIRE_DRILL_DB_ID` | `2cd3e109-c6b9-4cc2-80cb-fde91d28a2f4` |
| `EMERGENCY_SUPPLIES_DB_ID` | `2512e571-d0fb-4937-8594-646da323a734` |
| `PHYSICAL_ENV_DB_ID` | `f65e9956-bfe5-4e81-8612-cf533d345796` |
| `EVENT_LOG_DB_ID` | `45e5d57d-b6bc-48e4-9283-5fbc4b2426de` |
| `MAR_DB_ID` | `7dbf6757-dd9b-4c7c-ad78-168c745ed555` |
| `MAR_PERIODS_DB_ID` | `9b81d8e5-141b-4ffc-8616-bc2743d0f1e8` |
| `MAR_DUE_DATE_OFFSET_DAYS` | Optional — days before end-of-month the MAR Review due date lands. Unset or `0` = end of month (current default). |
| `SERIOUS_INCIDENT_DB_ID` | `3a0ff13f-62f9-8032-b076-000b0cec3fbb` |
| `LOCATION_CODES_DB_ID` | `4bf686f3-056b-49c3-925c-a321a2c78591` |
| `ADMIN_ACCOUNTS_DB_ID` | `725e633a-e593-4352-8a66-29954e9d7b71` |
| `ZAPIER_EVENT_WEBHOOK_URL` | The Catch Hook URL from your dedicated "Provider Event Log Attachments" Zap — see setup steps below |
| `TWILIO_ACCOUNT_SID` | Existing Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Existing Twilio Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | `MGa94d0868186fab6262872567ce7e1aa9` (required — the number is A2P-registered under this service; sending by raw phone number gets rejected) |
| `ADMIN_ALLOWED_EMAILS` | Existing comma-separated admin email list |
| `APP_ENCRYPTION_KEY` | New — a 64-character hex string (32 bytes). Generate with `openssl rand -hex 32`. **Do not reuse a key from another portal.** |
| `DAILY_PROGRESS_NOTE_QUESTIONS_DB_ID` | `cb9f1f2f-d982-425a-92f8-496758529283` |
| `DAILY_PROGRESS_NOTES_DB_ID` | `d3c439da-f2ff-45cc-a265-0392568c1306` |
| `DAILY_PROGRESS_NOTE_ANSWERS_DB_ID` | `4b98a8d0-af57-421a-a68b-9ace4b28a081` |
| `ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL` | The Catch Hook URL from your "Daily Progress Note PDFs" Zap — see setup steps below |

After adding/changing env vars, trigger a fresh deploy — Netlify Functions
don't pick up env var changes until the next deploy.

## Provisioning your first provider

1. Make sure the provider already has a row in the **Sponsors** database
   with a matching Email and a valid Phone Number.
2. Open `/admin/set-provider-password.html`, enter your admin email, the
   provider's email, and a password you're giving them.
3. That sets `Password Hash` (SHA-256) and flips `Provider App Enabled`
   to true on their Sponsors row.
4. Give the provider their email + password directly (not over email/SMS,
   to avoid it sitting in a message thread).

## What's built so far

- Login (email+password -> SMS OTP -> session), admin password provisioning
- First Aid Supplies screen: date-tracked items get an editable date field
  (leave-and-save to confirm, change-and-save to update); everything else
  is a plain auto-saving checkbox ("Present"); one general notes box at
  the end (backed by a per-location "General Notes" row in the same
  database); "Confirm Everything Is Correct" bulk-stamps every row's
  Last Updated fields without changing values
- Fire Drill Report screen: a plain form (date/time, mock fire location,
  individuals present, evacuation time in minutes+seconds, notes) that
  creates a new Fire Drill Reports row per submission — no editing, since
  each drill is its own event
- Emergency Supplies screen: same pattern as First Aid Supplies (grouped
  date/checklist sections, one Confirm action) — plus a Gallons field on
  the Emergency Supply Water item specifically
- Physical Environment screen: 4 temperature readings and 1 fire
  extinguisher expiration date shown first (flags red inline when a
  reading is outside the standard range — 100-110°F hot water, 32-40°F
  fridge, <32°F freezer — informational only, doesn't block saving),
  followed by a 10-item checklist (First Aid Kit Complete, Emergency
  Supply Kit Complete, Home Clean, No Knives Accessible, Smoke Alarms
  Tested, and 5 postings/signage items)
- Home screen shows, separately under each report's button: its own
  last-reviewed/last-logged date, and its own next-due date — due date
  is the end of the month AFTER the month it was last completed (e.g.
  reviewed Sep 17 -> due Oct 31); falls back to end of the current month
  if it's never been done
- Log an Event screen: event type, resident (auto-filled if the provider
  has one, a picker only appears with two), date/time, notes, and an
  optional photo/document attachment. No due-date tracking here — it's
  an ongoing activity log, not a monthly compliance report. Above the
  form, a scrollable list shows every event in the past 30 and next 30
  days for that location, each with type, resident, notes preview, and
  an attachment indicator; future events are labeled "(Upcoming)."
- MAR Review screen: per-resident medication list (not per-location —
  each row is tied to a specific resident's initials). This report is
  forward-looking on a rolling monthly cycle: during any given month,
  staff review and finalize NEXT month's medications (delivered near
  month-end), so the "due date" defaults to the last day of the current
  month — configurable via the `MAR_DUE_DATE_OFFSET_DAYS` env var (unset
  or `0` = end of month; `2` = two days before end of month, etc.), the
  same rule for every location/resident. Changing it shifts the 7-day
  submission window and the SMS reminder cascade along with it, since
  both are computed relative to the due date. See
  `netlify/functions/lib/mar-period.js` for the rolling
  target-period calculation (it snaps back to catch up if even the
  current month was never finalized, rather than silently skipping
  ahead).
  - Each medication needs an **Expiration Date** OR a **Missing**
    checkbox (mutually exclusive — checking Missing disables/clears the
    date field; when Missing is set, the stored date becomes a sentinel
    "1900-01-01" rather than blank, so it always reads as maximally
    overdue instead of "not yet looked at"). PRN medications
    additionally get a free-text Quantity field.
  - **Medications Delivered Date** is a single field for the whole
    report (not per-medication) — stored on its own special
    "Medication Delivery Date" row, same pattern as Allergy Info/General
    Notes. Required to finalize.
  - **Save Progress** persists whatever's currently entered, complete
    or not — no validation, safe to leave and come back to.
  - **Finalize Report** validates first: every non-missing medication
    must have an expiration date that isn't already in the past, and
    the report-level delivery date must be set. A medication marked
    Missing is exempt from the expiration-date check. Failing either
    blocks finalizing with a message naming which medications (or the
    delivery date) need attention. Passing updates the MAR Review
    Periods tracker (separate from the medication data itself) with the
    finalized period, date, and who finalized it.
  - **Submission window:** each target period only opens for editing 7
    days before its due date (`windowOpenDate`, a named constant in
    `lib/mar-review-state.js`). Before that, the screen shows the last
    finalized period's data **read-only** (every field disabled, Save/
    Finalize hidden) with a banner like "November review opens October
    24, 2026." `confirm-mar-review` and `finalize-mar-review` both
    reject writes for a period before its window opens (403), not just
    the UI hiding the form. Once the new period gets finalized, the
    read-only view is replaced by the normal in-progress/due status for
    whatever period comes next.
  - **Data wipe timing:** the medication rows (Missing, Current Exp
    Date, Quantity) and delivery date get blanked out the first time
    the *next* period's window opens — not at finalize — since a
    location can miss finalizing entirely and the next period still
    needs to start blank. This happens lazily on the first
    `get-mar-review` or `confirm-mar-review` call on/after the window
    opens, tracked via a `Last Wiped Period` field on the period tracker
    so it only happens once (`wipeIfWindowJustOpened` in
    `lib/mar-review-state.js` — the single place all three MAR
    functions go through for this, rather than each reimplementing the
    staleness check).
  - A red-bordered Allergies banner sits at the top (editable), sourced
    from a special "Allergy Info" row, same pattern as the "General
    Notes" row used elsewhere.
  - The Home button includes a colored status dot: solid green only
    once finalized for the current target period, flashing yellow if
    that period's due date is within 7 days, flashing red if overdue
    (including a period that was never finalized in time — this
    self-corrects each month rather than getting stuck). Below it, two
    status lines: a permanent **history** line for the period right
    before the current one (`October: finalized Sep 18`, or a flagged
    `October: not finalized` if its window closed without it), and a
    **current** line for the in-flight period (`November opens Oct 24`
    while locked, `November: In progress` once a draft's been saved,
    or `November: Not started` once the window's open but untouched).
    **One button per resident** — if an account has more than one
    resident, each gets its own MAR Review button, own status dot, own
    screen instance (pass `?resident=XX` to `get-mar-review`, or
    `resident` in the POST body for confirm/finalize, to scope to one
    specific resident).
- All five report buttons (First Aid, Fire Drill, Emergency Supplies,
  Physical Environment, MAR Review) now show the same red/yellow/green
  status dot, driven by each report's own due-date logic.
- Serious Incident Report: a solid-orange button at the very bottom of
  Home, alongside Log an Event (distinct from everything else,
  deliberately not color-coded by due date since it's not a recurring
  compliance report). Writes into
  the **existing** Serious Incident Report database shared with your
  other staff-facing systems, not a new one — this app only fills in
  Name, Location, Resident Involved, Date of Incident, Location of
  Incident (added — the specific spot within the home, distinct from
  the facility-level Location field), Description of Incident, Status
  (added — set to "Submitted" here; staff update it from Notion
  directly as it moves through review), and Submitted By. The other
  existing fields (Type of Incident, Staff Involved, Immediate Actions
  Taken, Notifications Made, Follow-up Required/Description) are left
  for staff to fill in during formal review — this app only captures
  the initial in-the-moment report. Submitting shows a confirmation and
  returns to Home; the screen also lists every incident reported for
  that location (date, name, status — no date-range limit, since these
  should be rare enough that full history is more useful than a
  recent-only window). **Immediately texts every admin granted that
  location** (not sponsors) the moment it's submitted — this is a
  real-time send, not part of any scheduled check.
  - **QR-code, no-login public reporting** (`public/report-incident/`,
    `public-create-serious-incident.js`) — a standalone page, entirely
    separate from the provider app, that anyone can reach by scanning a
    printed QR code and submit a report from with no account or login at
    all: the same trust model as the paper form it replaces (physical
    presence wherever the code is posted is the boundary, not a
    password). It's the one write endpoint in this app without
    `requireSession`, on purpose, and submit-only by design — unlike the
    in-app screen, it never reads back incident history, since anyone
    with the URL could load it. Deliberately independent of the app's
    six residential facilities — this reporting path isn't tied to any
    of them, so the page asks nothing about location at all; the
    function stamps every record's `Location` with a fixed placeholder
    (`Headquarters`, the `LOCATION` constant in
    `public-create-serious-incident.js`) purely so the Notion row is
    shaped like every other Serious Incident record. It also asks for
    **Your Name** explicitly, since there's no session identity to
    stamp `Submitted By` with; every other field matches the in-app
    screen. Writes to the exact same Notion database, with
    `Submitted By` suffixed " (via public QR form, no login)" so a
    reviewer can always tell which path a given report came through —
    and fires the same immediate SMS alert, but to **every enabled
    admin regardless of granted location** (`allEnabledAdmins` in
    `lib/notification-recipients.js`), not the location-filtered
    `recipientsForLocation` the in-app screen uses — location-based
    filtering would reach nobody here unless an admin happened to be
    granted the `Headquarters` placeholder specifically. After a
    successful submit, the page pops a confirmation `alert()` and then
    calls `window.close()` — that actually closes the tab only when the
    browser opened it via script, which a tab reached by scanning a QR
    code generally isn't, so the on-page success message stays visible
    underneath as the fallback ("You may now close this window") when
    the tab doesn't close itself. **Nothing here actually verifies
    physical presence** — the QR code just encodes a plain URL, so
    anyone who obtains it (photographs it, has it forwarded, or finds
    the function's path some other way) can submit from anywhere, and
    there's no per-caller rate limiting. A hidden honeypot field
    (`si-hp` in the page, checked as `company` in the function) quietly
    no-ops a simple bot that fills in every field it finds, and every
    free-text field is length-capped server-side — but neither of those
    stops a deliberate, targeted abuser. That trade-off (the same one
    the paper form already had — a stranger could always fill one out
    and drop it in the box) was chosen on purpose for zero-friction
    reporting; add real rate limiting (e.g. Netlify's own, or a
    signed/expiring token baked into the QR code) if that stops being
    an acceptable risk.
- **MAR Review sits right under the home card.** Its own button(s) —
  one per resident, full-size like every other report button — render
  in a dedicated block between the home card and the main action list,
  reflecting that MAR is the most time-sensitive item on this screen.
  Unchanged behavior otherwise (tapping opens the same MAR Review
  screen as before).
- **Last/Next Site Visit** shown right on the home card, under the
  location line — sourced from the admin dashboard's Monthly Checklist
  (see the Monthly Checklist section below), read-only.
- **Home screen order:** the reports with their own progress/status
  (First Aid, Fire Drill, Emergency Supplies, Physical Environment,
  MAR) come first; the view-only info box comes next; Log an Event and
  Serious Incident Report — neither of which is a "check on where things
  stand" screen — sit at the very end, after it, so they read as
  distinct from the view-only content above them.
- **"For your information (view only)" section**, its own bordered/
  shaded box (`.info-section`) so it reads as one visually distinct
  group rather than blending into the buttons above or below it: one
  red/yellow/green dot per resident for Annual Planning and Quarterly
  Reporting, plus one row per active staff member (by name) for Staff
  Training — all three processes sponsors can see but not act on (the
  actual workflows only exist on the admin dashboard). Plain rows, not
  buttons; nothing here is tappable. Backed by three new read-only
  endpoints that reuse the same window/cycle logic the admin dashboard's
  own oversight boards run:
  - `get-provider-annual-planning-status.js` — per resident, worst
    across every service on file (`computeAnnualPlanningWindow`);
    overdue is red, due within 7 days is yellow, otherwise green
    (including "not started" and "opens later," neither of which is
    urgent yet).
  - `get-provider-quarterly-reporting-status.js` — per resident, worst
    across every service's current AND prior cycle (see Quarterly
    Reporting's own priorCycle section above). No lead time on any
    quarter, so an open-and-incomplete quarter already means due right
    now: exactly one such quarter is yellow, more than one (fallen
    behind across a quarter boundary) is red.
  - `get-provider-staff-training-status.js` — one row per active staff
    member at the location, each with their own dot (unlike the other
    two, this one isn't collapsed to a single worst-of row, since the
    sponsor asked to see it broken out by person). A yellow/red row also
    shows why — `missingCount`/`doneCount`/`totalCount` (`STEPS.length`,
    not a hardcoded copy of it) and `dueDate`/`isOverdue` come back raw
    from the endpoint, and the client's `staffTrainingReasonText`
    formats them into "Incomplete (14/19)" or "Overdue Oct 1, 2026" —
    the same wording as the admin dashboard's own `staffPuzzleState`,
    just computed independently since the two surfaces don't share a
    render path. A green row shows no reason; there's nothing to explain.
  - The red/yellow/green day-count bucketing and the worst-of-a-list
    helper are both shared from `lib/report-due-date.js`
    (`statusForDaysUntilDue`, `worstOf`) rather than being redefined in
    each new endpoint.

## Notifications (SMS)

Three scheduled functions (`@daily` in netlify.toml — they run every day
and self-gate on whether today is actually a trigger day, since "7
days before month-end" lands on a different date each month):

- **`check-report-status.js`** — fires on 3 checkpoints per month
  (7 days before calendar month-end, 2 days before, and the 1st of the
  month). For each location, checks First Aid Supplies, Fire Drill,
  Emergency Supplies, Physical Environment, and each resident's MAR
  Review against their existing due-date logic, and — only if at least
  one is due-soon or overdue — sends **one combined text** naming just
  those (a location where everything's current gets no text at all).
- **`check-mar-medication-alerts.js`** — runs every day (not just the
  3 checkpoints, since an expired or missing medication is urgent the
  day it happens). Standalone message per location, separate from the
  combined one, listing any medication currently expired or marked
  Missing, by resident.
- **`check-mar-review-reminders.js`** — a dedicated MAR-only escalation,
  admins only (same "who gets texted" pattern as Serious Incident, not
  the combined sponsors+admins list above). Per resident/location, three
  checkpoints against that resident's own MAR Review window: 7 days
  before due (the moment the submission window opens), 2 days before
  due, and the 1st of the new month if the period that just closed is
  still not finalized. Each checkpoint is anchored to an exact calendar
  date (not a live day-count) and guarded by its own dedupe flag on the
  MAR Review Periods tracker (`Reminder 7 Day Sent Period` / `Reminder 2
  Day Sent Period` / `Reminder Overdue Sent Period`, each holding the
  period string it fired for) so a same-day retry never double-sends —
  and since the flags are period-scoped, they reset naturally once the
  target period advances. Already-finalized periods are skipped
  entirely. See `lib/mar-reminder-check.js`.

Both use `lib/notification-recipients.js` to resolve who gets texted
for a location: every enabled sponsor there, plus every enabled admin
whose Granted Locations includes it (deduplicated by phone number) —
except `check-mar-review-reminders.js`, which filters that same list
down to admins only.

**App access vs. getting the routine notifications are two separate
switches.** `Provider App Enabled`/`Admin App Enabled` gate login only.
A second checkbox, `Routine Notifications Opted Out` (on both the
Sponsors and Admin Accounts databases, added manually — this app never
creates database schema, only rows), gates whether that person's phone
(or, for admins, their inbox too) is included in the *routine*
compliance channels — the combined report-status/medication texts
above, `lib/mar-reminder-check.js`'s admin-only escalation,
`lib/window-opened-alert-check.js`'s admin-only "process opened"
texts, and the weekly admin email digest below. It's deliberately an
opt-**out** flag rather than opt-in: a brand-new row, or any row this
property is simply never touched on, reads as `false` (via `getPlainText`,
which returns `''`/falsy for a property that's missing entirely too —
no unguarded `.checkbox` access that could throw on a schema mismatch)
and keeps getting routine notifications same as always. Only a row
someone explicitly checks stops receiving them. `recipientsForLocation`
in `lib/notification-recipients.js` attaches this as
`routineNotificationsOptedOut` per recipient, and a second exported
function, `routineRecipientsForLocation`, wraps it with the `!opted-out`
filter baked in — every routine-notification call site uses that
wrapper (not the raw function) specifically so a future check file
can't forget to filter and accidentally reintroduce the old
everyone-gets-everything behavior. **Serious Incident Report's
real-time admin alert (`create-serious-incident.js`) deliberately calls
`recipientsForLocation` directly and always fires regardless of this
flag** — it's a different kind of notification (an actual incident
just happened) from routine "something's due/expiring," so app access
alone (not this opt-out) is what decides whether someone gets that one.

Email isn't wired up for the three checks above yet — those are
SMS-only for now. (The weekly admin digest below is the one exception,
sent via EmailJS.)

**New Notion properties needed on MAR Review Periods** (rich text,
added manually — this app never creates database schema, only rows):
`Last Wiped Period`, `Reminder 7 Day Sent Period`, `Reminder 2 Day Sent
Period`, `Reminder Overdue Sent Period`.

## Admin Dashboard

A new, separate surface from both the provider app and the Super Admin
provisioning tools (`/admin/*.html`) — `public/admin-dashboard/`, tabbed
between processes. First capability: **MAR Review oversight**, a
read-only status board across every location an admin is granted, not
just the one they logged into a report with.

- **Auth:** its own login/OTP pair (`admin-dashboard-login.js` /
  `admin-dashboard-verify-otp.js`), separate from `provider-login.js` so
  the existing provider-app session shape and flow are untouched. Same
  bar as everywhere else — email + any one of your granted locations'
  passwords + SMS OTP — but the resulting session carries the admin's
  **full** `grantedLocations` list instead of locking to the one
  location whose password was used. Its own session key/token
  (`asrs_admin_dashboard_session`), 12-hour TTL, same AES-256-CBC
  pattern as every other session in this app.
- **Data:** `get-mar-review-oversight.js` loops every granted location
  and every active resident there, computing each one's MAR Review
  window state with the exact same `lib/mar-review-state.js` used by
  the provider app's `get-mar-review`/`confirm-mar-review`/
  `finalize-mar-review` — so the status shown here can never drift from
  what those functions would actually enforce. All lookups run in
  parallel (`Promise.all`), since this is a synchronous page load, not
  a scheduled background job with a longer time budget.
- **View-only, deliberately.** No save/finalize action lives on this
  page — an admin who needs to actually update a review still logs into
  the provider app with that specific location's password, same as
  today. Keeping writes confined to the one place that already enforces
  the submission window and validation rules avoids a second,
  easy-to-drift code path for the same mutation.
- Each resident card shows the same two-line History/Current convention
  as the provider app's Home screen (see `marHistoryLine`/
  `marCurrentLine` there) — duplicated in this page's own script rather
  than shared, since there's no build step/bundler in this project and
  every other small formatting helper here is already duplicated
  per-page the same way.

**Adding a process to this dashboard** means: a new read-only
`get-*-oversight.js` function following the same
loop-over-`session.grantedLocations` shape, and a new tab on this same
page (reusing its existing login/session) — the auth and session
plumbing above doesn't need to change.

### Annual Planning (second process — unlike MAR, this one writes)

One resident-annual, not calendar-anchored: each resident has their own
Effective Date, and their cycle runs exactly one year from it
(`lib/annual-planning.js` — `computeAnnualPlanningWindow`, the same
rolling-window shape as `lib/mar-review-state.js`, just resident-anchored
instead of month-anchored). 10 required documents, each satisfied by
either an upload or (for now, only Authorization for Release —
see `STEPS` in that file) a preconfigured JotForm.

**Due date vs. period end — two different dates, both derived from
Effective Date:** annual planning for an upcoming period has to be
finished *before* that period starts, so `computeDueDate` returns the day
*before* the effective date (e.g. effective 2026-02-01 is due 2026-01-31)
— that's the deadline shown to admins and what the lock window counts
down to. The Drive folder name instead needs the full year the packet
covers (e.g. `20260201-20270131`), so `computeFolderName` uses a
separate `computePeriodEndDate` (effective date + 1 year − 1 day) —
never `computeDueDate` — to build it.

- **Notion:** new "Resident Annual Planning" database (`ANNUAL_PLANNING_DB_ID`),
  one active row per Location + Resident + Service, reused across cycles
  the same way MAR Review Periods is — never one row per year. Holds the
  Service, the Drive folder link (permanent, set once), Effective Date, a
  Done checkbox + filename per document, and the finalize flag/date/by.
- **Multiple services per resident:** a resident can be enrolled in more
  than one service at once (e.g. Congregate Residential AND Non-Center-Based
  Day Support), each with its own Drive folder and its own independent
  cycle — same resident, unrelated rows in the database, distinguished by
  the `Service` select field (`SERVICES` in `lib/annual-planning.js`:
  Congregate Residential, Non-Center-Based Day Support, Positive Behavior
  Support). Congregate Residential (`DEFAULT_SERVICE`) is the one every
  resident always gets a button for, since residents are otherwise scoped
  by physical Location everywhere in this app; the other services only
  appear once a record for them exists. `findRecordsForResident` (used only
  by the oversight board) returns every service a resident has on file, so
  the dashboard can show "add a service" for whichever of `SERVICES` isn't
  in use yet without guessing. An unset/legacy `Service` value (a row from
  before this field existed) is treated as the default service —
  `findRecord`'s filter matches it via an explicit `is_empty` branch, since
  Notion's `select.equals` won't match an empty value on its own.
- **The lock:** a resident's card is locked (green, still puzzle) until
  6 weeks before due (`WINDOW_WEEKS_BEFORE_DUE`), then unlocks (bright
  gold, slowly rotating puzzle, CSS `@keyframes puzzleSpin`). The puzzle
  itself is a shared inline SVG (`createPuzzleIcon` in
  `admin-dashboard/index.html`), not the 🧩 emoji it used to be — an
  emoji glyph's color is fixed by the OS/browser and can't be
  recolored with CSS, so switching it green/gold needed a real
  `fill="currentColor"` icon instead. A brand new resident
  with no cycle on file yet is always unlocked, so Step 1 is reachable
  to bootstrap it. Server-enforced the same way MAR's window is — every
  write endpoint checks `isWindowOpen` before touching anything.
- **Finalize stays "finalized" for the full year**, not just until the
  target rolls forward — unlike MAR's `isFinalizedForTarget` (which
  becomes true only very briefly, since MAR's target always advances the
  instant something's finalized), a finalized Annual Planning cycle
  needs to read as locked/link-only for ~11 months. The record only
  rolls into the next cycle (wiping all 10 steps, same lazy timing as
  MAR's `wipeIfWindowJustOpened`) once the *next* cycle's own window
  opens — see `rollToNextCycleIfWindowJustOpened`, called from every
  endpoint via the single `loadCurrentRecord` entry point, not just the
  read one, so a stale finalized record can never be acted on directly.
- **The one manual step:** the app has no way to discover a resident's
  Drive folder on its own (it only knows initials, not full names, and
  Drive folders are named by full name). The first time a resident goes
  through this in the app, an admin pastes the link to their existing
  `.../Residents/<Full Name>/Annual Planning` folder; the Drive folder
  ID is parsed out of that URL and remembered on the record permanently
  (`Annual Planning Folder URL`) — never asked for again.
- **Uploads** reuse the direct-browser-to-Zapier pattern from Log an
  Event attachments (`get-annual-planning-upload-config.js` hands back
  the webhook URL + the resident's parent folder ID + this cycle's
  folder name, e.g. `20260201-20270131`), but the Zap itself is new
  (`ZAPIER_ANNUAL_PLANNING_WEBHOOK_URL`): Catch Hook → Google Drive
  "Find a Folder (or Create it)" → Upload File. Because "Find or Create"
  is idempotent, every document for the same cycle lands in the same
  folder without this app ever learning a folder ID back from Zapier —
  which sidesteps needing a synchronous response from an
  otherwise-fire-and-forget webhook.
- **New env vars:** `ANNUAL_PLANNING_DB_ID`, `ZAPIER_ANNUAL_PLANNING_WEBHOOK_URL`,
  `ANNUAL_PLANNING_AUTH_RELEASE_FORM_URL` (the JotForm for
  Authorization for Release — the only step with a form today; add a
  `formUrl` to any other entry in `STEPS` in `lib/annual-planning.js`
  to light up a form option for it too, upload always still works
  regardless), and `ANNUAL_PLANNING_FORM_WEBHOOK_SECRET` (below).
- **Completing a form marks the step done the same way an upload does —
  and this is deliberately form-template-agnostic**, so adding a new
  JotForm template later needs zero new Zaps. Clicking "Complete Form"
  opens the form with a prefilled hidden field, `app_filename`, built
  with the exact same filename convention as a direct upload
  (`"{location}_Resident_{resident}_{service}_{stepKey}_{effectiveDate}"`,
  built once in `renderStepSection` and reused by both paths — see
  `sanitizeForFilename`). Every template just needs its own native
  JotForm → Google Drive integration (Settings → Integrations, not
  Zapier) turned on, saving the completed PDF into one shared staging
  folder using `app_filename` as the saved file's name.

  One reusable Zap then does the rest, for every template, forever:
  Google Drive "New File in Folder" (watching that one staging folder)
  → POST the filename to `annual-planning-resolve-upload.js`, which
  parses it back into location/resident/service/stepKey
  (`parseFilename` in `lib/annual-planning.js` — lossless for location
  and resident initials since neither has spaces/hyphens today;
  service needs a small reverse lookup since `sanitizeForFilename`
  strips those) and returns the resident's actual Drive parent folder
  ID + this cycle's folder name → Google Drive Find/Create Folder
  → Google Drive Move File (out of the staging folder, into the
  resolved one) → POST to `annual-planning-form-submitted.js` with the
  shared secret plus what the resolve call returned, which calls the
  same `markStepDone` helper `save-annual-planning-step.js` uses — same
  end state regardless of which path produced the document. Both
  webhook endpoints are Zapier-facing, not browser-facing — no session,
  just `ANNUAL_PLANNING_FORM_WEBHOOK_SECRET`, same pattern as the
  `test-check-*.js` cron-adjacent endpoints.

### Staff Training & Development (third process — per-item dates, no cycle)

One button per active staff member/sponsor in each location an admin is
granted (`get-staff-training-oversight.js`, `staffListForLocation` in
`lib/staff-training.js`). 19 required items (First Aid/CPR, Behavior
Management Training, Medication Administration Refresher, Human Rights,
HCBS, Serious Incident Reporting, Universal Precautions/Infectious
Controls, Emergency Preparation/Crisis Management, HIPAA Training, DSP
Competencies Assessment Report, Annual Performance Evaluation & Review,
ASRS Role and Responsibilities, TB Test/Assessment, Behavior Supports for
DSPs, Autism Supports for DSPs, Person Centered Thinking Training, Shared
Planning & Goals, How We Treat Our Residents, Psychological First Aid —
see `STEPS` in `lib/staff-training.js`), each satisfied by either an
upload or (once a `formUrl` is set for it) a preconfigured JotForm, same
two paths as Annual Planning.

**No shared cycle, no finalize — unlike Annual Planning and MAR.** Every
one of the 19 items has its own independent expiration date, set
whenever *that specific item* is completed, and just renews on its own
schedule forever. There's nothing to lock or roll forward, so unlike
Annual Planning's `isWindowOpen` check on every write, any item can be
updated at any time.

- **Notion:** new "Staff Training Items" database
  (`STAFF_TRAINING_DB_ID`), one active row per Location + Staff Name +
  Step Key (row-per-item, not row-per-cycle like Annual Planning's
  row-per-service) — closer in shape to First Aid Supplies/Emergency
  Supplies' per-item expiration than to Annual Planning. Staff/location
  data itself comes from the existing "ASRS People" database
  (`ASRS_PEOPLE_DB_ID`, `Type` = Staff), which also gained a permanent
  `Training Folder URL` column, set once per staff member the same way
  Annual Planning's folder link is.
- **Next due date = the literal next expiration, no offset** —
  `computeStaffDueDate` takes the earliest `Exp Date` across all 19
  items once every item has been completed at least once; returns `null`
  (reads as "incomplete") until then. This is deliberately different
  from MAR/Annual Planning/Supplies, which all subtract a lead time from
  their due date — here the spec is "next due date will be when the next
  document expires," full stop.
- **The puzzle only controls the spin, not a lock:** it turns yellow and
  starts spinning 30 days before that next expiration
  (`WINDOW_DAYS_BEFORE_DUE` in `lib/staff-training.js` — the same
  `puzzleSpin` CSS Annual Planning uses, just a 30-day threshold instead
  of 6 weeks), and shows the due date on the button. There's no gray
  "locked" state the way Annual Planning has, since nothing is ever
  locked here.
- **The one manual step:** same pattern as Annual Planning's Drive
  folder — the first time a staff member goes through this, an admin
  pastes the link to their existing ongoing Training folder in Drive;
  the folder ID is parsed out and remembered permanently
  (`Training Folder URL`). One ongoing folder per staff member, not a
  dated subfolder per cycle, since there's no cycle to date a folder by.
- **Filename convention uses the staff member's Notion page ID, not
  their name:** `"{location}_Staff_{staffId}_{stepKey}_{expDate}"`
  (`buildFilename`/`parseFilename` in `lib/staff-training.js`). Unlike
  resident initials or Annual Planning's small, fixed `SERVICES` enum, a
  full name like "Ovetis Cooper" can't be losslessly recovered once
  `sanitizeForFilename` strips its spaces — there's no closed set to
  reverse-lookup against. The page ID has no such problem, and
  `staffInfoById` (backed by a new `getPage` helper in `lib/notion.js`)
  resolves it back to the real name/location/folder server-side.
- **Uploads and forms** reuse the exact same two-webhook shape as Annual
  Planning (`get-staff-training-upload-config.js`,
  `staff-training-resolve-upload.js`, `staff-training-form-submitted.js`,
  same `ANNUAL_PLANNING_FORM_WEBHOOK_SECRET` — deliberately not a new
  env var, since these are just more Zapier-facing endpoints on the same
  admin dashboard), with one simplification: no "Find/Create dated
  subfolder" Zap step, since every document goes straight into the one
  ongoing folder — Move File can target the resolved `parentFolderId`
  directly. **New env vars:** `STAFF_TRAINING_DB_ID`, and
  `ZAPIER_STAFF_TRAINING_WEBHOOK_URL` for the direct-upload path (a new
  Zap, simpler than Annual Planning's for the reason above). No step has
  a `formUrl` set yet — add one to any entry in `STEPS` to light up its
  "Complete Form" option, same as Annual Planning.

### Quarterly Reporting (fourth process — tied entirely to Annual Planning)

No independent existence of its own: four fixed reports (Quarterly
Progress Report, Client Satisfaction Interview, Comprehensive
Re-Assessment, Person Centered Assessment) due every 3 months, anchored
to the SAME Effective Date and Drive folder a resident/service already
has on file for Annual Planning — no separate one-time setup step, no
finalize step, no independent existence for a resident/service that
doesn't already have an Annual Planning cycle.

- **Notion:** new "Quarterly Reporting Items" database
  (`QUARTERLY_REPORTING_DB_ID`), one active row per Location + Resident
  Initials + Service + Quarter Start Date + Step Key — row-per-item
  like Staff Training, not row-per-cycle like Annual Planning, since
  each of the 16 slots across a year (4 quarters × 4 reports) has its
  own independent completion state.
- **Quarter boundaries** (`computeQuarters` in
  `lib/quarterly-reporting.js`): four 3-month spans starting at the
  Effective Date, each one's due date landing exactly on the day the
  *next* quarter begins — e.g. effective `2026-11-01` gives Q1
  `2026-11-01`–`2027-01-31` due `2027-02-01`. **Deliberately anchored on
  the resident's record's actual stored `Effective Date`, never
  `computeAnnualPlanningWindow`'s projected `targetEffectiveDate`** —
  that function intentionally shows Annual Planning's next cycle up to
  6 weeks early so its own UI can unlock ahead of time, but the record
  itself (and therefore the real calendar quarters) doesn't move until
  someone actually opens that resident's Annual Planning detail screen
  and `rollToNextCycleIfWindowJustOpened` fires. Anchoring Quarterly
  Reporting on that same early-projected date would make whichever
  quarter is genuinely open right now silently disappear for that same
  ~6-week stretch every year, with no way to complete it until the
  roll happens — this bit a first draft of this feature before it
  shipped.
- **No lead time, unlike Annual Planning/Staff Training:** the puzzle
  turns yellow and spinning the *instant* a quarter ends — there's no
  earlier "due soon" warning window the way Annual Planning unlocks 6
  weeks early or Staff Training warns 30 days out. Per quarter/service,
  `activeQuarter` picks the earliest open-and-incomplete quarter to
  drive the button's state; every write is still gated server-side
  (`save-quarterly-reporting-step.js` re-derives the quarters and
  rejects an upload for one that isn't open yet) — unlike Staff
  Training's anytime model, this one really does lock.
- **Drive folder nests two levels inside the existing Annual Planning
  folder**, not a separate link: `AnnualPlanningFolder/{dated cycle
  folder, e.g. 20261101-20271031}/Quarterly Report/`. The dated
  subfolder name reuses `computeFolderName` from `lib/annual-planning.js`
  directly, so it always matches the same folder Annual Planning's own
  Zap already created — `get-quarterly-reporting-upload-config.js`
  hands back both folder names (`cycleFolderName`, `subfolderName`) plus
  the resolved root `parentFolderId`, and the Zap does two Find/Create
  Folder steps before Upload File.
- **Uploads only — no form path.** Since there's no reusable "any form
  template" Zap for this process, filenames here never need to be
  parsed back out of anything (unlike Annual Planning/Staff
  Training's `parseFilename`) — they're built once client-side
  (`buildQuarterlyFilename` in `admin-dashboard/index.html`) purely to
  be human-legible in Drive.
- **New env vars:** `QUARTERLY_REPORTING_DB_ID`,
  `ZAPIER_QUARTERLY_REPORTING_WEBHOOK_URL` (a new Zap — Catch Hook →
  Find/Create Folder (cycle) → Find/Create Folder (Quarterly Report,
  nested) → Upload File).
- **Prior cycle ("catching up" on the outgoing period).** A resident's
  next Annual Planning packet often has to start well before the
  outgoing period's own quarterly reports can be finished — you can't
  report on a quarter/period until it's actually over, so the real-world
  cutover point lands right around when the next cycle's Annual Planning
  early-unlock window is also opening. Since Annual Planning keeps only
  ONE row per Location + Resident + Service (reused across years, not
  one row per year), its `Effective Date` can only represent one cycle's
  position at a time — so once it's rolled forward onto the next cycle,
  Quarterly Reporting also computes a second, **prior** cycle exactly one
  year behind it (`effectiveDateForCycle`/`computeQuarterlyReportingForRecord`
  in `lib/quarterly-reporting.js`) and surfaces it as its own puzzle
  button/detail screen whenever it still has something incomplete. It's
  fully self-resolving: it only appears once at least one report was
  ever actually uploaded against it (so a resident's very first cycle
  never fabricates a false "overdue" prior year), and it disappears on
  its own the moment it's caught up — no manual toggle, no cleanup step.
  Every endpoint that's cycle-aware (`get-quarterly-reporting.js`,
  `get-quarterly-reporting-upload-config.js`) takes a `cycle=current|prior`
  query param and re-validates a requested prior cycle genuinely exists
  server-side rather than trusting the client; `save-quarterly-reporting-step.js`
  doesn't need the flag at all, since a quarter's start date alone (a
  year apart between cycles) is already unambiguous. Also flagged in the
  weekly admin digest (`checkQuarterlyReporting` in
  `lib/admin-digest-check.js`) alongside the current cycle's own line.

### Monthly Checklist (fifth process — per location, not per resident)

One shared 12-item checklist template, one Notion row per Location +
Month (never wiped or reused — every month is its own permanent record,
so full history lives in Notion with no extra archiving step). Unlike
every other process in this app, it's retrospective: it reports on the
month that's happening or just happened, rather than looking ahead to
one that hasn't started yet.

- **Notion:** new "Monthly Checklist" database (`MONTHLY_CHECKLIST_DB_ID`),
  one active row per Location + Period (`YYYY-MM`). See
  `netlify/functions/lib/monthly-checklist.js`'s `ITEMS` array for the
  exact property names/types to create — 2 date properties (`Last Site
  Visit`, `Next Planned Site Visit`), 10 select properties with Yes/No
  options (a select rather than a checkbox specifically so "answered
  No" and "never answered yet" aren't the same blank state — Finalize
  needs to tell those apart), 1 rich_text property (`Improvement
  Notes`), plus the usual `Location` (select), `Period` (rich_text),
  `Active`/`Finalized` (checkbox), `Finalized Date` (date), `Finalized
  By` (rich_text), and a title property (`Record Title`).
- **Template is code-level, not admin-editable.** Same convention as
  Quarterly Reporting/Staff Training's fixed `STEPS` arrays — adding or
  removing one of the 12 items means editing `ITEMS` in
  `lib/monthly-checklist.js` (plus the matching Notion property), not a
  self-service UI. There's only one template shared by every location,
  so a code change already applies everywhere at once.
- **Rolling target period** (`resolveTarget` in
  `lib/monthly-checklist.js`): the mirror image of MAR Review's
  forward-looking `computeMarTarget` (`lib/mar-period.js`) — this looks
  backward instead of forward. Target is the EARLIEST month, from the
  earliest one a location has any record for through the current month,
  that isn't finalized yet — walked month by month (not jumped straight
  from the last *finalized* period) so a month that was started, or even
  never touched at all, but never finalized stays the target instead of
  silently getting stepped over once the calendar rolls past it. Nothing
  on file yet at all means nothing to catch up on, so a brand-new
  location's target is just the current month.
- **No early-unlock window**, unlike Annual Planning/Staff Training — a
  retrospective report on the current month is workable the moment that
  month begins. But finishing early still produces a brief locked state:
  the target stays capped on that same month (now finalized) until the
  calendar actually reaches the next one, since there's nothing to
  advance to yet. The admin dashboard renders that the same way Annual
  Planning renders `isFinalizedForTarget` — locked, read-only, with a
  "next opens \<date\>" banner.
- **Save Progress / Finalize**, same split as MAR Review: Save Progress
  writes whatever's currently entered with no validation; Finalize
  requires all 12 items have a real value (`missingItems` in
  `lib/monthly-checklist.js`) and blocks with a message naming what's
  still missing. Both endpoints re-resolve the target server-side rather
  than trusting a client-supplied period, so a stale screen can't
  accidentally write into the wrong month.
- **"Due" shows the last day of the target month, not the first of the
  next one.** The actual overdue threshold is still the instant the next
  month begins (`dueDate` in `resolveTarget`) — that never changed — but
  what admins are shown for "Due ..." is a separate `dueDisplayDate`
  (`dueDisplayDateForPeriod` in `lib/monthly-checklist.js`), the target
  month's real last calendar day, so October's row reads "Due Oct 31,"
  not "Due Nov 1." The "Finalized — next opens ..." wording (shown after
  finishing early) still uses `dueDate` itself, since that phrasing is
  correctly about the next month's start.
- **Provider app surfacing:** the sponsor's home card shows "Last site
  visit" and "Next planned visit," sourced from `latestSiteVisitDates`
  in `lib/monthly-checklist.js` — the most recent non-blank value for
  each of those two fields across every month on file (not necessarily
  the same row, since a new month's own visit may not have happened yet
  even though its next-planned date was already set). Read-only;
  sponsors never see or edit the rest of the checklist.
- **Checklist history:** since every month is its own Notion row, full
  history is already there to browse directly in Notion — no separate
  archive view was built for it, matching the low priority this was
  given when the feature was scoped.
- **New env var:** `MONTHLY_CHECKLIST_DB_ID`.

### Daily Progress Notes (sixth process — per resident, per day, versioned template)

A daily narrative + compliance checklist per resident, entered from the
provider app under a "Daily Progress Notes" button, signed with an
on-screen signature, and rendered to a PDF every morning for Google
Drive. Unlike every other process in this app, its question set isn't a
fixed code-level list — it's versioned, resident-specific Notion data
that admins edit themselves.

- **Notion:** three new databases, all in
  `netlify/functions/lib/daily-progress-notes.js`.
  - **"Daily Progress Note Questions"** (`DAILY_PROGRESS_NOTE_QUESTIONS_DB_ID`)
    — one row per question per version: `Location` (select), `Resident
    Initials` (rich_text), `Resident Full Name` (rich_text), `Times
    Covered` (rich_text — e.g. "12:00 AM - 11:59 PM" for a note covering
    the full day; printed on the PDF, see below), `Times Covered
    Editable` (checkbox — when set, `Times Covered` on this version is
    unused and every note's covered window is entered by whoever's
    filling it in instead; see below), `Effective
    Date`/`Termination Date` (date), `Question Key` (rich_text, e.g.
    `q1`), `Question Text` (rich_text), `Question Type` (select:
    `Text`/`Checklist`), `Checklist Items` (rich_text, newline-delimited
    — only for `Checklist` questions), `Order` (number), `Active`
    (checkbox — never flipped false; a terminated version's rows stay on
    file, just with a `Termination Date` set).
  - **"Daily Progress Notes"** (`DAILY_PROGRESS_NOTES_DB_ID`) — the
    per-day "cover" row: `Location`, `Resident Initials`, `Resident Full
    Name`, `Times Covered` (copied from the template version in effect
    when the cover is first created, same as `Resident Full Name` — or,
    for a `Times Covered Editable` resident, overwritten on every save
    with whatever the provider entered), `Date`,
    `Template Effective Date` (which version answered this
    day), `Signed By`/`Signed At`, `Signature Strokes` (rich_text,
    JSON-encoded pen-stroke points — see below), `PDF Generated`
    (checkbox), `PDF Drive URL` (url), `Active`.
  - **"Daily Progress Note Answers"** (`DAILY_PROGRESS_NOTE_ANSWERS_DB_ID`)
    — one row per question per day: `Question Key`, plus its own
    snapshotted `Question Text`/`Question Type` (so a historical answer
    stays self-describing even after the template changes again),
    `Answer Text` (rich_text), `Checklist Answers` (rich_text, JSON map
    of item label -> `Yes`/`No`).
- **Versioned template, resolved per-date, not "today's version."**
  `findQuestionsForDate` (`lib/daily-progress-notes.js`) picks the LATEST
  version whose Effective Date is on or before the day in question and
  whose Termination Date (if any) is after it — a half-open
  `[Effective Date, Termination Date)` window. This matters two ways:
  - A resident catching up on a day from before the question set last
    changed must answer the wording that was actually in effect *then*
    (not whatever's active "now") — otherwise a historical note would
    get silently reinterpreted against different questions. So catching
    up on, say, Oct 31 2026 from the real-world date Nov 5 2026 still
    resolves correctly against whichever version actually covered Oct 31,
    even though today's calendar date is well past it.
  - A day that falls **outside every version's window** — before the
    first Effective Date, or on/after the last version's Termination
    Date with no successor published yet — has no valid questions at
    all. Both `save-daily-progress-note.js` and `sign-daily-progress-note.js`
    check for this (`findQuestionsForDate` returning empty) and refuse
    with a clear error rather than silently creating a blank cover row
    for a date with no real questionnaire; the provider app shows this
    proactively as a "no questionnaire published for this date" banner
    instead of a dead blank form.
  - **Off-by-one note on Termination Date's meaning**: the stored value
    is the FIRST day a version no longer applies, not the last day it
    does — so a version meant to run through Oct 31 2026 inclusive needs
    a Termination Date of Nov 1 2026. This is also how auto-succession
    already worked (the old version's Termination Date is set to the
    new version's Effective Date exactly, so there's no gap or overlap).
    Nobody has to think in those terms directly: the admin UI's "Last
    Day This Version Applies" field takes the inclusive last day and
    `save-daily-progress-note-template.js` converts it (`+1 day`) before
    storing; version history displays convert it back
    (`get-daily-progress-note-templates.js`'s `lastValidDate`) for
    display. Only `createVersion`'s own `terminationDate` parameter and
    the raw Notion property use the exclusive form.
- **Self-service admin UI for question versions** (unlike Monthly
  Checklist's code-level `ITEMS`) — admin dashboard's Daily Progress
  Notes tab -> "Manage Question Templates." Publishing a new version
  (`createVersion`/`save-daily-progress-note-template.js`) automatically
  sets the currently-open version's `Termination Date` to the new
  version's `Effective Date`; past days' answers are unaffected since
  they already snapshotted their own question text. A version can also
  be published with its own fixed end date up front (leave "Last Day
  This Version Applies" blank for open-ended, or set it for a template
  whose expiration is already known — e.g. an annual renewal). Chosen
  over a code-level list specifically because this questionnaire changes
  routinely and needs an audit trail an admin can manage without a
  deploy.
- **No-skip-days enforcement, with a picker among what's actually open**:
  `findOutstandingDays` (`lib/daily-progress-notes.js`) returns every
  unsigned day, oldest first, from the earliest one on file through
  today — not just a single locked target. Most days that's one day
  (typically "yesterday," since a sponsor usually enters notes the
  following morning once the day is actually over), but if someone's
  fallen behind, the provider app shows a date picker across every
  outstanding day and lets them work in whatever order they want (e.g.
  sign today's note first, then circle back to one from last week).
  `resolveTarget` still exists and returns just the oldest one — it's
  what a client defaults to when it doesn't ask for a specific date.
  What actually enforces "can't skip a day" is server-side, not the
  picker: `save-daily-progress-note.js` and `sign-daily-progress-note.js`
  both re-derive the outstanding set themselves and refuse any
  client-supplied date that isn't in it — an already-signed day, or
  anything past today, is never accepted regardless of what a request
  claims.
- **Rollout / a resident's very first entry**: the no-skip-days walk
  above only ever starts from the earliest cover already on file — for
  a resident with *no* covers yet at all (a brand-new rollout, even one
  whose questionnaire's Effective Date is many months in the past), that
  would otherwise force literally today as the only option, which
  doesn't fit "notes are usually entered the following morning."
  `resolveDayOptions` (`lib/daily-progress-notes.js`) detects this case
  (`isFirstEntry`) and instead allows ANY date within
  `[earliest Effective Date across every version ever published,
  today]` for that one first entry — `initialDateMin`/`initialDateMax`
  in `get-daily-progress-note.js`'s response, rendered as a native
  `<input type="date" min=... max=...>` in the provider app rather than
  the ordinary outstanding-days `<select>`. The moment that first save
  actually happens, a cover exists and every subsequent call falls into
  the ordinary regime above, building forward day-by-day from whichever
  date was chosen — nothing before it is ever retroactively required.
  `save-daily-progress-note.js` and `sign-daily-progress-note.js` validate
  a client-supplied date against whichever regime actually applies
  (`resolveDayOptions`'s `isFirstEntry` flag), never trusting it outright
  either way.
- **Save Progress / Sign & Submit**: Save Progress writes whatever's
  entered with no validation (`saveAnswers`); signing
  (`sign-daily-progress-note.js`) requires every question answered
  (`missingQuestions` — every Text question non-blank, every Checklist
  question's every item Yes/No) plus a non-empty signature, and blocks
  with a message naming what's missing.
- **Signature is captured as vector pen strokes, not an image**
  (`Signature Strokes`, a JSON array of point arrays from the provider
  app's canvas signature pad) — chosen because this app's Google Drive
  integration is write-only via Zapier, with no way to read an uploaded
  image back out. The nightly PDF job replays the strokes as vector line
  drawing directly into the PDF. A real signature's point data
  comfortably exceeds Notion's 2000-character-per-rich_text-block limit,
  so it's split across multiple blocks via `chunkRichText`
  (`lib/daily-progress-notes.js`) — Notion concatenates them back into
  one string on read with no special handling needed. The same helper
  covers `Answer Text`/`Checklist Answers` too, in case a long dictated
  paragraph ever hits the same ceiling. Captured points are also rounded
  to whole pixels and thinned (skipping ones closer than 2px together)
  to keep the stored size reasonable in the first place.
- **Dictation**: each Text question has an optional mic button using the
  browser's built-in Web Speech API (`SpeechRecognition`) — no new
  backend service. Support is solid on Chrome/Android; iOS Safari's
  support is spottier, so the mic button is simply omitted when
  `SpeechRecognition` isn't available rather than showing a broken one.
- **Times Covered**: an admin-managed, per-resident free-text field
  (e.g. "12:00 AM - 11:59 PM" for a note covering the whole day, or a
  narrower window for a resident whose note doesn't) set on the "Manage
  Question Templates" form alongside the questions themselves, defaults
  to "12:00 AM - 11:59 PM" for a new version. Follows the same
  copy-once-at-cover-creation pattern as `Resident Full Name`
  (`saveAnswers`) rather than being re-derived on every save, and prints
  on the generated PDF directly under the Date line — some licensing
  agencies require the covered time window to appear on the document
  itself.
  - **Times Covered Editable** — for a resident supported by more than
    one caregiver in a day, the covered window isn't fixed at all: it
    changes note to note and person to person, so a single admin-set
    value can't represent it. Checking "Provider enters times covered on
    each note instead" on that resident's template version (the `Times
    Covered` text field then hides, and is stored blank) switches the
    provider app from showing nothing to showing a required "Times
    Covered by This Note" field above the questions — pre-filled from
    whatever's already saved for that day, if anything. Unlike the fixed
    case, this value is NOT copied once and left alone: `saveAnswers`
    overwrites the cover's `Times Covered` on every save (same treatment
    as `Entered By`), since a different caregiver entering a later note
    for the same day needs their own window to stick, not the first
    caregiver's. `sign-daily-progress-note.js` blocks signing with
    `Still needs: Times Covered` in the missing-questions message if
    it's still blank at sign time, reusing the cover
    `resolveDayOptions`'s day walk already fetched rather than querying
    Notion again. The PDF and every other Times Covered consumer read
    straight from the cover's stored value regardless of which mode
    produced it, so nothing downstream needed to change.
- **Entered By vs Signed By**: every save (`saveAnswers`) stamps the
  cover's `Entered By` with whoever most recently saved (overwritten on
  each save, same "Last Updated By" convention MAR Review uses) —
  distinct from `Signed By`, which is stamped once, at sign time. In
  practice they're usually the same person for this workflow, but
  they're tracked separately so the two can be told apart if that ever
  changes, and the PDF prints both lines.
- **Nightly PDF generation**
  (`netlify/functions/generate-daily-progress-note-pdfs.js`, scheduled
  daily at 9:30am US/Eastern): finds every signed cover with `PDF
  Generated` still false, renders a PDF via `pdf-lib`
  (`lib/daily-progress-note-pdf.js`) containing the resident's name,
  location, "DailyProgressNote," the note's date, the Times Covered
  window, every question and answer, who entered it, who signed it
  (without a signed-at timestamp — the PDF prints the signer's name only,
  not `Signed At`, which is still stored on the cover row and used by the
  oversight dashboard and the failure alert below), and the replayed
  signature, then uploads it to Google Drive through the same Zapier
  Catch Hook ->
  Find/Create Folder -> Upload File pattern every other document upload
  in this app already uses (see "Setting up event attachments" below
  for the general pattern). `PDF Generated` is only flipped true after a
  successful upload, so a failed upload retries the next night rather
  than getting silently skipped. The PDF also carries the ASRS logo,
  top-right of the first page — embedded as a base64 JPEG in
  `lib/arch-support-logo.js` rather than shipped as a separate asset
  file, since Netlify's function bundler doesn't include arbitrary
  static files by default. Header lines wrap narrower than the full page
  width specifically so a long resident name or location can't run text
  underneath the logo.
- **PDF upload failure alert** (`lib/daily-progress-note-pdf-alert.js`,
  run at the tail of the same nightly function — both on a successful
  generation run and on the early-return path when
  `ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL` isn't configured at all,
  since that's the single most likely cause of every note getting
  stuck): texts admins (never sponsors — filtered to `role === 'admin'`,
  same as `window-opened-alert-check.js`) when a signed note's PDF has
  failed to upload for 2+ nights running (`STALE_DAYS` in that file) —
  long enough that it's a real, persistent problem (a broken Zap
  connection, an unset webhook env var) rather than a note that simply
  hasn't had its first nightly attempt yet. Grouped one message per
  location, and — like `mar-alert-check.js`'s medication alerts — fires
  every night the failure persists rather than just once, since there's
  no separate "already alerted" state to track and clear once it's
  fixed. Wrapped in its own try/catch at the call site so a transient
  failure in the alert check itself can never mask or discard an
  otherwise-successful night's actual PDF-generation results. Dry-run
  test endpoint: `test-check-daily-progress-note-pdf-failures.js`
  (same `NOTIFICATION_TEST_SECRET`-gated, POST-required-for-a-real-send,
  `&asOf=` convention as every other `test-check-*.js` in this app).
- **New env vars:** `DAILY_PROGRESS_NOTE_QUESTIONS_DB_ID`,
  `DAILY_PROGRESS_NOTES_DB_ID`, `DAILY_PROGRESS_NOTE_ANSWERS_DB_ID`,
  `ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL`.
- **New dependency:** `pdf-lib` (pure JS, no native deps — this was the
  first feature in this project to need any npm dependency at all; see
  `package.json`).

#### Setting up the Daily Progress Notes PDF upload (Zapier)

Same underlying pattern as event attachments (Catch Hook -> upload to
Drive), but triggered by the nightly scheduled function instead of the
browser, and landing several folders deep instead of at a single flat
location — one folder per resident, one subfolder per month — so the
Zap needs a folder-resolution chain in front of the actual upload
rather than a single Upload File step:

1. New Zap: trigger = Webhooks by Zapier -> Catch Hook. Copy the
   webhook URL into `ZAPIER_DAILY_PROGRESS_NOTE_WEBHOOK_URL` in
   Netlify. The webhook's incoming fields: `file` (the PDF),
   `filename` (already built as
   `DailyProgressNote_Location_ResidentInitials_YYYY-MM-DD.pdf`),
   `location`, `residentInitials`, `residentFullName` (Drive's
   resident folders are named by full name, not initials), `date`
   (`YYYY-MM-DD`), and `yearMonth` (`YYYY-MM`, pre-sliced from `date`
   so the Zap doesn't need its own Formatter step just to name that
   month's subfolder).
2. Google Drive -> Find a Folder, title = the webhook's `location`,
   inside your facilities root folder. Find-only, no auto-create —
   these are real, manually-maintained facility folders, and
   auto-creating one on a typo'd/missing Location would silently
   scatter notes into a new folder instead of surfacing the mismatch.
3. Google Drive -> Find a Folder, title `Residents`, inside the folder
   from step 2. Find-only, same reasoning.
4. Google Drive -> Find a Folder, title = the webhook's
   `residentFullName`, inside the folder from step 3. Find-only.
5. Google Drive -> Find a Folder, title `Daily Progress Notes`, inside
   the folder from step 4. This one *does* get "create if it doesn't
   exist" — every resident eventually needs one, and there's no
   pre-existing thing to typo-match against the way there is for a
   facility or resident.
6. Google Drive -> Find a Folder, title = the webhook's `yearMonth`,
   inside the folder from step 5. Also create-if-missing — a fresh
   folder is expected every new month, by design.
7. Google Drive -> Upload File, folder = the folder from step 6, file
   = the webhook's `file`, filename = the webhook's `filename`.
8. Publish the Zap. The function marks `PDF Generated` true right
   after a successful upload — it does not wait on or record whatever
   the Zap does after that (a "respond immediately" Catch Hook returns
   before the Drive steps even run), so `PDF Drive URL` is left blank
   unless you build a synchronous Zap that hands one back.

## Weekly admin email digest

Separate from the SMS reports above — one email per admin (not
sponsors), covering every location they're granted, listing anything
currently expired, missing, out of range, or open-and-incomplete across
**First Aid Supplies, Emergency Supplies, Physical Environment, Staff
Training, Annual Planning, and Quarterly Reporting** (MAR isn't
included here since it already gets its own daily SMS alert). A
location with nothing wrong still gets its own "No issues found" line
rather than being omitted, so the weekly email always confirms
coverage for every location an admin has. `lib/admin-digest-check.js`
memoizes each location's issue list per run (admins commonly share
granted locations) and builds every admin's digest concurrently, so
the six checks fanning out per resident/staff member don't risk the
function's execution time limit as the roster grows. Requires
`Admin App Enabled` checked AND `Routine Notifications Opted Out`
unchecked on the admin's Admin Accounts row (see the notifications
opt-out note above) — someone with dashboard access who's opted out of
routine notifications doesn't get this email either.

Sent via **EmailJS** (server-side), not Resend — reusing the account
already used elsewhere rather than standing up a new service. Setup
needed on your end:

1. In EmailJS, go to **Account → Security** and enable "Allow API
   calls from non-browser applications." Note your **Private Key**
   from that same page.
2. Create a new **Template** (separate from any existing OTP template)
   with these merge fields: `{{to_email}}` (To field), `{{to_name}}`,
   `{{subject}}` (Subject field), and `{{message}}` (Content — the
   whole formatted digest gets passed as this one field, so the
   template itself can stay simple; it doesn't need to know about
   locations or issues).
3. Add these env vars in Netlify:

| Variable | Value |
|---|---|
| `EMAILJS_SERVICE_ID` | From your EmailJS service |
| `EMAILJS_TEMPLATE_ID` | The new template's ID |
| `EMAILJS_PUBLIC_KEY` | Account → General |
| `EMAILJS_PRIVATE_KEY` | Account → Security |

EmailJS rate-limits to 1 request/second — `lib/admin-digest-check.js`
paces real sends accordingly, so this only matters if you have enough
admins that it becomes noticeable (it won't, at any realistic scale
here).

**Schedule:** Fridays at 8:00am US/Eastern (`0 12 * * 5`, pinned to
EDT — drifts to 7:00am local during EST Nov-Mar).

**Testing:** `test-check-admin-digest.js` follows the same pattern as
the other test endpoints — not scheduled, gated by
`NOTIFICATION_TEST_SECRET`, defaults to dry-run, supports `&asOf=` to
preview a different date. **Unlike the other test endpoints, a real
send also requires a POST** (`&send=true` on a GET is silently treated
as a dry run, with a `note` in the response explaining why) — this
digest emails every admin at once, so it's the one test endpoint where
a plain browser reload accidentally re-triggering it for real would
actually matter. Use e.g. `curl -X POST "<url>&send=true"` to send for
real.

**Important Netlify behavior:** functions with a `schedule` set can
only be triggered by Netlify's own scheduler — visiting their URL
directly returns a 403 *before it ever reaches the function*, with
nothing in the function log. This isn't a firewall rule or anything
configurable; it's a platform-level restriction on scheduled functions
specifically. That's why the actual logic for each lives in
`lib/report-status-check.js`, `lib/mar-alert-check.js`, and
`lib/mar-reminder-check.js`, with the scheduled files as thin wrappers.

**Testing:** use the separate, non-scheduled test endpoints instead —
these are ordinary functions Netlify has no reason to block:
- `https://<your-site>/.netlify/functions/test-check-report-status?secret=...`
- `https://<your-site>/.netlify/functions/test-check-mar-medication-alerts?secret=...`
- `https://<your-site>/.netlify/functions/test-check-mar-review-reminders?secret=...`

All three require a `secret` matching a `NOTIFICATION_TEST_SECRET` env
var you set, and **default to dry-run** — they compose the exact
messages and recipient lists but never call Twilio, returning it all as
JSON so you can review before anything goes out. Add `&send=true` to
actually send for real. `test-check-report-status` also bypasses the
checkpoint-day gate (so you can test any day), while
`test-check-mar-medication-alerts` never had a gate to begin with.

`test-check-report-status` and `test-check-mar-review-reminders` also
take `&asOf=YYYY-MM-DD` to simulate running the check on a different
calendar day — useful since due dates always land on a month-end, so
"due soon" only exists in the ~8 days around an actual month boundary
and can't be faked with any Notion data on a day outside that window.
e.g. `&asOf=2026-09-23&secret=...` previews exactly what the 7-days-out
checkpoint will say, without waiting for it or touching real data.

**Schedule:** all three run at 9:30am US/Eastern (`30 13 * * *` —
Netlify cron has no DST awareness, so this is pinned to EDT; during EST
Nov-Mar it'll actually fire at 8:30am local, which is still early
enough to be a non-issue).

In addition to a sponsor's personal email+password (tied to one
location), an admin can be granted access to multiple locations, each
unlocked with that **location's own shared password** — not a personal
one. Both paths go through the same login screen and the same
email+password+SMS-OTP flow; `provider-login.js` tries the sponsor
match first, then falls back to checking whether the email belongs to
an enabled admin and the submitted password matches a location they've
been granted.

- **Sponsors** database: unchanged, one row per provider, personal password.
- **Location Access Codes** database: one row per location, a single
  shared password hash, gates entirely on being "Active."
- **Admin Accounts** database: one row per admin — their own name,
  email, and phone (for OTP), plus a comma-separated "Granted
  Locations" list. No password lives here; the location's password
  *is* the credential, and being listed as granted is what makes it
  usable for that admin.
- An admin session has no personal resident list (unlike a sponsor);
  `provider-verify-otp.js` resolves residents for that login by
  querying which resident initials actually appear in the MAR Review
  data for the chosen location — the only place per-location resident
  identity currently lives. If a location has more than one resident,
  the existing resident-picker UI (already built for Log an Event /
  MAR Review) just works without changes.

**Provisioning tools (now behind a real login):**
- `/admin/login.html` — email + password + SMS OTP, same pattern as the
  rest of the app, but a completely separate credential (env vars
  below) that only gates these tools — not tied to Sponsors or Admin
  Accounts.
- `/admin/set-provider-password.html` — set a provider's password.
- `/admin/set-location-password.html` — set or reset a location's
  shared password (also flips it to Active).
- `/admin/manage-admin.html` — look up an existing admin by email
  (pre-fills their current granted locations so removing just one is a
  single unchecked box, not retyping the whole list), or create a new
  one. Unchecking every location auto-disables that admin.
- `/admin/list-admins.html` — read-only: every admin and their granted
  locations, plus which locations currently have a password set.
- `/admin/manage-medications.html` — look up a resident's medications
  by Location + Resident Initials (both exact-match, so this avoids the
  silent-typo risk of editing Notion directly), edit any field inline,
  toggle Active to deactivate (soft delete, matching the same pattern
  as First Aid/Emergency Supplies/Physical Environment — history stays
  in Notion), or add a brand new medication at the bottom.

  **This is also how you add a brand-new resident to a location** —
  there's no separate "add resident" screen anywhere in this app.
  Every "active residents for this location" query (MAR Review, Annual
  Planning, Quarterly Reporting, the weekly digest, all of it) is
  derived entirely from `residentsForLocation`, which reads the
  *distinct Resident Initials with at least one medication on file* in
  the MAR database — there's no independent resident registry. To add
  someone: pick their Location, type their (new) initials, and add
  just one medication for them here. That's what makes them "exist"
  everywhere else.

  **Known gap:** a resident who genuinely takes no medications has no
  way to show up anywhere in this app as things stand — not MAR
  Review, not Annual Planning, not Quarterly Reporting. Workaround
  until/unless this gets a real fix (e.g. a resident flag independent
  of medications): add one placeholder PRN medication (e.g.
  Ibuprofen) just to get them into the system.

New env vars for the admin-tools login itself:
| Variable | Value |
|---|---|
| `SUPER_ADMIN_EMAIL` | `archera@archsupportres.com` |
| `SUPER_ADMIN_PASSWORD_HASH` | `82f6ed9a8e9a21b3d8ba37fbef89adaf90f469fd8924925dd29d8edcc5494d64` |
| `SUPER_ADMIN_PHONE` | Phone number the OTP should text — confirm/set this |

## Admin window-opened SMS alerts

Separate from both the weekly email digest and the sponsor SMS reports
— texts admins (never sponsors) the instant an Annual Planning or
Quarterly Reporting window actually opens, rather than waiting for
Friday. `lib/window-opened-alert-check.js` runs daily and, for every
resident/service, checks whether *today* exactly equals that record's
Annual Planning `windowOpenDate` (the 6-weeks-early unlock) or any of
its Quarterly Reporting quarters' due dates — both are fully
deterministic single calendar days given an Effective Date, so a daily
"does this date equal today" check needs no separate "already sent"
bookkeeping; each date can only ever equal today once.

Recipients are `recipientsForLocation` (the same helper
`mar-alert-check.js` uses) filtered to `role === 'admin'` — sponsors
are never texted by this check, matching the existing separation
between the two SMS channels. Reuses the existing `TWILIO_*` env vars;
nothing new to configure there.

**Schedule:** daily at 9:30am US/Eastern (`30 13 * * *`, same slot as
the other daily checks).

**Testing:** `test-check-window-opened-alerts.js` — not scheduled,
gated by `NOTIFICATION_TEST_SECRET`, defaults to dry-run, `&asOf=` to
simulate a different date (the main way to actually test this, since a
real window-open date only exists on the one specific day it happens
to fall on for real data). Same POST-required-for-real-sends guard as
`test-check-admin-digest.js` (`&send=true` on a GET is silently
treated as a dry run) — after the digest's duplicate-send incident,
every test endpoint capable of messaging every admin at once gets this
guard by default now, not just the one that already broke.

## Setting up event attachments (Zapier)

The file upload goes straight from the browser to a dedicated Zapier
webhook — not routed through a Netlify function — to avoid serverless
payload-size limits.

1. New Zap: trigger = Webhooks by Zapier -> Catch Hook. Copy the webhook
   URL it gives you into `ZAPIER_EVENT_WEBHOOK_URL` in Netlify.
2. Action = Google Drive -> Upload File. Map the file field to the
   webhook's incoming `file`, and the Drive filename to the incoming
   `filename` field (already built as
   `Location_ResidentInitials_EventType_YYYYMMDDHHMMSS.ext`).
3. Publish the Zap. Nothing needs to write back to Notion — the event's
   metadata (including the filename, for cross-reference) is saved to
   the Provider Event Log database separately, by `create-event-log.js`.

The file input intentionally has no `capture` attribute, so iOS/Android
show their full native picker (Take Photo, Photo Library, and — on iOS —
Scan Documents) rather than forcing straight to the camera.

**Before trying Physical Environment:** connect the Physical Environment
Master List database to your Notion integration, same as the others.
- `lib/session.js` — every function requires and validates the session
  token server-side; nothing trusts client-supplied location data

**Before trying Fire Drill Report:** connect the new Fire Drill Reports
database to your Notion integration the same way you did for Sponsors
and First Aid Supplies Master List ("..." menu -> Connections -> add
the integration matching your NOTION_TOKEN).

## What's intentionally not built yet

- **PWA icons.** `manifest.json` has an empty `icons` array — add 192px
  and 512px ASRS icon files before providers try to "Add to Home Screen."
- **Fire Drill Report and Log an Event screens** — Home screen buttons for
  these still show a placeholder alert. Next build pass.
- **Password reset self-service.** For now, resets go through the admin
  tool, matching "I provision/store one for each."
