/**
 * ============================================================================
 * CONFIG — what the public customer proxy is allowed to do.
 * ============================================================================
 * This is the security boundary: only these four actions can ever reach
 * Apps Script through this proxy, no matter what a request body claims.
 * Everything else (products/drivers/stats/admin actions, etc.) is rejected
 * here before it ever leaves this server. Employee/Admin/Delivery keep
 * talking to Apps Script directly and are untouched by this proxy.
 * ============================================================================
 */
require('dotenv').config();

const REQUIRED_ENV = ['WEB_APP_URL', 'PROXY_KEY', 'SESSION_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].indexOf('PASTE_YOUR') === 0) {
    // Fail loud at boot rather than silently proxying to a bad/missing URL.
    // eslint-disable-next-line no-console
    console.error(`[config] Missing or unset required env var: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Actions the customer-facing site is permitted to call, and the exact
// fields we forward for each — anything else in the request body is dropped,
// not just ignored, so a tampered client can't smuggle extra fields through.
const ALLOWED_ACTIONS = {
  getProducts: { fields: [] },
  createOrder: { fields: ['customerName', 'phone', 'items', 'notes', 'address'] },
  cancelOrder: { fields: ['orderId'] },
  getOrderStatus: { fields: ['orderId'] },
  // Phase 3 — customer accounts. Actions requiring a session are enforced in
  // index.js by checking req.customer (attached from the Bearer token), not
  // by anything in this list.
  customerRegister: { fields: ['name', 'email', 'phone', 'password'] },
  customerVerifyOtp: { fields: ['email', 'code'] },
  customerLogin: { fields: ['email', 'password'] },
  customerLogout: { fields: [], requiresSession: true },
  customerForgotPassword: { fields: ['email'] },
  customerResetPassword: { fields: ['email', 'resetToken', 'newPassword'] },
  getCustomerProfile: { fields: [], requiresSession: true },
  updateCustomerProfile: { fields: ['name', 'phone', 'address'], requiresSession: true },
  getCustomerOrders: { fields: [], requiresSession: true }
};

module.exports = {
  WEB_APP_URL: process.env.WEB_APP_URL,
  PROXY_KEY: process.env.PROXY_KEY,
  SESSION_SECRET: process.env.SESSION_SECRET,
  CUSTOMER_SESSION_DAYS: Number(process.env.CUSTOMER_SESSION_DAYS) || 30,
  PORT: Number(process.env.PORT) || 3000,
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ORDER_RATE_LIMIT_PER_HOUR: Number(process.env.ORDER_RATE_LIMIT_PER_HOUR) || 5,
  GENERAL_RATE_LIMIT_PER_15MIN: Number(process.env.GENERAL_RATE_LIMIT_PER_15MIN) || 300,
  AUTH_RATE_LIMIT_PER_HOUR: Number(process.env.AUTH_RATE_LIMIT_PER_HOUR) || 10,
  ALLOWED_ACTIONS
};
