/**
 * Centralizes JWT secret resolution so every call site (JwtStrategy,
 * AuthService's sign calls) agrees on the same value — previously
 * `process.env.JWT_ACCESS_SECRET` was read directly in three separate
 * places, so a future fallback/rename had to be kept in sync by hand.
 *
 * Falls back to the generic JWT_SECRET if JWT_ACCESS_SECRET isn't set,
 * so a deploy that only configured one shared secret still starts instead
 * of crashing with "JwtStrategy requires a secret or key".
 */
export function getJwtAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'No JWT access secret configured — set JWT_ACCESS_SECRET (preferred) or JWT_SECRET (fallback) in the environment.',
    );
  }
  return secret;
}
