/**
 * ============================================================================
 * CUSTOMER SESSIONS
 * ============================================================================
 * Convention: the frontend stores the session token it gets back from
 * customerLogin/customerVerifyOtp and sends it on every subsequent request
 * as an `Authorization: Bearer <token>` header — not a body field, so a
 * tampered request body can never smuggle in someone else's customerId.
 *
 * The token itself is a signed JWT (customerId + email, 30-day expiry by
 * default). Apps Script never sees or validates this token — it only ever
 * receives the customerId the proxy has already verified, plus PROXY_KEY
 * proving the call came from this proxy.
 * ============================================================================
 */
const jwt = require('jsonwebtoken');
const { SESSION_SECRET, CUSTOMER_SESSION_DAYS } = require('./config');

function signCustomerSession(customerId, email) {
  return jwt.sign({ sub: customerId, email }, SESSION_SECRET, { expiresIn: `${CUSTOMER_SESSION_DAYS}d` });
}

function verifyCustomerSession(token) {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    return { customerId: decoded.sub, email: decoded.email };
  } catch (err) {
    return null;
  }
}

/**
 * Express middleware: if a valid Bearer token is present, attaches
 * req.customer = { customerId, email }. Does NOT reject when absent/invalid —
 * routes that require a session check req.customer themselves, so guest
 * actions (createOrder, etc.) keep working exactly as before whether or not
 * a token is sent.
 */
function attachCustomerSession(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (match) {
    const session = verifyCustomerSession(match[1]);
    if (session) req.customer = session;
  }
  next();
}

module.exports = { signCustomerSession, verifyCustomerSession, attachCustomerSession };
