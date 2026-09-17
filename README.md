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
  provider-login.js                Step 1: email+password -> send SMS OTP
  provider-verify-otp.js           Step 2: verify OTP -> session token
  admin-set-provider-password.js   Admin-only: provision a provider's password

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
| `TWILIO_ACCOUNT_SID` | Existing Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Existing Twilio Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | Your existing Messaging Service (the one tied to +18046265375) |
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

## What's intentionally not built yet

- **Session validation on subsequent requests.** The Home screen currently
  trusts whatever's in `localStorage`. Before wiring up the First Aid
  Supplies / Fire Drill / Event functions, each of those functions should
  decrypt and check the `sessionToken` (via `lib/crypto.js`'s
  `decryptToken`) rather than trusting client-supplied location/email
  fields directly.
- **PWA icons.** `manifest.json` has an empty `icons` array — add 192px
  and 512px ASRS icon files before providers try to "Add to Home Screen."
- **Report screens themselves** (First Aid Supplies, Fire Drill, Log an
  Event) — the Home screen's three buttons currently just show a
  placeholder alert. Next build pass.
- **Password reset self-service.** For now, resets go through the admin
  tool, matching "I provision/store one for each."
