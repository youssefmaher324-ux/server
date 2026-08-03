const CONFIG = {
  API_URL: 'https://server-production-f5ce.up.railway.app/api',
};

let TOKEN = localStorage.getItem('monastery_bm_token') || null;
let USER = JSON.parse(localStorage.getItem('monastery_bm_user') || 'null');
let ROOMS_CACHE = [];
let reassignTargetId = null;
let messageTargetId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (TOKEN && USER) showDashboard();
  initLogin();
  initNav();
  initBookingsView();
  initQrCheckIn();
  initModals();
});

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${CONFIG.API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return data;
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 5000);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Login / session
// ---------------------------------------------------------------------------
function initLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      TOKEN = data.accessToken;
      USER = data.user;
      localStorage.setItem('monastery_bm_token', TOKEN);
      localStorage.setItem('monastery_bm_user', JSON.stringify(USER));
      await api('/bookings'); // booking_manager/super_admin-only — confirms this account can use this panel
      showDashboard();
    } catch (err) {
      document.getElementById('loginHint').textContent = err.message;
      TOKEN = null;
      localStorage.removeItem('monastery_bm_token');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    TOKEN = null; USER = null;
    localStorage.removeItem('monastery_bm_token');
    localStorage.removeItem('monastery_bm_user');
    document.getElementById('dashboard').hidden = true;
    document.getElementById('loginScreen').hidden = false;
  });
}

function showDashboard() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('dashboard').hidden = false;
  loadBookings();
  loadRoomsCache();
}

function initNav() {
  document.querySelectorAll('.navBtn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
      document.getElementById(`view-${btn.dataset.view}`).hidden = false;
      if (btn.dataset.view === 'requests') loadBookings();
    });
  });
}

async function loadRoomsCache() {
  try { ROOMS_CACHE = await api('/rooms?activeOnly=true'); } catch (_) { ROOMS_CACHE = []; }
}

// ---------------------------------------------------------------------------
// Bookings list
// ---------------------------------------------------------------------------
const BOOKING_STATUS_LABELS = {
  pending: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض',
  checked_in: 'تم تسجيل الوصول', completed: 'مكتمل', cancelled: 'ملغى',
};
const BOOKING_TYPE_LABELS = { individual: 'حجز فرد', full_room: 'غرفة كاملة', retreat: 'خلوة جماعية' };

function initBookingsView() {
  document.getElementById('statusFilter').addEventListener('change', loadBookings);
}

async function loadBookings() {
  const container = document.getElementById('bookingsList');
  const status = document.getElementById('statusFilter').value;
  container.innerHTML = '<p>جارِ التحميل...</p>';
  try {
    const bookings = await api(`/bookings${status ? `?status=${status}` : ''}`);
    if (!bookings.length) { container.innerHTML = '<p>لا توجد طلبات في هذه الحالة.</p>'; return; }
    container.innerHTML = bookings.map(bookingRowHtml).join('');
    wireBookingActions(container, bookings);
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function bookingRowHtml(b) {
  const rooms = (b.bookingRooms || []).map((br) => `غرفة ${br.room?.number} (${br.bedsAllocated})`).join('، ');
  const details = b.type === 'individual' ? (b.gender === 'male' ? 'ولد' : 'بنت')
    : b.type === 'full_room' ? `أسرة من ${b.familySize} أفراد`
    : `مجموعة من ${b.groupSize} (${b.gender === 'male' ? 'أولاد' : 'بنات'}) — ${b.roomsNeeded || '?'} غرف`;
  return `
    <article class="bookingCard status-${b.status}" data-id="${b.id}">
      <div class="bookingCardHead">
        <strong>${BOOKING_TYPE_LABELS[b.type] || b.type}</strong>
        <span class="badge">${BOOKING_STATUS_LABELS[b.status] || b.status}</span>
      </div>
      <p>${escapeHtml(b.user?.name || b.contactName || 'زائر')} — ${escapeHtml(b.phone)} ${b.churchName ? `— ${escapeHtml(b.churchName)}` : ''}</p>
      <p>${details}</p>
      ${b.code ? `<p>رقم الحجز: <strong>${b.code}</strong></p>` : ''}
      <p>${new Date(b.arrivalDate).toLocaleDateString('ar-EG')} → ${new Date(b.departureDate).toLocaleDateString('ar-EG')}</p>
      ${rooms ? `<p>${rooms}</p>` : ''}
      ${b.notes ? `<p class="notes">ملاحظات: ${escapeHtml(b.notes)}</p>` : ''}
      <div class="cardActions">
        ${b.status === 'pending' ? `<button data-approve="${b.id}">قبول</button><button data-reject="${b.id}">رفض</button>` : ''}
        ${['pending', 'approved'].includes(b.status) ? `<button data-reassign="${b.id}">تغيير الغرفة</button>` : ''}
        ${b.status === 'approved' ? `<button data-checkin="${b.id}">تسجيل الوصول</button>` : ''}
        ${b.status === 'checked_in' ? `<button data-checkout="${b.id}">تسجيل المغادرة</button>` : ''}
        <button data-message="${b.id}">إرسال رسالة</button>
      </div>
    </article>`;
}

function wireBookingActions(container) {
  container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => approveBooking(btn.dataset.approve)));
  container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => rejectBooking(btn.dataset.reject)));
  container.querySelectorAll('[data-checkin]').forEach((btn) => btn.addEventListener('click', () => checkInBooking(btn.dataset.checkin)));
  container.querySelectorAll('[data-checkout]').forEach((btn) => btn.addEventListener('click', () => checkOutBooking(btn.dataset.checkout)));
  container.querySelectorAll('[data-reassign]').forEach((btn) => btn.addEventListener('click', () => openReassignModal(btn.dataset.reassign)));
  container.querySelectorAll('[data-message]').forEach((btn) => btn.addEventListener('click', () => openMessageModal(btn.dataset.message)));
}

async function approveBooking(id) {
  try { await api(`/bookings/${id}/approve`, { method: 'POST' }); toast('تم قبول الحجز'); loadBookings(); }
  catch (err) { toast(err.message, true); }
}

async function rejectBooking(id) {
  const reason = prompt('سبب الرفض (اختياري):') || undefined;
  try { await api(`/bookings/${id}/reject`, { method: 'POST', body: { reason } }); toast('تم رفض الحجز'); loadBookings(); }
  catch (err) { toast(err.message, true); }
}

async function checkInBooking(id) {
  try { await api(`/bookings/${id}/check-in`, { method: 'POST' }); toast('تم تسجيل الوصول'); loadBookings(); }
  catch (err) { toast(err.message, true); }
}

async function checkOutBooking(id) {
  try { await api(`/bookings/${id}/check-out`, { method: 'POST' }); toast('تم تسجيل المغادرة'); loadBookings(); }
  catch (err) { toast(err.message, true); }
}

// ---------------------------------------------------------------------------
// Reassign modal
// ---------------------------------------------------------------------------
function initModals() {
  document.getElementById('reassignCancel').addEventListener('click', () => { document.getElementById('reassignModal').hidden = true; });
  document.getElementById('reassignConfirm').addEventListener('click', async () => {
    const roomId = document.getElementById('reassignRoomSelect').value;
    if (!roomId || !reassignTargetId) return;
    try {
      await api(`/bookings/${reassignTargetId}/reassign-room`, { method: 'PATCH', body: { roomId } });
      toast('تم نقل الحجز إلى الغرفة الجديدة');
      document.getElementById('reassignModal').hidden = true;
      loadBookings();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('messageCancel').addEventListener('click', () => { document.getElementById('messageModal').hidden = true; });
  document.getElementById('messageConfirm').addEventListener('click', async () => {
    const message = document.getElementById('messageText').value.trim();
    if (!message || !messageTargetId) return;
    try {
      await api(`/bookings/${messageTargetId}/message`, { method: 'POST', body: { message } });
      toast('تم إرسال الرسالة');
      document.getElementById('messageModal').hidden = true;
      document.getElementById('messageText').value = '';
    } catch (err) { toast(err.message, true); }
  });
}

function openReassignModal(bookingId) {
  reassignTargetId = bookingId;
  const select = document.getElementById('reassignRoomSelect');
  select.innerHTML = ROOMS_CACHE.map((r) => `<option value="${r.id}">غرفة ${escapeHtml(r.number)} (${r.capacity} سرير)</option>`).join('');
  document.getElementById('reassignModal').hidden = false;
}

function openMessageModal(bookingId) {
  messageTargetId = bookingId;
  document.getElementById('messageText').value = '';
  document.getElementById('messageModal').hidden = false;
}

// ---------------------------------------------------------------------------
// QR check-in
// ---------------------------------------------------------------------------
function initQrCheckIn() {
  document.getElementById('qrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const resultBox = document.getElementById('qrResult');
    try {
      const booking = await api('/bookings/check-in-by-qr', { method: 'POST', body: { payload: fd.get('payload') } });
      resultBox.hidden = false;
      resultBox.className = 'resultBox success';
      resultBox.innerHTML = `<p>✅ تم تسجيل الوصول للحجز ${booking.code || booking.id}</p>`;
      e.target.reset();
    } catch (err) {
      resultBox.hidden = false;
      resultBox.className = 'resultBox error';
      resultBox.innerHTML = `<p>❌ ${escapeHtml(err.message)}</p>`;
    }
  });
}
