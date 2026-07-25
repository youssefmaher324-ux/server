# Citrine Customer Proxy

This is the backend proxy that sits in front of Apps Script, for the public
customer site only:

```
Customer browser → this proxy (Node/Express) → Google Apps Script Web App
```

Employee, Admin, and Delivery are untouched — they keep talking to Apps
Script directly, exactly as before this change.

## What it does

- Hides `WEB_APP_URL` completely. It lives only in this server's `.env`,
  never in any frontend file.
- Only forwards four actions the customer site actually needs:
  `getProducts`, `createOrder`, `cancelOrder`, `getOrderStatus`. Any other
  action (e.g. `deleteAllOrders`, `addProduct`) is rejected with a 403 before
  it ever reaches Apps Script — so even if someone reads the proxy's source
  or traffic, they can't use it to reach admin/staff actions.
- Re-validates every field server-side (name/phone/items/notes/address) —
  it never trusts what the browser sent.
- Rate limits: 5 `createOrder` requests/hour/IP (configurable), and a much
  higher general ceiling for `getProducts`/`getOrderStatus`/`cancelOrder` so
  the site's normal 5-second product polling isn't affected.
- Security headers via `helmet` (CSP, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy, HSTS).
- CORS locked to the origin(s) you configure.
- Rejects non-HTTPS traffic in production (when deployed behind a host that
  terminates TLS and forwards `x-forwarded-proto`).
- Attaches the real client IP and User-Agent to every forwarded request
  (server-side, never trusting what the browser claims) — Apps Script's
  new AuditLogs/ErrorLogs sheets (Phase 2) use these for accurate records.

## Setup

1. `cd server && npm install`
2. `cp .env.example .env` and fill in:
   - `WEB_APP_URL` — your Apps Script Web App URL (same one from the
     original deployment guide, step 5).
   - `ALLOWED_ORIGINS` — the exact URL(s) your customer site is hosted at.
3. `npm start` (or `npm run dev` for auto-restart on change).
4. In `/customer/app.js`, set `CONFIG.PROXY_URL` to this server's public URL
   plus `/api/citrine`, e.g. `https://proxy.yourdomain.com/api/citrine`.

That's the only frontend change — `/customer/index.html`, `/customer/style.css`,
and every other file in `/customer` are unchanged.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS with a process manager,
etc.). Whatever you use:

- Make sure it terminates HTTPS (or sits behind something that does) —
  `ALLOWED_ORIGINS` and the production HTTPS check both assume this.
- Set the same env vars from `.env` in the host's environment/secrets panel
  instead of committing `.env`.
- `.env` is already covered by `.gitignore` — don't remove that line.

## Note on scope

This proxy only covers the item requested first: hiding the Apps Script URL
and adding a security boundary in front of the customer flow. It does not
yet include customer accounts/OTP, the new `Customers`/`Visitors`/`AuditLogs`
sheets, driver password hashing, or session expiration — those are separate,
larger changes to Apps Script and the other three dashboards, to be done as
their own pass so each can be reviewed on its own.
