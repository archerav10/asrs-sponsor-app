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
  month-end), so the "due date" is always the last day of the current
  month — see `netlify/functions/lib/mar-period.js` for the rolling
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
  - A red-bordered Allergies banner sits at the top (editable), sourced
    from a special "Allergy Info" row, same pattern as the "General
    Notes" row used elsewhere.
  - The Home button includes a colored status dot: solid green only
    once finalized for the current target period, flashing yellow if
    that period's due date is within 7 days, flashing red if overdue
    (including a period that was never finalized in time — this
    self-corrects each month rather than getting stuck). Home also
    shows which month is being reviewed, last-reviewed, latest delivery
    date, and last-finalized date. **One button per resident** — if an
    account has more than one resident, each gets its own MAR Review
    button, own status dot, own screen instance (pass `?resident=XX` to
    `get-mar-review`, or `resident` in the POST body for
    confirm/finalize, to scope to one specific resident).
- All five report buttons (First Aid, Fire Drill, Emergency Supplies,
  Physical Environment, MAR Review) now show the same red/yellow/green
  status dot, driven by each report's own due-date logic.

## Notifications (SMS)

Two scheduled functions (`@daily` in netlify.toml — they run every day
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

Both use `lib/notification-recipients.js` to resolve who gets texted
for a location: every enabled sponsor there, plus every enabled admin
whose Granted Locations includes it (deduplicated by phone number).

Email isn't wired up yet — everything above is SMS-only for now.

## Weekly admin email digest

Separate from the SMS reports above — one email per admin (not
sponsors), covering every location they're granted, listing anything
currently expired, missing, or out of range across **First Aid
Supplies, Emergency Supplies, and Physical Environment** (MAR isn't
included here since it already gets its own daily SMS alert). A
location with nothing wrong still gets its own "No issues found" line
rather than being omitted, so the weekly email always confirms
coverage for every location an admin has.

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
preview a different date, `&send=true` to actually send.

**Important Netlify behavior:** functions with a `schedule` set can
only be triggered by Netlify's own scheduler — visiting their URL
directly returns a 403 *before it ever reaches the function*, with
nothing in the function log. This isn't a firewall rule or anything
configurable; it's a platform-level restriction on scheduled functions
specifically. That's why the actual logic for each lives in
`lib/report-status-check.js` and `lib/mar-alert-check.js`, with the
scheduled files as thin wrappers.

**Testing:** use the separate, non-scheduled test endpoints instead —
these are ordinary functions Netlify has no reason to block:
- `https://<your-site>/.netlify/functions/test-check-report-status?secret=...`
- `https://<your-site>/.netlify/functions/test-check-mar-medication-alerts?secret=...`

Both require a `secret` matching a `NOTIFICATION_TEST_SECRET` env var
you set, and **default to dry-run** — they compose the exact messages
and recipient lists but never call Twilio, returning it all as JSON so
you can review before anything goes out. Add `&send=true` to actually
send for real. `test-check-report-status` also bypasses the
checkpoint-day gate (so you can test any day), while
`test-check-mar-medication-alerts` never had a gate to begin with.

`test-check-report-status` also takes `&asOf=YYYY-MM-DD` to simulate
running the check on a different calendar day — useful since due dates
always land on a month-end, so "due soon" only exists in the ~8 days
around an actual month boundary and can't be faked with any Notion
data on a day outside that window. e.g.
`&asOf=2026-09-23&secret=...` previews exactly what the 7-days-out
checkpoint will say, without waiting for it or touching real data.

**Schedule:** both run at 9:30am US/Eastern (`30 13 * * *` — Netlify
cron has no DST awareness, so this is pinned to EDT; during EST
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

New env vars for the admin-tools login itself:
| Variable | Value |
|---|---|
| `SUPER_ADMIN_EMAIL` | `archera@archsupportres.com` |
| `SUPER_ADMIN_PASSWORD_HASH` | `82f6ed9a8e9a21b3d8ba37fbef89adaf90f469fd8924925dd29d8edcc5494d64` |
| `SUPER_ADMIN_PHONE` | Phone number the OTP should text — confirm/set this |

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
