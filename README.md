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
- Serious Incident Report: a solid-orange button at the very top of
  Home (distinct from everything else, deliberately not color-coded by
  due date since it's not a recurring compliance report). Writes into
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

Email isn't wired up yet — everything above is SMS-only for now.

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
- **The lock:** a resident's card is locked (gray puzzle) until 6 weeks
  before due (`WINDOW_WEEKS_BEFORE_DUE`), then unlocks (yellow, slowly
  rotating puzzle, CSS `@keyframes puzzleSpin`). A brand new resident
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
function's execution time limit as the roster grows.

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
