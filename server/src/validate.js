/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 * Backend never trusts the frontend. Every field forwarded to Apps Script is
 * type-checked and bounded here first. Apps Script itself still validates
 * again (it has to, since it's technically reachable by anyone who gets the
 * URL) — this is defense in depth, not a replacement for that.
 * ============================================================================
 */

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function isPhone(v) {
  return typeof v === 'string' && /^[0-9+()\-\s]{6,20}$/.test(v.trim());
}

function isEmail(v) {
  return typeof v === 'string' && v.trim().length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isOtpCode(v) {
  return typeof v === 'string' && /^[0-9]{6}$/.test(v.trim());
}

// bcrypt silently truncates at 72 bytes — cap well under that, and require a
// sane minimum length so registration/reset can't be used to store an
// effectively-empty password.
function isPassword(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 72;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return null;
  const cleaned = [];
  for (const raw of items) {
    if (!isPlainObject(raw)) return null;
    const id = raw.id;
    const qty = Number(raw.qty);
    if (!isNonEmptyString(String(id ?? ''), 100)) return null;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return null;
    // Deliberately NOT reading raw.price / raw.name here — a client cannot be
    // trusted to self-report the price it wants to pay. The real price is
    // looked up server-side from the product catalog before this ever
    // reaches Apps Script (see index.js's createOrder handling).
    cleaned.push({ id: String(id), qty });
  }
  return cleaned;
}

function sanitizeAddress(addr) {
  if (addr === undefined) return undefined;
  if (!isPlainObject(addr)) return null;
  const fields = ['governorate', 'city', 'area', 'street', 'buildingNo', 'apartmentNo', 'floor', 'landmark'];
  const out = {};
  for (const f of fields) {
    if (addr[f] !== undefined) {
      if (typeof addr[f] !== 'string' || addr[f].length > 200) return null;
      out[f] = addr[f].trim();
    }
  }
  return out;
}

/**
 * Validates + sanitizes a request body for a given action.
 * Returns { ok: true, payload } or { ok: false, error }.
 */
function validatePayload(action, body) {
  switch (action) {
    case 'getProducts':
      return { ok: true, payload: {} };

    case 'createOrder': {
      if (!isNonEmptyString(body.customerName, 120)) {
        return { ok: false, error: 'Please provide a valid name.' };
      }
      if (!isPhone(body.phone)) {
        return { ok: false, error: 'Please provide a valid phone number.' };
      }
      const items = sanitizeItems(body.items);
      if (!items) {
        return { ok: false, error: 'Your cart looks invalid. Please refresh and try again.' };
      }
      if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 500)) {
        return { ok: false, error: 'Notes are too long.' };
      }
      const address = sanitizeAddress(body.address);
      if (address === null) {
        return { ok: false, error: 'Address fields look invalid.' };
      }
      const payload = { customerName: body.customerName.trim(), phone: body.phone.trim(), items };
      if (body.notes !== undefined) payload.notes = body.notes.trim();
      if (address !== undefined) payload.address = address;
      return { ok: true, payload };
    }

    case 'cancelOrder':
    case 'getOrderStatus': {
      if (!isNonEmptyString(body.orderId, 60)) {
        return { ok: false, error: 'A valid order ID is required.' };
      }
      return { ok: true, payload: { orderId: body.orderId.trim() } };
    }

    case 'customerRegister': {
      if (!isNonEmptyString(body.name, 120)) return { ok: false, error: 'Please provide a valid name.' };
      if (!isEmail(body.email)) return { ok: false, error: 'Please provide a valid email address.' };
      if (!isPhone(body.phone)) return { ok: false, error: 'Please provide a valid phone number.' };
      if (!isPassword(body.password)) return { ok: false, error: 'Password must be at least 8 characters.' };
      return { ok: true, payload: { name: body.name.trim(), email: body.email.trim(), phone: body.phone.trim(), password: body.password } };
    }

    case 'customerVerifyOtp': {
      if (!isEmail(body.email)) return { ok: false, error: 'Please provide a valid email address.' };
      if (!isOtpCode(body.code)) return { ok: false, error: 'Please enter the 6-digit code.' };
      return { ok: true, payload: { email: body.email.trim(), code: body.code.trim() } };
    }

    case 'customerLogin': {
      if (!isEmail(body.email)) return { ok: false, error: 'Please provide a valid email address.' };
      if (!isNonEmptyString(body.password, 72)) return { ok: false, error: 'Please enter your password.' };
      return { ok: true, payload: { email: body.email.trim(), password: body.password } };
    }

    case 'customerForgotPassword': {
      if (!isEmail(body.email)) return { ok: false, error: 'Please provide a valid email address.' };
      return { ok: true, payload: { email: body.email.trim() } };
    }

    case 'customerResetPassword': {
      if (!isEmail(body.email)) return { ok: false, error: 'Please provide a valid email address.' };
      if (!isNonEmptyString(body.resetToken, 100)) return { ok: false, error: 'Invalid or expired reset code.' };
      if (!isPassword(body.newPassword)) return { ok: false, error: 'Password must be at least 8 characters.' };
      return { ok: true, payload: { email: body.email.trim(), resetToken: body.resetToken.trim(), newPassword: body.newPassword } };
    }

    case 'customerLogout':
    case 'getCustomerProfile':
    case 'getCustomerOrders':
      return { ok: true, payload: {} };

    case 'updateCustomerProfile': {
      const payload = {};
      if (body.name !== undefined) {
        if (!isNonEmptyString(body.name, 120)) return { ok: false, error: 'Please provide a valid name.' };
        payload.name = body.name.trim();
      }
      if (body.phone !== undefined) {
        if (!isPhone(body.phone)) return { ok: false, error: 'Please provide a valid phone number.' };
        payload.phone = body.phone.trim();
      }
      if (body.address !== undefined) {
        if (typeof body.address !== 'string' || body.address.length > 500) return { ok: false, error: 'Address is too long.' };
        payload.address = body.address.trim();
      }
      return { ok: true, payload };
    }

    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

module.exports = { validatePayload };
