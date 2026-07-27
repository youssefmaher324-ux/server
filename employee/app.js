/**
 * ============================================================================
 * CITRINE OPS — EMPLOYEE DASHBOARD
 * Talks to the NestJS backend. Auth is real email+password JWT login
 * (POST /api/auth/login) — the accessKey/EMPLOYEE_KEY shared-secret system
 * is gone. The JWT lives in an httpOnly cookie set by the backend; this
 * file never reads or stores it directly, it just sends
 * credentials: 'include' on every request and lets the browser attach it.
 * ============================================================================
 */
const CONFIG = {
  API_BASE: 'https://server-production-036d.up.railway.app/api',
  REFRESH_MS: 5000
};

let ORDERS = [];
let PRODUCTS = [];
let DRIVERS = [];
let pollTimer = null;
let assignOrderId = null;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
// The action dispatcher stays (some staff-only bulk operations don't have
// individual REST endpoints yet), but auth is now the same httpOnly JWT
// cookie every other route uses, not a shared key sent in the request body.
async function api(action, payload) {
  const res = await fetch(`${CONFIG.API_BASE}/citrine/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(Object.assign({ action }, payload || {}))
  });
  if (res.status === 401 || res.status === 403) {
    showGate();
    throw new Error('Session expired — please log in again.');
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || json.message || 'Request failed.');
  return json.data;
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------------------
// LOGIN GATE (email + password)
// ---------------------------------------------------------------------------
document.getElementById('gateSubmit').onclick = tryLogin;
['gateEmailInput', 'gatePasswordInput'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
});

async function tryLogin() {
  const email = document.getElementById('gateEmailInput').value.trim();
  const password = document.getElementById('gatePasswordInput').value;
  if (!email || !password) return;
  document.getElementById('gateError').textContent = '';
  document.getElementById('gateSubmit').textContent = 'Signing in…';
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Invalid email or password.');

    await api('whoAmI', {}); // validates this account is staff (employee or admin)
    enterDashboard();
  } catch (err) {
    document.getElementById('gateError').textContent = err.message;
  } finally {
    document.getElementById('gateSubmit').textContent = 'Sign In';
  }
}

function showGate() {
  clearInterval(pollTimer);
  document.getElementById('dashShell').classList.remove('active');
  document.getElementById('gateScreen').style.display = 'flex';
}

function enterDashboard() {
  document.getElementById('gateScreen').style.display = 'none';
  document.getElementById('dashShell').classList.add('active');
  loadAll();
  pollTimer = setInterval(loadAll, CONFIG.REFRESH_MS);
}

document.getElementById('logoutBtn').onclick = async () => {
  try {
    await fetch(`${CONFIG.API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    clearInterval(pollTimer);
    location.reload();
  }
};

// If a valid JWT cookie already exists from an earlier visit this session,
// skip straight to the dashboard instead of showing the login form again.
(async function checkExistingSession() {
  try {
    await api('whoAmI', {});
    enterDashboard();
  } catch {
    // Not logged in (or session expired) — gate screen is the default
    // visible state in the HTML already, nothing else to do here.
  }
})();

// ---------------------------------------------------------------------------
// NAV
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
    document.getElementById('panelTitle').textContent = btn.textContent.trim().replace(/^\S+\s/, '');
  });
});

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------
async function loadAll() {
  try {
    const [orders, products, drivers] = await Promise.all([
      api('getOrders', {}), api('getProducts', {}), api('getDrivers', {})
    ]);
    ORDERS = orders; PRODUCTS = products; DRIVERS = drivers;
    renderOrders();
    renderProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
}
document.getElementById('refreshOrdersBtn').onclick = loadAll;

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
function renderOrders() {
  const search = document.getElementById('orderSearch').value.trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  let list = ORDERS;
  if (statusFilter) list = list.filter(o => o.status === statusFilter);
  if (search) list = list.filter(o => (o.id + o.customerName + o.phone).toLowerCase().includes(search));

  const tbody = document.getElementById('ordersTbody');
  if (!list.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No orders match.</td></tr>'; return; }

  tbody.innerHTML = list.map(o => `
    <tr>
      <td class="mono">${esc(o.id)}</td>
      <td>${esc(o.customerName)}<br><span class="mono" style="color:var(--text-dim);font-size:0.72rem">${esc(o.phone)}</span></td>
      <td>${o.items.map(i => esc(i.name) + ' ×' + i.qty).join('<br>')}</td>
      <td class="mono">EGP ${o.totalPrice.toFixed(2)}</td>
      <td>
        <select class="status-select" data-status="${esc(o.id)}">
          ${['Pending','Preparing','Out for Delivery','Delivered','Cancelled'].map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td class="mono">${esc(o.assignedDriver ? driverName(o.assignedDriver) : '—')}</td>
      <td class="mono" style="font-size:0.76rem">${esc(o.date)}<br>${esc(o.time)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-outline btn-sm" data-assign="${esc(o.id)}">Assign</button>
          <button class="btn btn-outline btn-sm" data-invoice="${esc(o.id)}">Invoice</button>
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('change', async () => {
      try { await api('updateOrderStatus', { orderId: sel.dataset.status, status: sel.value }); toast('Status updated.', 'success'); loadAll(); }
      catch (err) { toast(err.message, 'error'); }
    });
  });
  tbody.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => openAssignModal(b.dataset.assign)));
  tbody.querySelectorAll('[data-invoice]').forEach(b => b.addEventListener('click', () => openInvoice(b.dataset.invoice)));
}
document.getElementById('orderSearch').addEventListener('input', renderOrders);
document.getElementById('statusFilter').addEventListener('change', renderOrders);

function driverName(id) {
  const d = DRIVERS.find(dr => dr.id === id);
  return d ? d.name : id;
}

// ---------------------------------------------------------------------------
// ASSIGN DRIVER MODAL
// ---------------------------------------------------------------------------
function openAssignModal(orderId) {
  assignOrderId = orderId;
  const select = document.getElementById('driverSelect');
  select.innerHTML = DRIVERS.map(d => `<option value="${esc(d.id)}">${esc(d.name)}${d.available ? '' : ' (busy)'}</option>`).join('');
  document.getElementById('driverModalScrim').classList.add('open');
}
document.getElementById('driverModalCancel').onclick = () => document.getElementById('driverModalScrim').classList.remove('open');
document.getElementById('driverModalConfirm').onclick = async () => {
  const driverId = document.getElementById('driverSelect').value;
  if (!driverId) return;
  try {
    await api('assignDriver', { orderId: assignOrderId, driverId });
    toast('Driver assigned.', 'success');
    document.getElementById('driverModalScrim').classList.remove('open');
    loadAll();
  } catch (err) { toast(err.message, 'error'); }
};

// ---------------------------------------------------------------------------
// INVOICE
// ---------------------------------------------------------------------------
async function openInvoice(orderId) {
  try {
    const o = await api('getInvoiceData', { orderId });
    document.getElementById('invoiceContent').innerHTML = `
      <div class="invoice-sheet">
        <h2>🍊 CITRINE JUICE CO.</h2>
        <p style="color:#666;margin-top:-8px;">Cold-Pressed, Delivered Fresh</p>
        <div class="invoice-row"><span>Order ID</span><strong>${esc(o.id)}</strong></div>
        <div class="invoice-row"><span>Customer</span><strong>${esc(o.customerName)}</strong></div>
        <div class="invoice-row"><span>Phone</span><strong>${esc(o.phone)}</strong></div>
        <div class="invoice-row"><span>Date</span><strong>${esc(o.date)} ${esc(o.time)}</strong></div>
        <div class="invoice-row"><span>Driver</span><strong>${esc(o.driverName || '—')}</strong></div>
        <h3 style="margin-top:18px;">Items</h3>
        ${o.items.map(i => `<div class="invoice-row"><span>${esc(i.name)} × ${i.qty}</span><span>EGP ${(i.qty * i.price).toFixed(2)}</span></div>`).join('')}
        <div class="invoice-row" style="font-size:1.1rem;border-top:2px solid #111;margin-top:8px;padding-top:10px;"><span>Total</span><strong>EGP ${o.totalPrice.toFixed(2)}</strong></div>
        <div style="text-align:center;margin-top:20px;">
          <img alt="QR code for ${esc(o.id)}" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(o.id)}" />
          <p style="font-size:0.7rem;color:#999;">Scan to verify order ID</p>
        </div>
      </div>`;
    document.getElementById('invoiceModalScrim').classList.add('open');
  } catch (err) { toast(err.message, 'error'); }
}
document.getElementById('invoiceClose').onclick = () => document.getElementById('invoiceModalScrim').classList.remove('open');
document.getElementById('invoicePrint').onclick = () => window.print();

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
function renderProducts() {
  const search = document.getElementById('productSearch').value.trim().toLowerCase();
  let list = PRODUCTS;
  if (search) list = list.filter(p => p.name.toLowerCase().includes(search));
  const tbody = document.getElementById('productsTbody');
  if (!list.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No products yet. Add your first one.</td></tr>'; return; }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td class="mono">${esc(p.category)}</td>
      <td class="mono">EGP ${p.price.toFixed(2)}</td>
      <td><span class="pill ${p.available ? 'pill-Delivered' : 'pill-Cancelled'}">${p.available ? 'Yes' : 'No'}</span></td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" data-edit="${esc(p.id)}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${esc(p.id)}">Delete</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openProductModal(b.dataset.edit)));
  tbody.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.delete)));
}
document.getElementById('productSearch').addEventListener('input', renderProducts);

function openProductModal(id) {
  const p = id ? PRODUCTS.find(pr => pr.id === id) : null;
  document.getElementById('productModalTitle').textContent = p ? 'Edit Product' : 'Add Product';
  document.getElementById('pId').value = p ? p.id : '';
  document.getElementById('pName').value = p ? p.name : '';
  document.getElementById('pDescription').value = p ? p.description : '';
  document.getElementById('pPrice').value = p ? p.price : '';
  document.getElementById('pCategory').value = p ? p.category : 'Citrus';
  document.getElementById('pImage').value = p ? p.image : '';
  document.getElementById('pAvailable').checked = p ? p.available : true;
  document.getElementById('productModalScrim').classList.add('open');
}
document.getElementById('addProductBtn').onclick = () => openProductModal(null);
document.getElementById('productModalCancel').onclick = () => document.getElementById('productModalScrim').classList.remove('open');

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pId').value;
  const payload = {
    name: document.getElementById('pName').value.trim(),
    description: document.getElementById('pDescription').value.trim(),
    price: parseFloat(document.getElementById('pPrice').value),
    category: document.getElementById('pCategory').value,
    image: document.getElementById('pImage').value.trim(),
    available: document.getElementById('pAvailable').checked
  };
  const saveBtn = document.getElementById('productModalSave');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    if (id) await api('editProduct', Object.assign({ id }, payload));
    else await api('addProduct', payload);
    toast('Product saved — now live on the customer site.', 'success');
    document.getElementById('productModalScrim').classList.remove('open');
    loadAll();
  } catch (err) { toast(err.message, 'error'); }
  finally { saveBtn.disabled = false; saveBtn.textContent = 'Save Product'; }
});

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try { await api('deleteProduct', { id }); toast('Product deleted.', 'success'); loadAll(); }
  catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------------------
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
