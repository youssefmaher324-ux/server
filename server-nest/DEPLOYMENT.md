# Citrine Backend Migration — NestJS / Prisma / Supabase / Railway

## ⚠️ package-lock.json — read this first

This repo does not yet include a real `package-lock.json` for
`server-nest`. It couldn't be generated in the environment that built this
project (no registry access), and a fabricated one would fail `npm ci` on
Railway with integrity-hash errors — worse than not having one at all.

**Generate the real one in one step, on any machine with internet access:**

```bash
cd server-nest
npm install
git add package-lock.json
git commit -m "Add package-lock.json for server-nest"
```

That's it — `npm install` reads `package.json`, resolves every version,
and writes a correct `package-lock.json` with real `resolved`/`integrity`
fields. Commit it and push.

**Until you do that**, the Dockerfile and CI workflow both fall back to
`npm install` automatically (see below) so Railway deploys still work —
just without the reproducibility/speed guarantees a committed lockfile
gives you. Once the lockfile is committed, both switch to `npm ci`
automatically, no further changes needed.

## What changed and why

The old `server/` (Express + `pg`) is left in place, untouched, so nothing
breaks while you cut over. `server-nest/` is the new backend that replaces
it. Once you've verified `server-nest` works end-to-end, delete `server/`.

**Important finding during migration:** `employee/app.js` and `admin/app.js`
had a *live* Google Apps Script deployment URL hardcoded directly in the
client-side bundle — visible to anyone who opened dev tools, with only a
shared "access key" protecting the actions behind it. That's fixed by
routing both dashboards through the new `/api/citrine/actions` compatibility
endpoint (see below), but treat the old URL as compromised: if it's still
live, revoke/redeploy that Apps Script Web App regardless of this migration.

## Deployment steps

### 1. Supabase (database + storage)

1. Create a Supabase project.
2. In **Settings → Database**, copy the pooled connection string (port
   `6543`, `?pgbouncer=true`) into `DATABASE_URL`, and the direct connection
   (port `5432`) into `DIRECT_URL`.
3. In the SQL editor, run `server-nest/supabase/storage-setup.sql` — creates
   the `citrine-media` bucket with public read, no public write.
4. Copy the **service_role** key (Settings → API) into
   `SUPABASE_SERVICE_ROLE_KEY`. Never expose this key to any frontend.

### 2. Run migrations + seed RBAC

```bash
cd server-nest
cp .env.example .env   # fill in real values
npm install
npx prisma migrate dev --name init   # generates + applies the first migration
npx prisma db seed                   # creates roles/permissions (admin, employee, driver, customer)
```

`prisma migrate dev` is intentionally used here instead of a hand-written
SQL file — it diffs `schema.prisma` against the empty database and
generates migration SQL Prisma has verified against this exact schema,
which is safer than a manually transcribed one. Commit the generated
`prisma/migrations/` folder; `prisma migrate deploy` (used in CI/Railway)
replays it without re-diffing.

### 3. Create your first admin user

There's no public "become admin" endpoint (by design). Fastest path: run
`npx prisma studio`, create a `User` row with your email, then set its
`roleId` to the `admin` role's id (seeded in step 2). Set a password with:

```bash
node -e "console.log(require('bcrypt').hashSync('your-password', 12))"
```
and paste the hash into `passwordHash`.

### 4. Railway (backend hosting)

1. New Railway project → deploy from the `server-nest/` directory (or point
   Railway at this repo with a root directory of `server-nest`).
2. Railway reads `railway.json` — Dockerfile build, health check at
   `/api/health`.
3. Set every variable from `.env.example` in Railway's Variables tab.
4. Add a Redis instance (Railway's Redis plugin, or point `REDIS_URL` at an
   external one) for the cache layer.
5. After first deploy, run migrations against production:
   `railway run npx prisma migrate deploy`.

### 5. Point the frontends at the new backend

Already done in this pass — `customer/app.js`, `employee/app.js`,
`admin/app.js`, and `delivery/app.js` each had their `WEB_APP_URL`/`API_URL`
constant swapped to `https://YOUR-RAILWAY-APP.up.railway.app/...`.
**Replace `YOUR-RAILWAY-APP` with your actual Railway domain** once deployed.

### 6. GitHub Actions

`.github/workflows/ci.yml` runs on every push/PR touching `server-nest/`:
installs, generates Prisma client, runs migrations against a throwaway
Postgres service container, lints, builds, tests, and does a Docker build
smoke test. Add `RAILWAY_TOKEN` as a repo secret and a deploy step if you
want CI to auto-deploy on merge to `main`.

## Known gaps — not yet done in this pass

- **`delivery/app.js` has no login step.** The new `/drivers/:id/location`
  route requires a driver-role JWT, but the delivery page only ever asked
  for a typed-in `driverId` with no password (same as the old Apps Script
  version — not a regression, just not yet solved). Needs a driver login
  flow added to `delivery/index.html` before GPS tracking will actually
  authenticate.
- **GA4 / Meta Pixel / PostHog / Sentry** — env vars are wired in
  `.env.example` and the NestJS side initializes Sentry if `SENTRY_DSN` is
  set, but no snippets were added to the four frontend `index.html` files
  yet, and PostHog isn't initialized anywhere.
- **Invoice PDF rendering** — `invoices.generateForOrder` creates the DB
  row and invoice number; it does not yet render an actual PDF or upload it
  to Supabase Storage. `pdfUrl` stays null until that's added.
- **Cart/wishlist/reward-points UI** — backend endpoints exist; none of the
  four frontends call them yet (they weren't in the original frontend code
  either, per the earlier scope-check).

## File inventory for this pass

**Created** (all new — nothing existing was deleted):
- `server-nest/` — entire NestJS project (see tree below)
- `.github/workflows/ci.yml`

**Modified** (minimal, single-purpose edits only):
- `customer/app.js` — `CONFIG.API_URL` now points at the new backend
- `employee/app.js` — `CONFIG.WEB_APP_URL` now points at `/api/citrine/actions`
- `admin/app.js` — same as employee/app.js
- `delivery/app.js` — `API_URL` updated; GPS fetch call updated to
  `PATCH /drivers/:id/location` (route shape changed, method/URL only)

**Deleted:** nothing yet. `server/` (the old Express/Apps-Script-adjacent
backend) is still on disk — remove it once `server-nest` is verified in
production, per the "don't rebuild/remove until proven" instruction.

### server-nest/ tree

```
server-nest/
  Dockerfile
  docker-compose.yml
  railway.json
  .env.example
  package.json
  tsconfig.json
  nest-cli.json
  prisma/
    schema.prisma       # all 25+ tables
    seed.ts             # roles + permissions
  supabase/
    storage-setup.sql
  src/
    main.ts             # helmet, csrf, cookies, swagger, sentry, validation
    app.module.ts
    prisma/              (PrismaService/PrismaModule)
    common/               guards (JWT, RBAC) + decorators (@Roles, @RequirePermissions)
    audit/                AuditService (audit_logs + activity trail)
    auth/                 OTP, password login, refresh rotation, forgot/reset password
    users/                profile + order history
    products/  categories/  orders/  coupons/  invoices/  drivers/
    cart/  wishlist/  notifications/  banners/  storage/  (Supabase Storage)
    legacy-compat/        the /api/citrine/actions shim for employee/admin
    health/               /api/health for Railway's healthcheck
```

## SQL migrations

Not hand-written — see step 2 above. Run `npx prisma migrate dev --name init`
locally once `.env` is filled in; it generates `prisma/migrations/<timestamp>_init/migration.sql`
directly from `schema.prisma`, which is more reliable than a manually
transcribed file for a schema this size (25+ tables, several enums-as-strings,
composite unique constraints on cart/wishlist).
