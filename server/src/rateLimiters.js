/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 * Two tiers, because a single blanket "5 requests/hour" limit would break
 * the customer page's live product-refresh polling (every 5s) and order
 * status/cancel checks. Instead:
 *   - createOrder is capped tightly (spam/abuse control on the action that
 *     actually costs money/inventory).
 *   - Everything else (getProducts, getOrderStatus, cancelOrder) gets a much
 *     higher ceiling so normal browsing/polling never gets blocked.
 * ============================================================================
 */
const rateLimit = require('express-rate-limit');
const { ORDER_RATE_LIMIT_PER_HOUR, GENERAL_RATE_LIMIT_PER_15MIN, AUTH_RATE_LIMIT_PER_HOUR } = require('./config');

function tooManyRequestsHandler(message) {
  return (req, res) => {
    res.status(429).json({
      success: false,
      error: message
    });
  };
}

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: ORDER_RATE_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler(
    `You've reached the limit of ${ORDER_RATE_LIMIT_PER_HOUR} orders per hour. Please try again later.`
  )
});

// Covers register / login / verifyOtp / forgotPassword / resetPassword —
// anything that's a meaningful brute-force or spam target but that a real
// user might legitimately retry a handful of times (mistyped OTP, forgotten
// password), so it's looser than the order limiter but still tight.
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: AUTH_RATE_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler('Too many attempts. Please try again in a while.')
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: GENERAL_RATE_LIMIT_PER_15MIN,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler('Too many requests. Please slow down and try again shortly.')
});

module.exports = { orderLimiter, generalLimiter, authLimiter };
