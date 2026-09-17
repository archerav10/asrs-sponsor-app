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
