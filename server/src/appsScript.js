/**
 * ============================================================================
 * APPS SCRIPT CLIENT
 * ============================================================================
 * Every call from this proxy to Apps Script goes through here so PROXY_KEY,
 * ip, and userAgent are attached exactly once, consistently. Apps Script
 * ignores proxyKey/ip/userAgent for actions that don't need them, and
 * enforces PROXY_KEY (via requireProxy) for the ones that do.
 * ============================================================================
 */
const { WEB_APP_URL, PROXY_KEY } = require('./config');

async function callAppsScript(action, payload, meta) {
  const body = Object.assign(
    { action },
    payload,
    {
      proxyKey: PROXY_KEY,
      ip: (meta && meta.ip) || '',
      userAgent: (meta && meta.userAgent) || ''
    }
  );
  const upstream = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  return upstream.json(); // { success, data } or { success:false, error }
}

module.exports = { callAppsScript };
