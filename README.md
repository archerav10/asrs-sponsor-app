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
| `TWILIO_ACCOUNT_SID` | Existing Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Existing Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Copy from asrscompliance.com's env vars (the sending number, e.g. +18046265375) |
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
- First Aid Supplies screen: view items for your location, edit exp
  date/notes per item (server re-checks the item's Location against the
  session before allowing the write), "Confirm Reviewed Today" bulk stamp
- `lib/session.js` — every First Aid function requires and validates the
  session token server-side; nothing trusts client-supplied location data

## What's intentionally not built yet

- **PWA icons.** `manifest.json` has an empty `icons` array — add 192px
  and 512px ASRS icon files before providers try to "Add to Home Screen."
- **Fire Drill Report and Log an Event screens** — Home screen buttons for
  these still show a placeholder alert. Next build pass.
- **Password reset self-service.** For now, resets go through the admin
  tool, matching "I provision/store one for each."
