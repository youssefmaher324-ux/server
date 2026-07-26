/**
 * Fail-fast startup validation. Runs before NestFactory.create() so a
 * missing required variable produces one clear, actionable log line
 * instead of an opaque crash deep inside Passport/Supabase/Prisma
 * construction (e.g. passport-jwt's generic "requires a secret or key",
 * or the Supabase SDK's generic "supabaseUrl is required").
 */
const REQUIRED_IN_ALL_ENVS = ['DATABASE_URL', 'JWT_ACCESS_SECRET'];

// Only enforced when NODE_ENV=production — local/dev can run against a
// partial .env (e.g. skipping Supabase while working on unrelated routes).
const REQUIRED_IN_PRODUCTION = [
  'DIRECT_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'ALLOWED_ORIGINS',
];

export function validateEnv(): void {
  const missing: string[] = REQUIRED_IN_ALL_ENVS.filter((key) => !process.env[key]);

  if (process.env.NODE_ENV === 'production') {
    missing.push(...REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]));
  }

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `\n❌ Missing required environment variable(s): ${missing.join(', ')}\n` +
        'Check them against server-nest/.env.example and set them in Railway → Variables.\n',
    );
    process.exit(1);
  }

  // JWT_REFRESH_SECRET is intentionally NOT required: refresh tokens in
  // this codebase are opaque random values hashed with SHA-256 and looked
  // up in the refresh_tokens table (see auth.service.ts) — they are not
  // JWT-signed, so no secret is needed to issue/verify them. The variable
  // is kept in .env.example for forward-compatibility only.
}
