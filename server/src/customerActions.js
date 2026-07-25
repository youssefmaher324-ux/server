/**
 * ============================================================================
 * CUSTOMER ACCOUNT ACTIONS
 * ============================================================================
 * Real bcrypt hashing happens ONLY here, in Node — Apps Script has no bcrypt
 * implementation available to it, so it only ever stores/compares the hash
 * string this proxy gives it. A plaintext password is only ever alive in
 * this process's memory for the duration of one request; it's never written
 * anywhere and never sent to Apps Script.
 * ============================================================================
 */
const bcrypt = require('bcryptjs');
const { callAppsScript } = require('./appsScript');
const { signCustomerSession } = require('./session');

const BCRYPT_ROUNDS = 12;

async function handleRegister(payload, meta) {
  const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
  const result = await callAppsScript(
    'customerRegister',
    { name: payload.name, email: payload.email, phone: payload.phone, passwordHash },
    meta
  );
  return result;
}

async function handleVerifyOtp(payload, meta) {
  const result = await callAppsScript('customerVerifyOtp', payload, meta);
  if (result.success) {
    const token = signCustomerSession(result.data.customerId, payload.email);
    result.data = Object.assign({}, result.data, { sessionToken: token });
  }
  return result;
}

async function handleLogin(payload, meta) {
  const authRes = await callAppsScript('getCustomerAuthRecord', { email: payload.email }, meta);
  if (!authRes.success) return authRes;
  const record = authRes.data;

  if (!record) {
    // Generic error either way — don't reveal whether the email exists.
    return { success: false, error: 'Incorrect email or password.' };
  }
  if (record.blocked) {
    return { success: false, error: 'This account has been blocked. Please contact support.' };
  }
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const minsLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return { success: false, error: `Too many failed attempts. Try again in ${minsLeft} minute(s).` };
  }
  if (!record.verified) {
    return { success: false, error: 'Please verify your email before logging in.' };
  }

  const matches = await bcrypt.compare(payload.password, record.passwordHash || '');
  await callAppsScript('recordLoginResult', { email: payload.email, success: matches }, meta);

  if (!matches) {
    return { success: false, error: 'Incorrect email or password.' };
  }

  const token = signCustomerSession(record.customerId, record.email);
  return {
    success: true,
    data: {
      customerId: record.customerId,
      name: record.name,
      email: record.email,
      phone: record.phone,
      sessionToken: token
    }
  };
}

async function handleLogout(customer, meta) {
  return callAppsScript('customerLogout', { customerId: customer.customerId, email: customer.email }, meta);
}

async function handleForgotPassword(payload, meta) {
  return callAppsScript('customerForgotPassword', payload, meta);
}

async function handleResetPassword(payload, meta) {
  const newPasswordHash = await bcrypt.hash(payload.newPassword, BCRYPT_ROUNDS);
  return callAppsScript(
    'customerResetPassword',
    { email: payload.email, resetToken: payload.resetToken, newPasswordHash },
    meta
  );
}

async function handleGetProfile(customer, meta) {
  return callAppsScript('getCustomerProfile', { customerId: customer.customerId }, meta);
}

async function handleUpdateProfile(payload, customer, meta) {
  return callAppsScript('updateCustomerProfile', Object.assign({ customerId: customer.customerId }, payload), meta);
}

async function handleGetOrders(customer, meta) {
  return callAppsScript('getCustomerOrders', { customerId: customer.customerId }, meta);
}

module.exports = {
  handleRegister,
  handleVerifyOtp,
  handleLogin,
  handleLogout,
  handleForgotPassword,
  handleResetPassword,
  handleGetProfile,
  handleUpdateProfile,
  handleGetOrders
};
